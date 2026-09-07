import type { Format, NormalizedDoc, ParseCtx } from '../types';
import { AppError } from '../errors';

export interface Parser {
  parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc>;
}

/**
 * 파서를 전부 초기 번들에 넣으면 5MB 를 넘는다.
 * 확장자를 확인한 뒤 해당 파서만 동적으로 불러온다.
 * (M0 에서는 스텁. M1~M4 에서 하나씩 실제 구현으로 교체한다.)
 */
const LOADERS: Record<Format, () => Promise<Parser>> = {
  txt: () => import('./stub').then((m) => m.makeStub('txt')),
  md: () => import('./stub').then((m) => m.makeStub('md')),
  docx: () => import('./stub').then((m) => m.makeStub('docx')),
  pdf: () => import('./stub').then((m) => m.makeStub('pdf')),
  hwp: () => import('./stub').then((m) => m.makeStub('hwp')),
  hwpx: () => import('./stub').then((m) => m.makeStub('hwpx')),
};

export async function loadParser(format: Format): Promise<Parser> {
  const loader = LOADERS[format];
  if (!loader) throw new AppError('UNSUPPORTED_FORMAT', format);
  return loader();
}
