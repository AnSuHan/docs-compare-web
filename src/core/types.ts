/**
 * T-002 — 구현의 계약.
 * 파서 / 정규화 / diff / UI 는 오직 이 타입만 주고받는다.
 * 이 파일은 DOM 에 의존하지 않는다. Node 에서 그대로 import 되어야 한다.
 */

export type Format = 'txt' | 'md' | 'docx' | 'pdf' | 'hwp' | 'hwpx';

export type FormatGroup = 'text' | 'docx' | 'pdf' | 'hwp';

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'listItem'
  | 'table'
  | 'code'
  | 'quote'
  | 'image'
  | 'pageBreak';

export interface StyleHint {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  fontSize?: number;
  fontName?: string;
}

export interface BlockSource {
  /** 1-based. HWP/HWPX 는 페이지 정보를 저장하지 않으므로 항상 undefined. */
  page?: number;
  /** HWP/HWPX 구역 번호. */
  section?: number;
  /** 원문 내 누적 문자 위치. */
  charOffset: number;
  /** PDF 전용 [x0, y0, x1, y1]. 하이라이트용이며 diff 에는 쓰지 않는다. */
  bbox?: [number, number, number, number];
}

export interface Block {
  id: string;
  type: BlockType;
  /** heading 1~6 / listItem depth 0~ */
  level?: number;
  /** 정규화 완료. diff 의 유일한 입력. */
  text: string;
  /** 정규화 전 원문. 옵션 재적용과 렌더링에 쓴다. */
  rawText: string;
  style?: StyleHint;
  source: BlockSource;
}

export type WarningCode =
  // 공통
  | 'LARGE_FILE'
  | 'PARTIAL_PARSE'
  | 'ENCRYPTED'
  | 'UNSUPPORTED_VERSION'
  | 'TABLE_FLATTENED'
  | 'ENCODING_GUESS'
  // PDF
  | 'SCANNED_PDF'
  | 'MULTI_COLUMN_GUESS'
  | 'HEADER_FOOTER_REMOVED'
  | 'PAGE_BREAK_MERGED'
  | 'ROTATED_TEXT'
  | 'STRUCT_TREE_MISSING'
  | 'GARBLED_TEXT'
  // HWP
  | 'HWP_DISTRIBUTION_DOC'
  | 'HWP_UNKNOWN_TAG'
  | 'HWP_NO_PAGE_INFO'
  | 'HWPX_SECTION_MISSING';

export interface ParseWarning {
  code: WarningCode;
  severity: 'info' | 'warn' | 'error';
  /** 사용자에게 그대로 보여줄 한국어 문장. */
  message: string;
  page?: number;
  /** 개발자용 상세. UI 의 "자세히" 에만 노출. */
  detail?: string;
}

export interface DocMeta {
  fileName: string;
  fileSize: number;
  pageCount?: number;
  sectionCount?: number;
  parsedAt: number;
  /** 'pdf@3' 형태. 골든 스냅샷 무효화 키. */
  parserVersion: string;
  /** PDF 전용: A=구조트리, B=기하재조립, C=스캔본 */
  extractionTrack?: 'A' | 'B' | 'C';
}

export interface NormalizedDoc {
  format: Format;
  meta: DocMeta;
  blocks: Block[];
  warnings: ParseWarning[];
  /** 0.0 ~ 1.0. 0 이면 비교를 차단한다. */
  confidence: number;
}

// ---------------------------------------------------------------- 정규화

export interface NormalizeOptions {
  ignoreWhitespace: boolean;
  normalizePunct: boolean;
  ignoreCase: boolean;
  foldWidth: boolean;
  joinHyphen: boolean;
}

// ---------------------------------------------------------------- diff

export type ChangeKind = 'equal' | 'insert' | 'delete' | 'modify';

export interface InlineSpan {
  kind: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface DiffRow {
  kind: ChangeKind;
  left?: Block;
  right?: Block;
  /** modify 일 때만. 좌우를 통합한 인라인 스팬. */
  inline?: InlineSpan[];
  similarity?: number;
}

export interface DiffStats {
  insertBlocks: number;
  deleteBlocks: number;
  modifyBlocks: number;
  equalBlocks: number;
  insertChars: number;
  deleteChars: number;
}

export interface DiffOptions {
  normalize: NormalizeOptions;
  /** 인라인 diff 를 생략할 블록 길이 상한. */
  maxInlineLen: number;
  timeoutMs: number;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: DiffStats;
  /** rows 배열에서 변경이 있는 행의 인덱스. 네비게이션용. */
  changeIndices: number[];
  options: DiffOptions;
  /** 타임아웃으로 중단된 경우 true. */
  truncated?: boolean;
}

// ---------------------------------------------------------------- 진행률

export interface Progress {
  phase: 'reading' | 'parsing' | 'normalizing' | 'diffing';
  current: number;
  total: number;
  /** '32 / 120 페이지' 같은 사람이 읽는 라벨. */
  label?: string;
}

export type ProgressFn = (p: Progress) => void;

/** 워커는 AbortSignal 을 받을 수 없어서, 취소는 이 콜백을 폴링해 처리한다. */
export type AbortFn = () => boolean | Promise<boolean>;

export interface ParseCtx {
  progress: ProgressFn;
  shouldAbort: AbortFn;
  options: NormalizeOptions;
}
