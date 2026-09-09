import { create } from 'zustand';
import type { DiffResult, NormalizedDoc, NormalizeOptions, Progress } from '@/core/types';
import type { Mode } from '@/core/mode';
import { decideMode } from '@/core/mode';
import { DEFAULT_NORMALIZE } from '@/core/normalize';
import { groupOf } from '@/core/detect';
import { DIFF_LIMITS } from '@/core/limits';
import { AppError } from '@/core/errors';
import { parseFile, renormalize, runDiff, terminateWorker } from '@/workers/client';

type Slot = 0 | 1;
/** 'triple' = 세 칸 보기(왼쪽만 / 공통 / 오른쪽만). 가운데는 나중에 편집 대상이 된다. */
export type ViewMode = 'split' | 'unified' | 'triple';

/**
 * T-040 — 암호가 걸린 문서를 다시 열 때 쓰는 비밀번호를 파일별로 들고 있는다.
 * 메모리에만 둔다. localStorage 에도, 서버에도 가지 않는다(D-01).
 */
export function fileKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

export interface PasswordAsk {
  key: string;
  fileName: string;
  /** 이미 한 번 틀린 뒤인가. 모달 문구가 달라진다. */
  wrong: boolean;
  /** 비교하다가 막힌 것인지, 뷰어에서 막힌 것인지. 비밀번호를 받은 뒤 할 일이 다르다. */
  source: 'compare' | 'viewer';
}

interface AppState {
  files: [File | null, File | null];
  mode: Mode;
  docs: [NormalizedDoc | null, NormalizedDoc | null];
  diff: DiffResult | null;
  progress: Progress | null;
  error: AppError | null;
  busy: boolean;
  normalizeOptions: NormalizeOptions;
  view: ViewMode;
  /** changeIndices 내 현재 위치. -1 이면 아직 아무 데도 안 갔다. */
  cursor: number;
  /** 파일별 비밀번호. 메모리에만 산다. */
  passwords: Record<string, string>;
  /** 비밀번호 모달을 띄워야 하는 상태. null 이면 닫혀 있다. */
  passwordAsk: PasswordAsk | null;

  setFile(slot: Slot, f: File | null): void;
  swap(): void;
  run(): Promise<void>;
  cancel(): void;
  reset(): void;
  setView(v: ViewMode): void;
  next(): void;
  prev(): void;
  setCursor(i: number): void;
  setOption<K extends keyof NormalizeOptions>(k: K, v: NormalizeOptions[K]): Promise<void>;
  /** 뷰어에서 암호 문서를 만났을 때. 비교 경로는 run() 이 스스로 연다. */
  askPassword(file: File, wrong: boolean): void;
  submitPassword(password: string): Promise<void>;
  dismissPassword(): void;
}

/** 취소 플래그. 워커에는 proxy 콜백으로 전달된다. */
let aborted = false;

function toMode(files: [File | null, File | null]): Mode {
  const present = files.filter((f): f is File => f !== null).map((f) => ({ name: f.name, size: f.size }));
  try {
    return decideMode(present);
  } catch {
    return { kind: 'empty' };
  }
}

/** 두 파일의 형식 그룹에 맞는 기본 정규화 옵션. 예: PDF 는 하이픈 결합을 켠다. */
function defaultOptionsFor(files: [File | null, File | null]): NormalizeOptions {
  const first = files.find((f): f is File => f !== null);
  if (!first) return DEFAULT_NORMALIZE.text;
  try {
    return DEFAULT_NORMALIZE[groupOf(first.name)];
  } catch {
    return DEFAULT_NORMALIZE.text;
  }
}

const diffOptionsFrom = (normalize: NormalizeOptions) => ({
  normalize,
  maxInlineLen: DIFF_LIMITS.MAX_INLINE_LEN,
  timeoutMs: DIFF_LIMITS.TIMEOUT_MS,
});

export const useApp = create<AppState>((set, get) => ({
  files: [null, null],
  mode: { kind: 'empty' },
  docs: [null, null],
  diff: null,
  progress: null,
  error: null,
  busy: false,
  normalizeOptions: DEFAULT_NORMALIZE.text,
  // 기본은 세 칸. 공통과 차이를 한 화면에서 가르는 것이 이 도구의 기본 읽기 방식이다.
  view: 'triple',
  cursor: -1,
  passwords: {},
  passwordAsk: null,

  setFile(slot, f) {
    const files = [...get().files] as [File | null, File | null];
    files[slot] = f;
    set({
      files,
      mode: toMode(files),
      diff: null,
      error: null,
      docs: [null, null],
      cursor: -1,
      passwordAsk: null,
      // 형식이 정해지면 그 형식의 기본 옵션으로 맞춘다.
      normalizeOptions: defaultOptionsFor(files),
    });
  },

  swap() {
    const [a, b] = get().files;
    const files: [File | null, File | null] = [b, a];
    set({ files, mode: toMode(files), diff: null, error: null, docs: [null, null], cursor: -1 });
  },

  async run() {
    const { files, normalizeOptions } = get();
    const mode = toMode(files);
    if (mode.kind !== 'compare') return;

    aborted = false;
    set({ busy: true, error: null, diff: null, progress: null, cursor: -1 });

    /**
     * 취소한 뒤에 뒤늦게 도착한 진행률은 버린다.
     * 워커를 terminate 해도 이미 큐에 올라온 메시지는 배달된다. 그걸 그대로 반영하면
     * "중단했습니다" 를 띄운 화면에 진행률이 되살아나 영영 남는다 (E2E 시나리오 3).
     */
    const onProgress = (p: Progress) => {
      if (aborted) return;
      set({ progress: p });
    };
    const shouldAbort = () => aborted;

    /**
     * 이미 읽은 파일은 다시 읽지 않는다.
     * 비밀번호를 넣고 재시도할 때(T-040) 앞 파일까지 또 파싱하면 30MB 를 두 번 읽게 된다.
     */
    const parseSlot = async (slot: Slot, f: File): Promise<NormalizedDoc> => {
      const cached = get().docs[slot];
      if (cached && cached.meta.fileName === f.name && cached.meta.fileSize === f.size) return cached;

      const doc = await parseFile(f, normalizeOptions, onProgress, shouldAbort, get().passwords[fileKey(f)]);
      const docs = [...get().docs] as [NormalizedDoc | null, NormalizedDoc | null];
      docs[slot] = doc;
      set({ docs });
      return doc;
    };

    try {
      const [fa, fb] = files as [File, File];
      const a = await parseSlot(0, fa);
      if (aborted) throw new AppError('ABORTED');
      const b = await parseSlot(1, fb);
      if (aborted) throw new AppError('ABORTED');

      set({ progress: { phase: 'diffing', current: 0, total: 1 } });

      const diff = await runDiff(a, b, diffOptionsFrom(normalizeOptions));
      set({ diff, busy: false, progress: null });
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('CORRUPTED', String(e));

      // 암호 문서는 실패가 아니라 "물어볼 것이 남은 상태"다. 에러 대신 모달을 연다.
      if (err.code === 'PDF_PASSWORD_REQUIRED' || err.code === 'PDF_PASSWORD_WRONG') {
        const f = get().files.find((x): x is File => x !== null && x.name === err.detail);
        if (f) {
          set({
            busy: false,
            progress: null,
            error: null,
            passwordAsk: { key: fileKey(f), fileName: f.name, wrong: err.code === 'PDF_PASSWORD_WRONG', source: 'compare' },
          });
          return;
        }
      }
      set({ error: err, busy: false, progress: null });
    }
  },

  cancel() {
    aborted = true;
    terminateWorker();
    set({ busy: false, progress: null, passwordAsk: null, error: new AppError('ABORTED') });
  },

  reset() {
    aborted = true;
    set({
      files: [null, null],
      mode: { kind: 'empty' },
      docs: [null, null],
      diff: null,
      error: null,
      progress: null,
      busy: false,
      cursor: -1,
      // 비밀번호도 함께 버린다. "처음부터" 는 아무것도 안 들고 있는 상태여야 한다.
      passwords: {},
      passwordAsk: null,
    });
  },

  setView(view) {
    set({ view });
  },

  next() {
    const { diff, cursor } = get();
    if (!diff || diff.changeIndices.length === 0) return;
    set({ cursor: Math.min(cursor + 1, diff.changeIndices.length - 1) });
  },

  prev() {
    const { diff, cursor } = get();
    if (!diff || diff.changeIndices.length === 0) return;
    set({ cursor: Math.max(cursor - 1, 0) });
  },

  /** 미니맵에서 직접 짚었을 때. 범위를 벗어난 값은 무시한다. */
  setCursor(i) {
    const { diff } = get();
    if (!diff || i < 0 || i >= diff.changeIndices.length) return;
    set({ cursor: i });
  },

  /** 재파싱하지 않는다. 정규화만 다시 적용하고 diff 를 새로 돌린다(§4.3). */
  async setOption(k, v) {
    const normalizeOptions = { ...get().normalizeOptions, [k]: v };
    set({ normalizeOptions });

    const [a, b] = get().docs;
    if (!a || !b) return;

    set({ busy: true });
    try {
      const [na, nb] = await Promise.all([renormalize(a, normalizeOptions), renormalize(b, normalizeOptions)]);
      const diff = await runDiff(na, nb, diffOptionsFrom(normalizeOptions));
      set({ docs: [na, nb], diff, busy: false, cursor: -1 });
    } catch (e) {
      set({ error: e instanceof AppError ? e : new AppError('CORRUPTED', String(e)), busy: false });
    }
  },

  askPassword(file, wrong) {
    set({ passwordAsk: { key: fileKey(file), fileName: file.name, wrong, source: 'viewer' } });
  },

  async submitPassword(password) {
    const ask = get().passwordAsk;
    if (!ask) return;
    set({ passwords: { ...get().passwords, [ask.key]: password }, passwordAsk: null });
    // 뷰어는 password 가 바뀌면 스스로 다시 그린다. 비교만 여기서 다시 돌린다.
    if (ask.source === 'compare') await get().run();
  },

  dismissPassword() {
    const ask = get().passwordAsk;
    set({
      passwordAsk: null,
      // 비교하다 막힌 것이면 빈 화면 대신 이유를 남긴다.
      error: ask?.source === 'compare' ? new AppError('PDF_PASSWORD_REQUIRED', ask.fileName) : null,
    });
  },
}));
