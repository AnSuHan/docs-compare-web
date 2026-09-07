import { create } from 'zustand';
import type { DiffResult, NormalizedDoc, NormalizeOptions, Progress } from '@/core/types';
import type { Mode } from '@/core/mode';
import { decideMode } from '@/core/mode';
import { DEFAULT_NORMALIZE } from '@/core/normalize';
import { DIFF_LIMITS } from '@/core/limits';
import { AppError } from '@/core/errors';
import { parseFile, renormalize, runDiff, terminateWorker } from '@/workers/client';

type Slot = 0 | 1;

interface AppState {
  files: [File | null, File | null];
  mode: Mode;
  docs: [NormalizedDoc | null, NormalizedDoc | null];
  diff: DiffResult | null;
  progress: Progress | null;
  error: AppError | null;
  busy: boolean;
  options: NormalizeOptions;

  setFile(slot: Slot, f: File | null): void;
  run(): Promise<void>;
  cancel(): void;
  reset(): void;
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

export const useApp = create<AppState>((set, get) => ({
  files: [null, null],
  mode: { kind: 'empty' },
  docs: [null, null],
  diff: null,
  progress: null,
  error: null,
  busy: false,
  options: DEFAULT_NORMALIZE.text,

  setFile(slot, f) {
    const files = [...get().files] as [File | null, File | null];
    files[slot] = f;
    set({ files, mode: toMode(files), diff: null, error: null, docs: [null, null] });
  },

  async run() {
    const { files, options } = get();
    const mode = toMode(files);
    if (mode.kind !== 'compare') return;

    aborted = false;
    set({ busy: true, error: null, diff: null, progress: null });

    const onProgress = (p: Progress) => set({ progress: p });
    const shouldAbort = () => aborted;

    try {
      const [fa, fb] = files as [File, File];
      const a = await parseFile(fa, options, onProgress, shouldAbort);
      if (aborted) throw new AppError('ABORTED');
      const b = await parseFile(fb, options, onProgress, shouldAbort);
      if (aborted) throw new AppError('ABORTED');

      set({ docs: [a, b], progress: { phase: 'diffing', current: 0, total: 1 } });

      const diff = await runDiff(a, b, {
        normalize: options,
        maxInlineLen: DIFF_LIMITS.MAX_INLINE_LEN,
        timeoutMs: DIFF_LIMITS.TIMEOUT_MS,
      });
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
    set({ files: [null, null], mode: { kind: 'empty' }, docs: [null, null], diff: null, error: null, progress: null, busy: false });
  },

  /** 재파싱하지 않는다. 정규화만 다시 적용하고 diff 를 새로 돌린다. */
  async setOption(k, v) {
    const options = { ...get().options, [k]: v };
    set({ options });
    const [a, b] = get().docs;
    if (!a || !b) return;
    const [na, nb] = await Promise.all([renormalize(a, options), renormalize(b, options)]);
    const diff = await runDiff(na, nb, {
      normalize: options,
      maxInlineLen: DIFF_LIMITS.MAX_INLINE_LEN,
      timeoutMs: DIFF_LIMITS.TIMEOUT_MS,
    });
    set({ docs: [na, nb], diff });
  },
}));
