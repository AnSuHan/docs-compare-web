import type { FormatGroup } from './types';
import { AppError } from './errors';
import { extOf, groupOf } from './detect';

export interface FileRef {
  name: string;
  size: number;
}

export type Mode =
  | { kind: 'empty' }
  | { kind: 'viewer-single'; file: FileRef }
  | { kind: 'viewer-split'; a: FileRef; b: FileRef; reason: 'group-mismatch' }
  | { kind: 'compare'; a: FileRef; b: FileRef; group: FormatGroup; crossFormat: boolean };

/**
 * D-02: 같은 형식 그룹일 때만 비교한다.
 *  - txt <-> md   : 둘 다 순수 텍스트이므로 허용
 *  - hwp <-> hwpx : 허용하되 crossFormat 경고
 *  - 그 외 그룹 불일치는 뷰어 분할
 */
export function decideMode(files: FileRef[]): Mode {
  if (files.length === 0) return { kind: 'empty' };
  if (files.length > 2) throw new AppError('TOO_MANY_FILES');

  const [a, b] = files as [FileRef, FileRef?];
  if (!b) return { kind: 'viewer-single', file: a };

  const ga = groupOf(a.name);
  const gb = groupOf(b.name);
  if (ga !== gb) return { kind: 'viewer-split', a, b, reason: 'group-mismatch' };

  return { kind: 'compare', a, b, group: ga, crossFormat: extOf(a.name) !== extOf(b.name) };
}
