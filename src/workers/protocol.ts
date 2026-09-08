import type {
  DiffOptions, DiffResult, NormalizedDoc, NormalizeOptions, Progress,
} from '@/core/types';

export interface ParseRequest {
  buffer: ArrayBuffer;
  fileName: string;
  options: NormalizeOptions;
  /** 암호가 걸린 문서를 다시 열 때만 채운다(T-040). 워커 안에서만 쓰이고 어디에도 남지 않는다. */
  password?: string;
}

/**
 * 워커가 노출하는 API.
 * onProgress / shouldAbort 는 Comlink.proxy() 로 감싸서 넘긴다.
 * AbortSignal 은 워커 경계를 넘지 못하므로 폴링 콜백을 쓴다.
 */
export interface WorkerApi {
  parse(
    req: ParseRequest,
    onProgress: (p: Progress) => void,
    shouldAbort: () => boolean,
  ): Promise<NormalizedDoc>;

  /** 파싱을 다시 하지 않고 정규화 옵션만 재적용한다. 옵션 토글이 즉각 반응하는 이유. */
  renormalize(doc: NormalizedDoc, options: NormalizeOptions): Promise<NormalizedDoc>;

  diff(a: NormalizedDoc, b: NormalizedDoc, options: DiffOptions): Promise<DiffResult>;

  /** 워커가 살아있는지 확인하는 헬스체크. T-003 의 완료 기준. */
  ping(): Promise<{ ok: true; version: string }>;
}
