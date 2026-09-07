import type { Format, NormalizedDoc, ParseCtx } from '../types';
import { AppError } from '../errors';

export interface Parser {
  parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc>;
}

/**
 * 파서를 전부 초기 번들에 넣으면 5MB 를 넘는다(pdfjs 만 1.3MB).
 * 확장자를 확인한 뒤 해당 파서만 동적으로 불러온다.
 * scripts/check-bundle.mjs 가 이 규칙을 깨뜨리는 정적 import 를 잡는다.
 */
const LOADERS: Record<Format, () => Promise<Parser>> = {
  txt: () => import('./text').then((m) => m.textParser),
  md: () => import('./markdown').then((m) => m.markdownParser),
  docx: () => import('./docx').then((m) => m.docxParser),
  pdf: () => import('./pdf').then((m) => m.pdfParser),
  hwp: () => import('./hwp').then((m) => m.hwpParser),
  hwpx: () => import('./hwpx').then((m) => m.hwpxParser),
};

export async function loadParser(format: Format): Promise<Parser> {
  const loader = LOADERS[format];
  if (!loader) throw new AppError('UNSUPPORTED_FORMAT', format);
  return loader();
}

// ─────────────────────────────────────────────────────────────── 상태 표

/** /admin 이 "무엇이 실제로 붙어 있는가"를 보여줄 때 쓰는 표. */
export interface ParserInfo {
  format: Format;
  label: string;
  version: string;
  /** 실제 구현인가, 자리만 잡아둔 스텁인가 */
  status: 'real' | 'stub';
  /** 어떤 방식으로 읽는지 한 줄 설명 */
  how: string;
  /** 이 파서가 필요로 하는 런타임 기능 */
  needs: string[];
  /** 알려진 한계 */
  limits: string[];
}

export const PARSER_INFO: readonly ParserInfo[] = [
  {
    format: 'txt',
    label: 'TXT',
    version: 'txt@1',
    status: 'real',
    how: 'BOM → UTF-8 엄격검사 → CP949(euc-kr) 순으로 인코딩을 판정하고 빈 줄로 문단을 끊습니다.',
    needs: ['TextDecoder(euc-kr)'],
    limits: ['인코딩을 추정한 경우 신뢰도 0.7 로 낮춥니다.'],
  },
  {
    format: 'md',
    label: 'Markdown',
    version: 'md@1',
    status: 'real',
    how: '블록 문법(제목·목록·인용·코드펜스·표)을 직접 훑고, 인라인 서식은 벗겨서 비교합니다.',
    needs: [],
    limits: ['서식만 바뀐 변경은 잡지 않습니다(D-03).'],
  },
  {
    format: 'docx',
    label: 'DOCX',
    version: 'docx@1',
    status: 'real',
    how: 'JSZip 으로 word/document.xml 을 열고 w:p / w:t 를 문서 순서대로 읽습니다.',
    needs: ['JSZip'],
    limits: ['표는 셀을 " | " 로 이어 한 블록으로 평탄화합니다.', '.doc(구버전)는 지원하지 않습니다.'],
  },
  {
    format: 'pdf',
    label: 'PDF',
    version: 'pdf@1',
    status: 'real',
    how: '트랙 A(구조 트리) → 트랙 B(기하 재조립 6단계) → 트랙 C(스캔 판정) 순으로 처리합니다.',
    needs: ['pdfjs-dist', 'pdf.worker'],
    limits: [
      '괘선 없는 표는 줄 단위로만 비교합니다.',
      '스캔 PDF 와 글꼴 정보가 깨진 PDF 는 비교를 차단합니다.',
      '다단 조판은 읽기 순서를 추정하므로 신뢰도가 0.6 으로 내려갑니다.',
    ],
  },
  {
    format: 'hwpx',
    label: 'HWPX',
    version: 'hwpx@1',
    status: 'real',
    how: 'JSZip 으로 Contents/sectionN.xml 을 열고 hp:p / hp:t 를 순서대로 읽습니다.',
    needs: ['JSZip'],
    limits: ['표는 한 블록으로 평탄화합니다.', 'HWPX 에는 페이지 정보가 없어 구역으로 위치를 표시합니다.'],
  },
  {
    format: 'hwp',
    label: 'HWP 5.0',
    version: 'hwp@1',
    status: 'real',
    how: 'CFB 컨테이너 → BodyText/SectionN → raw deflate 해제 → 레코드 → PARA_TEXT 의 UTF-16LE 제어문자 해석.',
    needs: ['cfb', 'pako'],
    limits: [
      '배포용(열람 제한) 문서는 열 수 없습니다.',
      '본문 파싱이 실패하면 PrvText 미리보기로 폴백하고 신뢰도를 0.4 로 낮춥니다.',
    ],
  },
];
