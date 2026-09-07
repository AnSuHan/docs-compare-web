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
export type ViewMode = 'split' | 'unified';

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
  view: 'unified',
  cursor: -1,

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

    const onProgress = (p: Progress) => set({ progress: p });
    const shouldAbort = () => aborted;

    try {
      const [fa, fb] = files as [File, File];
      const a = await parseFile(fa, normalizeOptions, onProgress, shouldAbort);
      if (aborted) throw new AppError('ABORTED');
      const b = await parseFile(fb, normalizeOptions, onProgress, shouldAbort);
      if (aborted) throw new AppError('ABORTED');

      set({ docs: [a, b], progress: { phase: 'diffing', current: 0, total: 1 } });

      const diff = await runDiff(a, b, diffOptionsFrom(normalizeOptions));
      set({ diff, busy: false, progress: null });
    } catch (e) {
      set({ error: e instanceof AppError ? e : new AppError('CORRUPTED', String(e)), busy: false, progress: null });
    }
  },

  cancel() {
    aborted = true;
    terminateWorker();
    set({ busy: false, progress: null, error: new AppError('ABORTED') });
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
}));
