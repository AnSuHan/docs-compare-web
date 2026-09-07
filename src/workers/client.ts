import * as Comlink from 'comlink';
import type { WorkerApi } from './protocol';
import type { DiffOptions, DiffResult, NormalizedDoc, NormalizeOptions, Progress } from '@/core/types';
import { AppError, isAppErrorPayload, type ErrorCode } from '@/core/errors';

/**
 * 워커 한 개를 앱 전체가 공유한다.
 * 파일 두 개를 순차 처리하므로 워커 풀은 필요 없다.
 * (M6 에서 병렬 파싱이 필요해지면 여기만 바꾸면 된다.)
 */
let worker: Worker | null = null;
let api: Comlink.Remote<WorkerApi> | null = null;

function ensure(): Comlink.Remote<WorkerApi> {
  if (!api) {
    worker = new Worker(new URL('./document.worker.ts', import.meta.url), { type: 'module' });
    api = Comlink.wrap<WorkerApi>(worker);
  }
  return api;
}

/** 취소 시 워커를 통째로 버린다. 부분 상태가 남지 않아 가장 확실하다. */
export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
  api = null;
}

function rethrow(e: unknown): never {
  if (isAppErrorPayload(e)) throw new AppError(e.code as ErrorCode, e.detail);
  throw e;
}

export async function ping() {
  return ensure().ping().catch(rethrow);
}

export async function parseFile(
  file: File,
  options: NormalizeOptions,
  onProgress: (p: Progress) => void,
  shouldAbort: () => boolean,
): Promise<NormalizedDoc> {
  const buffer = await file.arrayBuffer();
  return ensure()
    .parse(
      // ArrayBuffer 는 transfer 로 넘긴다. 30MB 복사 비용이 사라진다.
      Comlink.transfer({ buffer, fileName: file.name, options }, [buffer]),
      Comlink.proxy(onProgress),
      Comlink.proxy(shouldAbort),
    )
    .catch(rethrow);
}

export async function renormalize(doc: NormalizedDoc, options: NormalizeOptions) {
  return ensure().renormalize(doc, options).catch(rethrow);
}

export async function runDiff(a: NormalizedDoc, b: NormalizedDoc, options: DiffOptions): Promise<DiffResult> {
  return ensure().diff(a, b, options).catch(rethrow);
}
