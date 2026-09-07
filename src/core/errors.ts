import type { Format } from './types';

export type ErrorCode =
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED_FORMAT'
  | 'FORMAT_MISMATCH'
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'CORRUPTED'
  | 'ENCRYPTED'
  | 'NOT_HWP'
  | 'HWP_DISTRIBUTION_DOC'
  | 'SCANNED_PDF'
  | 'GARBLED_TEXT'
  | 'OUT_OF_MEMORY'
  | 'TIMEOUT'
  | 'ABORTED';

/** 사용자에게 그대로 보여줄 문장. 사과하지 않고, 무엇을 하면 되는지 말한다. */
const MESSAGES: Record<ErrorCode, string> = {
  TOO_MANY_FILES: '파일은 두 개까지 올릴 수 있습니다.',
  UNSUPPORTED_FORMAT: '지원하지 않는 형식입니다. txt, md, docx, pdf, hwp, hwpx를 올려주세요.',
  FORMAT_MISMATCH: '확장자와 실제 내용이 다릅니다.',
  FILE_TOO_LARGE: '파일이 30MB를 넘습니다.',
  EMPTY_FILE: '파일이 비어 있습니다.',
  CORRUPTED: '파일을 읽을 수 없습니다. 손상된 것 같습니다.',
  ENCRYPTED: '암호가 걸린 문서입니다.',
  NOT_HWP: '한글 문서 형식이 아닙니다.',
  HWP_DISTRIBUTION_DOC: '배포용으로 보호된 문서라 열 수 없습니다. 한/글에서 일반 문서로 다시 저장한 뒤 올려주세요.',
  SCANNED_PDF: '이미지로 스캔된 PDF는 비교할 수 없습니다. 내용을 보려면 뷰어로 열어주세요.',
  GARBLED_TEXT: '글꼴 정보 문제로 이 PDF의 텍스트를 정확히 읽을 수 없습니다.',
  OUT_OF_MEMORY: '문서가 너무 커서 처리하지 못했습니다.',
  TIMEOUT: '처리 시간이 초과됐습니다. 지금까지 찾은 결과만 표시합니다.',
  ABORTED: '처리를 중단했습니다.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly format?: Format;

  constructor(code: ErrorCode, detail?: string, format?: Format) {
    super(MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
    this.format = format;
  }

  /** Comlink 는 Error 서브클래스를 그대로 넘기지 못한다. 평범한 객체로 직렬화한다. */
  toJSON() {
    return { __appError: true, code: this.code, message: this.message, detail: this.detail };
  }
}

export function isAppErrorPayload(v: unknown): v is { __appError: true; code: ErrorCode; message: string; detail?: string } {
  return typeof v === 'object' && v !== null && '__appError' in v;
}

export function messageFor(code: ErrorCode): string {
  return MESSAGES[code];
}
