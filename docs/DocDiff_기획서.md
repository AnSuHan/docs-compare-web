# DocDiff — 다형식 문서 비교 웹앱 구현 기획서

> **v2.0 · 2026-09-02 · 구현 착수용**
> PDF / DOCX / TXT / MD / HWP / HWPX 문서 두 개를 브라우저에서 git diff처럼 비교하는 공개 웹 서비스.
> 이 문서는 읽고 바로 코딩할 수 있는 수준을 목표로 한다. 모든 타입·상수·알고리즘·티켓이 포함돼 있다.

## 목차

| 장 | 내용 |
|---|---|
| [0](#0-결정-사항-요약-decision-log) | 결정 사항 요약 — **여기부터 읽을 것** |
| 1~2 | 개요 · 기능 명세 |
| 3~5 | 데이터 모델 · 정규화 · Diff 엔진 |
| **6** | **PDF 파이프라인** (최대 난관) |
| **7** | **HWP / HWPX 파이프라인** |
| 8 | TXT / MD / DOCX |
| 9~10 | UI · 성능 · 에러 |
| 11~12 | 파일 구조 · **구현 티켓 76개** |
| 13~16 | 테스트 · 배포 · 리스크 · v2 |
| 부록 | 체크리스트 · 참고자료 · 상수 요약 |

---

## 0. 결정 사항 요약 (Decision Log)

착수 전 합의가 필요한 항목만 모았다. 나머지 본문은 이 결정에서 파생된다.

| # | 결정 | 내용 | 근거 |
|---|---|---|---|
| D-01 | **완전 클라이언트 처리** | 서버는 정적 파일만 서빙. 파일은 업로드되지 않음 | 계약서·공문서 대상 서비스에서 최대 신뢰 자산이자 비용 0 |
| D-02 | **동일 확장자만 비교** | 다르면 뷰어 모드 | 형식 교차 비교는 오탐이 심해 신뢰를 깎음 |
| D-03 | **텍스트만 diff** | 좌표·서식은 diff 대상 아님 | 같은 문서를 다른 도구로 출력하면 좌표가 전부 달라짐 |
| D-04 | **PDF 파서는 pdfjs-dist (Apache-2.0)** | MuPDF.js는 AGPL 리스크로 배제 | §6.2 |
| D-05 | **HWP는 자체 파서 (pako + CFB 직접 파싱)** | 외부 라이브러리는 폴백 | §7.2 |
| D-06 | **HWPX 우선, HWP 5.0 차선** | HWPX는 ZIP+XML로 난이도가 한 자릿수 낮음 | §7.1 |
| D-07 | **배포용(잠금) HWP는 v1 미지원** | 경고 후 차단 | §7.7 |
| D-08 | **OCR 없음 (v1)** | 스캔 PDF는 비교 차단, 뷰어만 | §6.8 |
| D-09 | **파싱 신뢰도(confidence)를 UI에 노출** | 조용히 틀린 결과가 최악 | §3.3 |
| D-10 | **개발 기간 10주 (1인)** | PDF 3주 + HWP 3주가 절반 | §12 |

**미결 (M0 스파이크로 결정)**
- U-01: `kordoc`이 브라우저 번들에서 동작하는가 → 동작하면 §7 자체 구현을 위임으로 대체, 3주 절감
- U-02: 국내 PDF의 Tagged PDF 비율은 얼마인가 → §6.4 트랙 A 적중률이 곧 PDF 난이도
- U-03: HWP 5.0 실문서 텍스트 추출 성공률 → 80% 미만이면 v1에서 `.hwp` 제외

---

## 1. 개요

### 1.1 정의

파일 두 개를 드래그앤드롭 → 브라우저 안에서 파싱·비교 → git diff 스타일 변경점 표시.

### 1.2 핵심 원칙

| 원칙 | 구현상 의미 |
|---|---|
| **서버 무전송** | `fetch`로 파일 바이트를 보내는 코드가 한 줄도 없어야 한다. CI에 정적 검사 추가 |
| **오탐 최소화** | "같은 문서 → 변경점 0"이 최상위 회귀 테스트 |
| **정직한 한계** | 신뢰도가 낮으면 경고 배너. 조용히 틀리지 않는다 |
| **취소 가능** | 모든 장기 작업은 `AbortSignal`을 받는다 |

### 1.3 범위

**v1 포함**
- 동일 확장자 2개 → 비교 모드 (Split / Unified)
- 확장자 상이 또는 1개 → 뷰어 모드
- 형식: `.txt` `.md` `.docx` `.pdf` `.hwpx` `.hwp`
- 블록 단위 + 어절 단위 2단계 diff
- 비교 옵션 토글, 변경점 네비게이션, 요약 바, 미니맵

**v1 제외**
- 계정·저장·히스토리, 서식 변경 감지, 이미지 diff, 표 셀 단위 diff
- 문단 이동(move) 감지, OCR, 3-way diff, 형식 교차 비교

### 1.4 지원 형식 매트릭스

| 확장자 | 파싱 난이도 | v1 | 비교 | 뷰어 | 비고 |
|---|---|---|---|---|---|
| `.txt` | ★☆☆☆☆ | ✅ | ✅ | ✅ | CP949 인코딩 감지 필수 |
| `.md` | ★☆☆☆☆ | ✅ | ✅ | ✅ | `.txt`와 같은 `text` 그룹으로 상호 비교 허용 |
| `.docx` | ★★☆☆☆ | ✅ | ✅ | ✅ | `.doc`는 미지원 |
| `.hwpx` | ★★★☆☆ | ✅ | ✅ | ✅ | ZIP+XML |
| `.pdf` | ★★★★★ | ✅ | ⚠️ | ✅ | 스캔본은 비교 불가 |
| `.hwp` | ★★★★★ | ⚠️ | ⚠️ | ✅ | 스파이크 결과에 따라 축소 가능 |

---

## 2. 기능 명세

### 2.1 모드 결정 로직 (구현 가능한 형태)

```ts
// src/core/mode.ts
export type FormatGroup = 'text' | 'docx' | 'pdf' | 'hwp';

const EXT_TO_GROUP: Record<string, FormatGroup> = {
  txt: 'text', md: 'text', markdown: 'text',
  docx: 'docx',
  pdf: 'pdf',
  hwp: 'hwp', hwpx: 'hwp',
};

export type Mode =
  | { kind: 'empty' }
  | { kind: 'viewer-single'; file: File }
  | { kind: 'viewer-split'; a: File; b: File; reason: 'group-mismatch' }
  | { kind: 'compare'; a: File; b: File; group: FormatGroup; warn?: 'cross-format' };

export function decideMode(files: File[]): Mode {
  if (files.length === 0) return { kind: 'empty' };
  if (files.length === 1) return { kind: 'viewer-single', file: files[0] };
  if (files.length > 2) throw new AppError('TOO_MANY_FILES');

  const [a, b] = files;
  const ga = groupOf(a), gb = groupOf(b);
  if (ga !== gb) return { kind: 'viewer-split', a, b, reason: 'group-mismatch' };

  // 같은 그룹이지만 확장자가 다른 경우 (hwp vs hwpx, txt vs md)
  const warn = extOf(a) !== extOf(b) ? 'cross-format' : undefined;
  return { kind: 'compare', a, b, group: ga, warn };
}
```

**규칙 요약**
- 확장자는 소문자로 정규화
- `txt` ↔ `md` 비교 허용 (둘 다 순수 텍스트)
- `hwp` ↔ `hwpx` 비교 허용하되 `cross-format` 경고
- 그 외 그룹이 다르면 뷰어 분할

### 2.2 기능 목록과 우선순위

| ID | 기능 | 모드 | P | 마일스톤 |
|---|---|---|---|---|
| F-01 | 드래그앤드롭 / 파일 선택 (2슬롯) | 전체 | P0 | M1 |
| F-02 | Unified 뷰 | 비교 | P0 | M1 |
| F-03 | Split 뷰 + 동기 스크롤 | 비교 | P0 | M2 |
| F-04 | 변경 요약 바 (`+n / −m / ~k`) | 비교 | P0 | M2 |
| F-05 | 변경점 점프 (`n`/`p`, 버튼) | 비교 | P0 | M2 |
| F-06 | 경고 배너 (파싱 warnings) | 전체 | P0 | M2 |
| F-07 | 진행률 + 취소 | 전체 | P0 | M1 |
| F-08 | 비교 옵션 토글 (공백/구두점/대소문자) | 비교 | P1 | M5 |
| F-09 | 동일 구간 접기 | 비교 | P1 | M5 |
| F-10 | 미니맵 | 비교 | P1 | M5 |
| F-11 | 좌우 스왑 | 비교 | P2 | M5 |
| F-12 | 뷰어 렌더링 (형식별) | 뷰어 | P0 | M5 |
| F-13 | 다크모드 / i18n(ko·en) | 전체 | P1 | M5 |
| F-14 | 결과 내보내기 | 비교 | P2 | v2 |

### 2.3 단축키

| 키 | 동작 |
|---|---|
| `n` / `j` | 다음 변경점 |
| `p` / `k` | 이전 변경점 |
| `s` | Split ↔ Unified 전환 |
| `w` | 공백 무시 토글 |
| `Esc` | 처리 취소 / 초기화 |
| `?` | 단축키 도움말 |

---

## 3. 데이터 모델

이 장의 타입은 **구현의 계약**이다. 파서·정규화·diff·UI가 모두 이 타입만 주고받는다.

### 3.1 NormalizedDoc

```ts
// src/core/types.ts

export type Format = 'txt' | 'md' | 'docx' | 'pdf' | 'hwp' | 'hwpx';

export type BlockType =
  | 'heading' | 'paragraph' | 'listItem'
  | 'table' | 'code' | 'quote'
  | 'image' | 'pageBreak';

export interface StyleHint {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  align?: 'left' | 'center' | 'right' | 'justify';
  fontSize?: number;   // pt
  fontName?: string;
}

export interface BlockSource {
  page?: number;        // 1-based. HWP는 페이지 개념이 없어 undefined
  section?: number;     // HWP/HWPX 구역 번호
  charOffset: number;   // 원문 내 누적 문자 위치
  bbox?: [number, number, number, number]; // PDF 전용 [x0,y0,x1,y1]
}

export interface Block {
  id: string;           // §3.2 규칙
  type: BlockType;
  level?: number;       // heading 1~6 / listItem depth 0~
  text: string;         // 정규화 완료. **diff의 유일한 입력**
  rawText: string;      // 정규화 전 원문. 렌더링·디버깅·옵션 재적용용
  style?: StyleHint;    // v1에서는 렌더링에만 사용
  source: BlockSource;
}

export type WarningCode =
  // 공통
  | 'LARGE_FILE' | 'PARTIAL_PARSE' | 'ENCRYPTED' | 'UNSUPPORTED_VERSION'
  | 'TABLE_FLATTENED' | 'ENCODING_GUESS'
  // PDF
  | 'SCANNED_PDF' | 'MULTI_COLUMN_GUESS' | 'HEADER_FOOTER_REMOVED'
  | 'PAGE_BREAK_MERGED' | 'ROTATED_TEXT' | 'STRUCT_TREE_MISSING' | 'GARBLED_TEXT'
  // HWP
  | 'HWP_DISTRIBUTION_DOC' | 'HWP_UNKNOWN_TAG' | 'HWP_NO_PAGE_INFO'
  | 'HWPX_SECTION_MISSING';

export interface ParseWarning {
  code: WarningCode;
  severity: 'info' | 'warn' | 'error';
  message: string;      // 사용자에게 그대로 보여줄 한국어 문장
  page?: number;
  detail?: string;      // 개발자용
}

export interface NormalizedDoc {
  format: Format;
  meta: {
    fileName: string;
    fileSize: number;
    pageCount?: number;
    sectionCount?: number;
    parsedAt: number;
    parserVersion: string;   // 'pdf@3' 등. 캐시 무효화 키
    extractionTrack?: 'A' | 'B' | 'C';  // PDF 전용 (§6.4)
  };
  blocks: Block[];
  warnings: ParseWarning[];
  confidence: number;   // 0.0 ~ 1.0
}
```

### 3.2 Block ID 규칙

```ts
// 안정적이면서 충돌하지 않아야 한다. 같은 내용이 반복되는 문서가 흔하므로
// 내용만으로 해시하면 안 되고, 순번을 섞는다.
export function makeBlockId(text: string, index: number): string {
  return `${index.toString(36)}-${fnv1a(text).toString(36)}`;
}
```

React key, 스크롤 앵커, diff 결과 참조에 모두 이 id를 쓴다.

### 3.3 신뢰도(confidence) 산정

| 조건 | 값 |
|---|---|
| PDF 트랙 A (구조 트리 성공) | 0.95 |
| PDF 트랙 B (기하 재조립), 다단 아님, 경고 없음 | 0.80 |
| PDF 트랙 B, `MULTI_COLUMN_GUESS` 있음 | 0.60 |
| PDF `GARBLED_TEXT` | 0.0 → **비교 차단** |
| PDF 트랙 C (스캔본) | 0.0 → **비교 차단** |
| DOCX / HWPX | 0.95 |
| HWP 5.0 정상 파싱 | 0.85 |
| HWP `HWP_UNKNOWN_TAG` 다수 | 0.60 |
| TXT (인코딩 확신) / MD | 1.0 |
| TXT (`ENCODING_GUESS`) | 0.7 |

**UI 규칙**
- `confidence < 0.7` → 노란 경고 배너
- `confidence == 0` → 비교 차단, 뷰어 모드 안내
- 두 문서의 신뢰도가 다르면 낮은 쪽을 표시

### 3.4 Diff 결과 타입

```ts
export type ChangeKind = 'equal' | 'insert' | 'delete' | 'modify';

export interface InlineSpan {
  kind: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface DiffRow {
  kind: ChangeKind;
  left?: Block;          // delete / modify / equal
  right?: Block;         // insert / modify / equal
  inline?: InlineSpan[]; // modify 일 때만. 좌우 통합 스팬
  similarity?: number;   // modify 일 때 0~1
}

export interface DiffResult {
  rows: DiffRow[];
  stats: {
    insertBlocks: number;
    deleteBlocks: number;
    modifyBlocks: number;
    equalBlocks: number;
    insertChars: number;
    deleteChars: number;
  };
  changeIndices: number[]; // rows 배열 내 변경 행 인덱스 (네비게이션용)
  options: DiffOptions;
  truncated?: boolean;     // 타임아웃으로 중단됨
}
```

### 3.5 워커 프로토콜

```ts
// src/workers/protocol.ts
export interface WorkerApi {
  parse(input: {
    buffer: ArrayBuffer;      // transferable
    fileName: string;
    options: NormalizeOptions;
  }, onProgress: (p: Progress) => void): Promise<NormalizedDoc>;

  // 이미 파싱된 문서에 정규화 옵션만 다시 적용 (재파싱 없음)
  renormalize(doc: NormalizedDoc, options: NormalizeOptions): Promise<NormalizedDoc>;

  diff(a: NormalizedDoc, b: NormalizedDoc, options: DiffOptions): Promise<DiffResult>;
}

export interface Progress {
  phase: 'reading' | 'parsing' | 'normalizing' | 'diffing';
  current: number;
  total: number;
  label?: string;   // '32/120 페이지'
}
```

- Comlink로 노출. `ArrayBuffer`는 transfer로 넘겨 복사 비용 제거
- 취소는 `Comlink.proxy`로 넘긴 `shouldAbort()` 콜백을 워커가 페이지마다 확인하는 방식 (AbortSignal은 워커 경계를 못 넘음)

### 3.6 아키텍처 다이어그램

```
UI (React)                     Worker (Comlink)
─────────                      ────────────────
uploadStore ──parse(buf)──────▶ router(ext)
                                  ├─ txt/md   ─┐
                                  ├─ docx     ─┤
                                  ├─ pdf      ─┼─▶ NormalizedDoc
                                  ├─ hwpx     ─┤       │
                                  └─ hwp      ─┘       ▼
                                              normalize(options)
docStore  ◀────NormalizedDoc───────────────────┘
    │
    └──diff(a,b,opts)─────────▶ blockDiff → pairing → wordDiff
                                              │
diffStore ◀────DiffResult──────────────────────┘
    │
    └──▶ SplitView / UnifiedView (가상 스크롤)
```

**핵심**: `src/core/**` 는 DOM·React 의존성이 0이어야 한다. Node에서도 그대로 돌아야 테스트가 쉽다.

---

## 4. 텍스트 정규화

diff 오탐의 대부분이 여기서 결정된다.

### 4.1 옵션

```ts
export interface NormalizeOptions {
  ignoreWhitespace: boolean;   // 기본 true
  normalizePunct: boolean;     // 기본 true
  ignoreCase: boolean;         // 기본 false
  foldWidth: boolean;          // 전각→반각, 기본 true
  joinHyphen: boolean;         // PDF 기본 true, 그 외 false
}

export const DEFAULT_NORMALIZE: Record<FormatGroup, NormalizeOptions> = {
  text: { ignoreWhitespace: true,  normalizePunct: false, ignoreCase: false, foldWidth: false, joinHyphen: false },
  docx: { ignoreWhitespace: true,  normalizePunct: true,  ignoreCase: false, foldWidth: true,  joinHyphen: false },
  hwp:  { ignoreWhitespace: true,  normalizePunct: true,  ignoreCase: false, foldWidth: true,  joinHyphen: false },
  pdf:  { ignoreWhitespace: true,  normalizePunct: true,  ignoreCase: false, foldWidth: true,  joinHyphen: true  },
};
```

### 4.2 파이프라인 (순서 고정)

```ts
// src/core/normalize.ts
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;
const SMART_QUOTES: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/[\u2026]/g, '...'],
];

export function normalizeText(raw: string, o: NormalizeOptions): string {
  let s = raw;
  s = s.normalize('NFC');                 // 1. 자모 분리 복원 — PDF/macOS 필수
  s = s.replace(ZERO_WIDTH, '');          // 2. 제로폭·소프트하이픈 제거
  s = s.replace(/\r\n?/g, '\n');          // 3. 개행 통일
  if (o.foldWidth) s = foldFullWidth(s);  // 4. 전각 영숫자/기호 → 반각
  if (o.joinHyphen) s = s.replace(/([A-Za-z])-\n([a-z])/g, '$1$2'); // 5. 라틴 하이픈 결합
  if (o.normalizePunct) for (const [re, to] of SMART_QUOTES) s = s.replace(re, to);
  if (o.ignoreWhitespace) s = s.replace(/[ \t\u00A0\u3000]+/g, ' ');  // 6.
  s = s.split('\n').map(l => l.trim()).join('\n').trim();             // 7.
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}
```

**주의사항**
- `NFC`는 옵션이 아니라 **항상** 적용한다. macOS·PDF에서 한글이 NFD로 들어오는 경우가 흔하고, 이걸 놓치면 "한글"과 "한글"이 다른 문자열이 된다
- `\u00AD`(soft hyphen)는 눈에 안 보이지만 diff를 깨뜨린다. 반드시 제거
- `\u3000`(전각 공백)은 국내 문서에 대량으로 들어 있다
- 정규화 후 `text`가 빈 문자열인 블록은 `blocks`에서 제거한다

### 4.3 옵션 변경 시 동작

파서는 항상 `rawText`를 채운다. 사용자가 옵션 토글을 바꾸면 **재파싱 없이** `renormalize()`만 호출하고 diff를 다시 돌린다. 대용량 PDF에서 이 차이가 8초 vs 0.5초다.

---

## 5. Diff 엔진

### 5.1 3단계 전략

```
1단계  블록 배열 LCS (Myers)          → equal / insert / delete
2단계  인접 delete·insert 블록 짝짓기  → modify 로 승격
3단계  modify 쌍의 어절 diff          → inline 스팬
```

### 5.2 1단계 — 블록 LCS

```ts
import { diffArrays } from 'diff';

const raw = diffArrays(
  a.blocks.map(b => b.text),
  b.blocks.map(b => b.text),
);
```

- 블록 수가 `MAX_BLOCKS_FOR_MYERS`(= 8000)를 넘으면 **앵커 기반 분할**로 전환:
  전체에서 유일하게 등장하는 블록(양쪽에 정확히 1번씩)을 앵커로 잡고, 앵커 사이 구간만 국소 LCS. patience diff의 단순화 버전이며 대용량 문서에서 필수다

### 5.3 2단계 — 블록 짝짓기

```ts
// src/core/diff/pairing.ts
const SIM_THRESHOLD = 0.5;

// 인접한 delete 그룹 D와 insert 그룹 I 에 대해 그리디 매칭
export function pairBlocks(dels: Block[], ins: Block[]): Pairing[] {
  const pairs: Pairing[] = [];
  const usedIns = new Set<number>();
  for (let i = 0; i < dels.length; i++) {
    let best = -1, bestSim = SIM_THRESHOLD;
    // 위치 편차 3 이내만 후보로 봐서 O(n²) 폭발을 막는다
    for (let j = Math.max(0, i - 3); j < Math.min(ins.length, i + 4); j++) {
      if (usedIns.has(j)) continue;
      const sim = diceCoefficient(dels[i].text, ins[j].text);
      if (sim > bestSim) { bestSim = sim; best = j; }
    }
    if (best >= 0) { pairs.push({ left: i, right: best, sim: bestSim }); usedIns.add(best); }
  }
  return pairs;
}

// 바이그램 기반. 한국어에서도 잘 동작한다.
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s: string) => { const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
    return m; };
  const A = bg(a), B = bg(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}
```

### 5.4 3단계 — 한국어 대응 인라인 diff

**문제**: 영어는 공백 분리가 자연스럽지만 한국어는 조사가 붙는다. "계약서를"과 "계약서는"을 어절 단위로 diff하면 단어 전체가 통째로 바뀐 것처럼 보인다.

**해법 — 2.5단계 재귀 diff**

```ts
// src/core/diff/wordDiff.ts
export function inlineDiff(left: string, right: string): InlineSpan[] {
  // 1) 어절(공백) 단위 diff
  const words = diffWordsWithSpace(left, right);

  const out: InlineSpan[] = [];
  for (let i = 0; i < words.length; i++) {
    const cur = words[i], nxt = words[i + 1];
    // 2) 인접한 remove+add 어절 쌍이고, 유사도가 높으면 문자 단위로 재분해
    if (cur.removed && nxt?.added) {
      const sim = diceCoefficient(cur.value, nxt.value);
      if (sim >= 0.4) {
        out.push(...diffChars(cur.value, nxt.value).map(toSpan));
        i++; // nxt 소비
        continue;
      }
    }
    out.push(toSpan(cur));
  }
  return mergeAdjacent(out);
}
```

이 처리 하나로 한국어 diff 품질이 눈에 띄게 달라진다. **반드시 넣는다.**

### 5.5 가드

```ts
export const DIFF_LIMITS = {
  MAX_BLOCKS_FOR_MYERS: 8_000,
  MAX_TOTAL_BLOCKS: 100_000,     // 초과 시 거부
  TIMEOUT_MS: 10_000,            // 초과 시 truncated: true 로 부분 결과 반환
  MAX_INLINE_LEN: 5_000,         // 이보다 긴 블록은 인라인 diff 생략
};
```

타임아웃은 워커 안에서 `performance.now()`를 루프마다 확인하는 방식으로 구현한다.

### 5.6 알려진 한계 (문서화 필수)

- **문단 이동(move)을 감지하지 못한다.** 통째로 자리만 바뀐 문단은 삭제+추가로 표시된다. v2에서 처리
- 표는 평탄화되어 셀 단위 변경을 짚어주지 못한다
- 서식만 바뀐 변경(볼드 추가 등)은 감지하지 않는다

---
## 6. PDF 파이프라인

### 6.1 먼저 합의할 세 가지 사실

**(1) PDF에는 문단도, 단어 경계도, 읽기 순서도 저장돼 있지 않다.**
텍스트는 좌표에 찍힌 글리프의 나열이다. 우리가 보는 문단은 렌더링 결과일 뿐이고, 추출기가 좌표에서 역추론해야 한다.

**(2) `getTextContent()`의 반환 순서는 읽기 순서가 아니다.**
pdf.js는 PDF 내부에 기록된 순서를 그대로 돌려준다. mozilla/pdf.js #17191은 이 배열을 이어붙여 문자열로 만드는 것이 유효한 방법이 아니라고 명시한다. OCR을 거쳤거나 다른 포맷에서 변환된 문서는 시각적 최상단 텍스트가 배열 끝에 오기도 한다. #14493에는 페이지 첫 항목이 제목이 아닌 본문 문장이었고 `getStructTree()`로 확인하니 제목이 첫 객체였던 사례가 있다.
→ https://github.com/mozilla/pdf.js/issues/17191 · https://github.com/mozilla/pdf.js/issues/14493

**(3) "정답 읽기 순서"는 문서 종류마다 다르다.**
Apryse 문서가 지적하듯 잡지·신문·학술논문의 읽기 순서는 서로 다르고 PDF에는 이를 판별할 의미 정보가 없다. **완벽한 재조립은 원리적으로 불가능하다.** 우리는 "실무 문서 대부분에서 맞는" 휴리스틱을 만들고 확신이 낮으면 경고한다.
→ https://docs.apryse.com/web/guides/extraction/text-extract

### 6.2 라이브러리 선택

| 후보 | 라이선스 | 판정 |
|---|---|---|
| **pdfjs-dist** | Apache-2.0 | **채택.** 추출·렌더링을 하나로 해결. 문단 재조립은 자체 구현 |
| mupdf (MuPDF.js) | **AGPL / 상용** | `toStructuredText().asJSON()`으로 bbox·폰트가 붙은 구조화 텍스트를 바로 주고 기본 CJK를 지원해 매력적이지만, AGPL은 네트워크 이용 시 전체 소스 공개를 요구한다. **클로즈드로 갈 계획이면 의존성에 넣지 말 것** (나중에 걷어내는 비용이 크다) |
| Nutrient / Apryse | 상용 | 품질 최상, OCR 내장. 유료 + 서버 왕복 → D-01 위배 |

### 6.3 상수

```ts
// src/core/parsers/pdf/constants.ts
export const PDF = {
  LINE_Y_TOLERANCE_RATIO: 0.3,    // 같은 라인 판정: y차 < median(height)*0.3
  SPACE_GAP_RATIO: 0.3,           // x간격 > 평균문자폭*0.3 이면 공백 삽입
  PARA_GAP_RATIO: 1.5,            // 수직간격 > median(행간)*1.5 이면 문단 분리
  LINE_FULL_RATIO: 0.95,          // 라인 끝이 우측경계의 95% 이상 = 자연 줄바꿈
  COLUMN_GUTTER_RATIO: 0.03,      // 세로 여백 띠 폭 > 페이지폭*3% 이면 단 분리
  COLUMN_MIN_LINES: 5,            // 컬럼 후보 최소 라인 수 (표 오탐 방지)
  HEADER_ZONE: 0.10,              // 상단 10%
  FOOTER_ZONE: 0.10,              // 하단 10%
  HEADER_REPEAT_RATIO: 0.6,       // 60% 이상 페이지에서 반복 → 머리말
  MIN_PAGES_FOR_HEADER_DETECT: 3,
  SCAN_CHARS_PER_PAGE: 50,        // 이 미만 → 스캔본 확정
  SUSPECT_CHARS_PER_PAGE: 200,    // 이 미만 → 부분 스캔 의심
  DUP_COORD_EPS: 1.0,             // 1pt 이내 동일 문자열 = 그림자 효과, 병합
  MAX_PAGES: 1_000,
} as const;

export const SENTENCE_END = /[.?!。]$|[다요임함음](\.)?$|[:;]$/;
export const BULLET_START = /^\s*([①-⑳]|[가-힣]\.|\d+[.)]|[-•·▪○□◇◆■▶*])\s/;
```

### 6.4 3-트랙 추출

```
트랙 A  page.getStructTree() 가 유효한가?
        └─ Yes → 태그를 Block 으로 직결 매핑. confidence 0.95
트랙 B  getTextContent() 기하 재조립 (§6.5). confidence 0.60~0.80
트랙 C  텍스트 밀도 미달 → 스캔본. confidence 0, 비교 차단
```

**트랙 A를 먼저 붙여라.** 태그된 PDF는 문단 경계가 파일에 이미 있어 휴리스틱이 전혀 필요 없다. Word에서 내보낸 PDF와 접근성을 지킨 공공 PDF 상당수가 여기 해당한다. 구현 난이도도 훨씬 낮으므로 M3 첫 주에 완성한다.

```ts
// src/core/parsers/pdf/structTree.ts
const TAG_TO_BLOCK: Record<string, BlockType> = {
  H1: 'heading', H2: 'heading', H3: 'heading',
  H4: 'heading', H5: 'heading', H6: 'heading', H: 'heading',
  P: 'paragraph', LI: 'listItem', LBody: 'listItem',
  Table: 'table', TD: 'table', TH: 'table',
  Code: 'code', BlockQuote: 'quote', Figure: 'image',
};

export async function extractViaStructTree(page: PDFPageProxy): Promise<Block[] | null> {
  const tree = await page.getStructTree();
  if (!tree || !hasTextTags(tree)) return null;   // 폴백 신호

  // marked-content id → 텍스트 아이템 매핑이 필요하다
  const content = await page.getTextContent({ includeMarkedContent: true });
  const byMcid = buildMcidIndex(content.items);   // Map<number, string>

  return walk(tree, byMcid);
}
```

> **함정**: `getTextContent()`의 순서와 `getStructTree()`의 순서가 어긋나는 사례가 보고돼 있다(#14493). 반드시 `includeMarkedContent: true`로 받아 **mcid로 연결**하고, 순서는 구조 트리 쪽을 신뢰한다.

### 6.5 트랙 B — 기하 재조립 (6단계)

#### 단계 0. 아이템 정규화

```ts
interface PdfItem {
  str: string;
  x: number; y: number;          // transform[4], transform[5]
  width: number; height: number;
  fontName: string;
  rotation: number;              // transform 행렬에서 유도
  invisible: boolean;            // Tr 3 (OCR 레이어일 수 있음)
}

function toItem(raw: TextItem): PdfItem {
  const [a, b, , , e, f] = raw.transform;
  return {
    str: raw.str, x: e, y: f,
    width: raw.width, height: raw.height,
    fontName: raw.fontName,
    rotation: Math.round(Math.atan2(b, a) * 180 / Math.PI),
    invisible: false,
  };
}
```

- **회전 아이템을 버리지 마라.** 90°로 눕힌 세로 표 머리글·사이드 탭 목차가 국내 예산서·공고문에 흔하다. 숨김 텍스트로 오인해 제거하면 표 전체가 유실된다. `rotation !== 0`인 아이템은 각도별로 그룹핑해 별도 블록으로 만들고 `ROTATED_TEXT` 경고
- **invisible 텍스트도 버리지 마라.** 스캔+OCR PDF는 그게 본문이다

#### 단계 1. 라인 그룹핑

```
1. rotation === 0 인 아이템만 대상 (나머지는 별도 처리)
2. medianHeight = median(items.map(i => i.height))
3. y 내림차순 정렬 후, |y_i - y_line| < medianHeight * 0.3 이면 같은 라인
4. 라인 내부는 x 오름차순 정렬
5. 아이템 사이 gap = x_next - (x_cur + width_cur)
   gap > avgCharWidth * 0.3  → 공백 1개 삽입
   (PDF는 공백을 문자로 넣지 않고 좌표 이동으로 표현하는 경우가 많다)
```

#### 단계 2. 다단 조판 감지 (XY-cut)

```
1. 페이지 폭을 1pt 단위 빈으로 나눠 x축 투영 히스토그램 계산
2. 값이 0인 연속 구간(세로 여백 띠) 중 폭 > pageWidth * 0.03 인 것을 분리선 후보로
3. 좌우 영역 각각의 라인 수가 COLUMN_MIN_LINES(5) 이상일 때만 컬럼으로 인정
   → 표가 세로 여백을 만들어 오탐하는 것을 막는다
4. 컬럼 ≥ 2 이면 MULTI_COLUMN_GUESS 경고 + confidence 0.60
5. 읽기 순서 = 컬럼 좌→우, 각 컬럼 내 위→아래
```

#### 단계 3. 머리말/꼬리말 제거

```
전제: pageCount >= 3
1. 각 페이지의 상단 10% / 하단 10% 영역 라인을 수집
2. 정규화 키 생성: 숫자를 '#'로 마스킹  ('- 12 -' → '- # -')
3. 같은 키가 전체 페이지의 60% 이상에서 등장하면 머리말/꼬리말로 확정
4. 해당 라인 제거 + HEADER_FOOTER_REMOVED 경고(info) + detail 에 제거 목록 기록
```

이걸 안 하면 두 문서의 머리말이 조금만 달라도 페이지 수만큼 변경점이 생긴다.

#### 단계 4. 문단 병합

앞 라인과 현재 라인이 **아래를 모두 만족할 때만** 잇는다.

| 조건 |
|---|
| 수직 간격 < `median(행간) × 1.5` |
| 앞 라인이 `SENTENCE_END`에 매치되지 않음 |
| 앞 라인 우측 끝이 본문 우측 경계의 95% 이상 도달 (강제 줄바꿈이 아님) |
| 현재 라인이 `BULLET_START`로 시작하지 않음 |
| 폰트명과 폰트 크기가 동일 |

보수적으로 끊는다. 잘못 이어붙이는 것이 잘못 끊는 것보다 diff 품질을 더 크게 해친다.

**heading 승격**: 라인 길이가 짧고(< 평균의 60%) 폰트 크기가 본문보다 크고 다음 라인과 간격이 크면 `heading`. level은 폰트 크기 순위로 1~3 배정.

#### 단계 5. 후처리

- **중복 제거**: 볼드·그림자 효과를 위해 같은 글자를 1pt 어긋난 좌표에 두 번 그리는 PDF가 있다. `DUP_COORD_EPS` 이내 + 동일 문자열이면 하나로 병합
- **하이픈 결합**: 라틴 문자에만 적용 (한국어는 하이픈 줄바꿈이 거의 없다)

#### 단계 6. 페이지 경계 문단 병합 ★

```ts
// src/core/parsers/pdf/pageJoin.ts
// 페이지 단위 파싱 결과를 문서 단위로 이어붙이는 명시적 단계.
// 이걸 빼먹으면 "페이지 나눔 위치만 다른 같은 문서"가 전부 다르게 나온다.
export function joinAcrossPages(pages: Block[][]): Block[] {
  const out: Block[] = [];
  for (const page of pages) {
    const prev = out[out.length - 1];
    const first = page[0];
    if (prev && first &&
        prev.type === 'paragraph' && first.type === 'paragraph' &&
        !SENTENCE_END.test(prev.text) &&
        !BULLET_START.test(first.text)) {
      prev.text += ' ' + first.text;
      prev.rawText += ' ' + first.rawText;
      out.push(...page.slice(1));
      // PAGE_BREAK_MERGED 경고(info)
    } else {
      out.push(...page);
    }
  }
  return out;
}
```

### 6.6 한국어 PDF 특유 문제

#### (1) ToUnicode 오매핑 → 조용한 mojibake ★★★

한국어 PDF는 CID 폰트를 쓰는데 `ToUnicode` CMap이 없거나 잘못되면 **추출 텍스트가 엉뚱한 한글로 나온다.** 렌더링은 멀쩡한데 복사하면 깨지는 그 현상이다. opendataloader-pdf #166에 한국어 임베디드 폰트에서 잘못된 문자가 추출되는 사례가 보고돼 있다.
→ https://github.com/opendataloader-project/opendataloader-pdf/issues/166

**위험한 이유**: 추출이 실패하지 않고 **그럴듯한 쓰레기 문자열을 반환**한다. 예외가 안 나므로 그대로 diff로 흘러가고 화면 전체가 빨개진다.

**탐지 구현**

```ts
// src/core/parsers/pdf/hangulSanity.ts
const SYLLABLE = /[\uAC00-\uD7A3]/;
const JAMO = /[\u3131-\u318E]/;

/** 한글 음절의 종성(받침) 인덱스. 0 = 받침 없음 */
function jongseong(ch: number): number {
  return (ch - 0xAC00) % 28;
}

export function detectGarbledHangul(text: string): boolean {
  const syl = [...text].filter(c => SYLLABLE.test(c));
  if (syl.length < 100) return false;                    // 표본 부족
  if (syl.length / text.length < 0.3) return false;      // 한글 문서가 아님

  // 1) 받침 없는 음절 비율: 정상 한국어는 대략 40~55%
  const noJong = syl.filter(c => jongseong(c.charCodeAt(0)) === 0).length / syl.length;
  if (noJong < 0.15 || noJong > 0.80) return true;

  // 2) 종성 분포 엔트로피: 무작위 CID 매핑은 균등분포에 가까워진다
  const counts = new Array(28).fill(0);
  for (const c of syl) counts[jongseong(c.charCodeAt(0))]++;
  const H = entropy(counts) / Math.log2(28);             // 0~1 정규화
  if (H > 0.92) return true;

  // 3) 단독 자모(ㄱ, ㅏ 등)가 비정상적으로 많으면 자모 분리/깨짐
  const jamo = [...text].filter(c => JAMO.test(c)).length;
  if (jamo / text.length > 0.05) return true;

  return false;
}
```

판정 시 → `GARBLED_TEXT` 경고(error) + `confidence = 0` + **비교 차단**. 사용자에게는 "이 PDF는 폰트 정보 문제로 텍스트를 정확히 읽을 수 없습니다"라고 안내한다.

> 이 접근은 kordoc이 실제로 채택한 것과 같다. 해당 프로젝트는 ToUnicode 오매핑으로 정상 한글 영역에 엉뚱한 글자가 무경고 통과하던 문제를 **종성 분포 신호로 감지**해 페이지별 OCR 필요 경고를 띄우도록 고쳤다고 밝히고 있다. → https://www.npmjs.com/package/kordoc

#### (2) 자모 분리(NFD)
맥에서 만든 PDF는 한글이 NFD로 들어오는 경우가 있다. §4.2 규칙 1의 `NFC`가 이걸 처리한다. 빼먹으면 안 된다.

#### (3) 괘선 없는 표
국내 예산서·명세서는 선 없이 공백 정렬만으로 표를 만든다. v1에서는 표 인식을 **시도하지 않고**, 한 라인 안에 3개 이상의 큰 x 간격이 있으면 `TABLE_FLATTENED` 경고만 띄운다.

### 6.7 PDF diff 고유의 함정

| 원인 | 증상 | 대응 |
|---|---|---|
| 다른 프린터·드라이버로 출력 | 자간·행간 미세 차이로 라인 그룹핑이 갈림 | 좌표를 diff에 쓰지 않음 (D-03) |
| 한쪽만 머리말/꼬리말 있음 | 페이지 수만큼 변경점 | §6.5 단계 3 |
| **페이지 나눔 위치가 다름** | 문단이 잘려 두 블록이 됨 | §6.5 단계 6 — **가장 흔하고 가장 치명적** |
| 한쪽만 워터마크 | 페이지마다 한 블록씩 추가 | 머리말/꼬리말 로직이 일부 잡음. 나머지는 한계로 문서화 |

### 6.8 스캔 PDF · 암호화 PDF

**스캔 판정**
```
밀도 = 전체 추출 문자 수 / 페이지 수
밀도 < 50   → 스캔본 확정 (트랙 C)
50 ≤ 밀도 < 200 → 부분 스캔 의심, 경고 후 진행
+ 페이지 면적의 80% 이상을 이미지 XObject가 차지하면 가중치 상향
```

- 스캔 PDF는 **비교 차단**, 뷰어 모드로만 제공
- 브라우저 OCR(Tesseract.js)은 페이지당 수 초라 100페이지에서 UX가 붕괴한다. **v1에서 하지 않는다**
- 한쪽만 스캔본인 경우(원본 vs 인쇄 후 스캔)가 실제로 흔하다. **어느 쪽이 문제인지 파일명으로 명시**한다

**암호화·손상**

| 상황 | pdf.js | 대응 |
|---|---|---|
| 열기 암호 | `PasswordException` | 비밀번호 모달 (로컬 처리임을 명시) |
| 권한 암호 | 열리나 추출 제한 가능 | 실패 시 `ENCRYPTED` 경고 |
| 손상/절단 | `InvalidPDFException` | "파일이 손상되었습니다" |
| XFA 폼 | 텍스트 거의 없음 | `UNSUPPORTED_VERSION` 경고 |

### 6.9 성능

- 페이지 단위 스트리밍: `getPage(i)` → 추출 → **`page.cleanup()` 즉시 호출**. 전 페이지를 메모리에 들지 않는다
- 페이지마다 `onProgress({ phase:'parsing', current:i, total:n })`
- **중첩 워커 문제**: 우리는 이미 워커 안에 있는데 pdf.js가 또 워커를 띄우려 한다. 번들러에서 자주 깨진다. `GlobalWorkerOptions.workerSrc`를 명시 설정하고, 실패 시 `disableWorker`로 폴백하는 경로를 M3 첫날에 검증한다
- 목표: 100페이지 8초, 500페이지 30초(취소 가능)

### 6.10 M3 종료 조건 (전부 통과해야 닫는다)

| # | 항목 | 기준 |
|---|---|---|
| 1 | 동일 PDF 자기 비교 (픽스처 30개) | 변경점 0 |
| 2 | 같은 원본을 다른 도구로 출력한 쌍 (5쌍) | 변경점 0 또는 공백 차이만 |
| 3 | 한 단어만 수정한 쌍 | 해당 어절만 인라인 표시 |
| 4 | 태그된 PDF | 트랙 A 처리 + heading 계층 보존 |
| 5 | 2단 조판 논문 (5건) | 읽기 순서 수동 검증 통과 |
| 6 | 한글 CID 폰트 PDF (5건) | 정상 추출 또는 `GARBLED_TEXT` 정확 판정 |
| 7 | 스캔 PDF (3건) | 100% 트랙 C 판정, 비교 차단 |
| 8 | 페이지 나눔 위치가 다른 쌍 (3쌍) | 문단이 끊기지 않음 |
| 9 | 머리말/꼬리말 문서 | diff에 나타나지 않음 |
| 10 | 300페이지 문서 | 30초 이내, 크래시 없음 |

---

## 7. HWP / HWPX 파이프라인

국내 서비스의 최대 차별점이자 두 번째 난관. **HWPX를 먼저, HWP 5.0을 나중에** 구현한다.

### 7.1 두 포맷의 난이도 차이

| | HWPX | HWP 5.0 |
|---|---|---|
| 컨테이너 | ZIP (OPC) | CFB / OLE2 복합 문서 |
| 본문 | XML (OWPML, KS X 6101) | zlib 압축된 바이너리 레코드 |
| 파싱 | JSZip + DOMParser | CFB 리더 + pako + 레코드 파서 + UTF-16 제어문자 해석 |
| 예상 공수 | **3일** | **2주** |

한컴테크도 같은 취지로 설명한다. HWP는 스트림이 레코드 형식이라 별도 분석 과정이 필요한 반면 HWPX는 주요 파일이 XML이라 데이터 추출이 용이하다.
→ https://tech.hancom.com/hwpxformat/

**따라서 M4는 HWPX부터 시작하고, HWP 5.0은 그 다음이며, 일정이 밀리면 HWP를 잘라낸다.**

### 7.2 라이브러리 vs 자체 구현

| 후보 | 판정 |
|---|---|
| `hahnlee/hwp.js` | 최초의 브라우저 HWP 뷰어지만, 개발자가 유지보수 공지에서 커버리지 20% 수준이고 실무 문서에는 역부족이며 배포용 문서는 파싱·렌더링이 불가하다고 밝혔다. **채택 불가** → https://github.com/hahnlee/hwp.js/issues/7 |
| `@ohah/hwpjs` | Rust 코어를 Node·Web(WASM)·React Native에서 쓰도록 제공하며 JSON·Markdown·HTML 변환 지원 명시. **폴백 후보 1순위** → https://github.com/ohah/hwpjs |
| `kordoc` | HWP3/5/HWPX/HWPML + PDF + Office를 마크다운과 `IRBlock[]`로 변환. 배포용 잠금 HWP 파싱, 손상 CFB 복구, 표 복원까지 갖춘 최고 커버리지. 다만 **CLI·MCP 중심 설계로 Node 전제**로 보인다(tsup ESM+CJS). 브라우저 구동 여부가 U-01 → https://github.com/chrisryugj/kordoc |
| **자체 구현** | HWPX는 자체가 압도적으로 쉽고 가볍다. HWP 5.0도 "텍스트만 뽑는다"로 범위를 좁히면 감당 가능하다. **v1 기본안** |

> **U-01 스파이크 결과에 따른 분기**
> - kordoc이 브라우저에서 돈다 → 파서 레이어 위임, 3주 절감, 우리는 정규화·diff·UI에 집중
> - 안 된다 → 아래 7.3~7.7을 그대로 구현
> - 절대 하지 말 것: HWP만 서버로 보내기. "업로드 안 함" 카피를 포기하게 되고 D-01이 무너진다

### 7.3 HWPX 파서 (자체 구현, 3일)

**패키지 구조**
```
document.hwpx (ZIP)
├── mimetype                      "application/hwp+zip"
├── version.xml
├── META-INF/container.xml
└── Contents/
    ├── content.hpf               패키지 매니페스트
    ├── header.xml                <hh:head secCnt="N">  ← 구역 개수
    ├── section0.xml              <hs:sec> 본문
    ├── section1.xml
    └── ...
```

header.xml 최상위 `head` 요소의 `secCnt` 속성으로 구역 개수를 알 수 있고, `section0.xml`부터 그 개수만큼 읽으면 된다.
→ https://tech.hancom.com/python-hwpx-parsing-2/

**본문 XML 구조**
```xml
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"
        xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:secPr>…페이지 설정…</hp:secPr>
  <hp:p paraPrIDRef="2" styleIDRef="0">
    <hp:run charPrIDRef="1">
      <hp:t>본문 텍스트</hp:t>
    </hp:run>
  </hp:p>
  <hp:p>
    <hp:run><hp:tbl>…표…</hp:tbl></hp:run>
  </hp:p>
</hs:sec>
```

**구현**

```ts
// src/core/parsers/hwpx.ts
import JSZip from 'jszip';

const NS_P = 'http://www.hancom.co.kr/hwpml/2011/paragraph';

export async function parseHwpx(buf: ArrayBuffer, ctx: ParseCtx): Promise<NormalizedDoc> {
  const zip = await JSZip.loadAsync(buf);

  // 1. 구역 개수
  const headerXml = await zip.file('Contents/header.xml')?.async('string');
  const secCnt = headerXml
    ? Number(new DOMParser().parseFromString(headerXml, 'application/xml')
        .documentElement.getAttribute('secCnt') ?? 1)
    : 1;

  const blocks: Block[] = [];
  const warnings: ParseWarning[] = [];
  let offset = 0;

  for (let s = 0; s < secCnt; s++) {
    const path = `Contents/section${s}.xml`;
    const xml = await zip.file(path)?.async('string');
    if (!xml) { warnings.push(warn('HWPX_SECTION_MISSING', 'warn', `${path} 없음`)); continue; }

    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const p of Array.from(doc.getElementsByTagNameNS(NS_P, 'p'))) {
      const { text, type, level } = readParagraph(p);
      if (!text.trim()) continue;
      blocks.push({
        id: makeBlockId(text, blocks.length),
        type, level,
        text: '',                 // normalize 단계에서 채움
        rawText: text,
        source: { section: s, charOffset: offset },
      });
      offset += text.length;
    }
    ctx.progress({ phase: 'parsing', current: s + 1, total: secCnt });
  }

  warnings.push(warn('HWP_NO_PAGE_INFO', 'info', 'HWPX는 페이지 정보를 저장하지 않아 페이지 번호를 표시하지 않습니다'));
  return { format: 'hwpx', meta: { …, sectionCount: secCnt, parserVersion: 'hwpx@1' },
           blocks, warnings, confidence: 0.95 };
}
```

**문단 읽기 규칙**

```ts
function readParagraph(p: Element): { text: string; type: BlockType; level?: number } {
  const parts: string[] = [];
  let hasTable = false;

  // 문서 순서대로 순회해야 한다. getElementsByTagName 만 쓰면 표 안팎 순서가 뒤섞인다.
  walkInOrder(p, (el) => {
    switch (el.localName) {
      case 't':         parts.push(el.textContent ?? ''); break;
      case 'tab':       parts.push('\t'); break;
      case 'lineBreak': parts.push('\n'); break;
      case 'tbl':       hasTable = true; break;   // 셀은 하위 t 로 자연히 수집됨
    }
  });

  const text = parts.join('');
  // 표는 셀 텍스트를 ' | ' 로 join 해 단일 블록으로 평탄화 (v1)
  if (hasTable) return { text: flattenTable(p), type: 'table' };

  const level = headingLevelOf(p);   // styleIDRef / paraPrIDRef 를 header.xml 스타일과 대조
  return { text, type: level ? 'heading' : (isListItem(p) ? 'listItem' : 'paragraph'), level };
}
```

- **`hp:tab`과 `ctrl id="tab"`은 탭 문자로 보존**한다. 공백으로 평탄화하면 표 정렬 정보가 사라진다
- heading 판정은 `header.xml`의 스타일 정의를 파싱해 스타일명이 "개요 1"·"제목 1" 등인지 대조한다. 스타일 파싱이 부담이면 v1에서는 전부 `paragraph`로 두고 진행해도 diff 품질에는 거의 영향이 없다

### 7.4 HWP 5.0 파서 (자체 구현, 2주)

#### 7.4.1 컨테이너

HWP 5.0은 마이크로소프트 복합 이진 파일(CFB / OLE2) 구조를 따른다. 주요 스트림은 다음과 같다.

```
FileHeader                     32B 시그니처 + 버전 + 속성 플래그
DocInfo                        문서 공통 정보 (글꼴, 스타일, 문단모양 …)
BodyText/Section0 … SectionN   본문. 구역별로 나뉜다
PrvText                        미리보기 순수 텍스트 ★ 폴백에 활용
PrvImage                       미리보기 이미지
\x05HwpSummaryInformation      요약 정보
DocOptions/_LinkDoc, Scripts/… 기타
```

BodyText 스토리지가 구역에 따라 `Section%d` 스트림으로 나뉜다는 점은 공식 포맷 문서에 명시돼 있다.
→ https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf

**CFB 리더**: 브라우저에서 쓸 수 있는 것으로 `cfb`(SheetJS) 패키지가 가장 검증돼 있다. 순수 JS이고 번들이 작다.

```ts
import * as CFB from 'cfb';
const container = CFB.read(new Uint8Array(buf), { type: 'array' });
const stream = (name: string) => CFB.find(container, name)?.content as Uint8Array | undefined;
```

#### 7.4.2 FileHeader 해석

```ts
// src/core/parsers/hwp/fileHeader.ts
const SIGNATURE = 'HWP Document File';

export interface HwpFileHeader {
  version: { major: number; minor: number; build: number; revision: number };
  compressed: boolean;
  passwordProtected: boolean;
  distributionDoc: boolean;   // 배포용(열람 제한) 문서
}

export function readFileHeader(fh: Uint8Array): HwpFileHeader {
  const sig = new TextDecoder('ascii').decode(fh.subarray(0, 17));
  if (sig !== SIGNATURE) throw new AppError('NOT_HWP');

  const dv = new DataView(fh.buffer, fh.byteOffset);
  // 32바이트 시그니처 영역 다음이 버전(4B), 그 다음이 속성 비트필드(4B)
  const ver = dv.getUint32(32, true);
  const props = dv.getUint32(36, true);

  return {
    version: { major: (ver >> 24) & 0xff, minor: (ver >> 16) & 0xff,
               build: (ver >> 8) & 0xff, revision: ver & 0xff },
    compressed:        !!(props & 0x01),
    passwordProtected: !!(props & 0x02),
    distributionDoc:   !!(props & 0x04),
  };
}
```

- `compressed`가 켜져 있으면 `DocInfo`와 `Section*`는 **raw deflate**(zlib 헤더 없음)로 압축돼 있다 → `pako.inflateRaw()`
- `passwordProtected` 또는 `distributionDoc`이면 §7.7로

#### 7.4.3 레코드 구조

DocInfo와 BodyText/SectionN은 연속된 레코드로 구성된다. 레코드는 헤더 + 페이로드이고 헤더는 태그 ID·레벨·크기로 이루어진다. 크기가 0xFFF(4095)이면 뒤따르는 4바이트가 실제 크기다.
→ https://github.com/hallazzang/hwp5-table-extractor/wiki

```
레코드 헤더 = UInt32 LE
  bits  0~9   tagID  (10 bit)
  bits 10~19  level  (10 bit)
  bits 20~31  size   (12 bit)

size == 0xFFF 이면 → 다음 UInt32 LE 가 실제 size
```

```ts
// src/core/parsers/hwp/record.ts
export interface HwpRecord { tagId: number; level: number; payload: DataView; }

export function* readRecords(buf: Uint8Array): Generator<HwpRecord> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  while (p + 4 <= buf.byteLength) {
    const h = dv.getUint32(p, true); p += 4;
    const tagId = h & 0x3ff;
    const level = (h >> 10) & 0x3ff;
    let size = (h >> 20) & 0xfff;
    if (size === 0xfff) { size = dv.getUint32(p, true); p += 4; }
    if (p + size > buf.byteLength) break;         // 손상 파일 방어
    yield { tagId, level, payload: new DataView(buf.buffer, buf.byteOffset + p, size) };
    p += size;
  }
}
```

#### 7.4.4 필요한 태그 ID만

`HWPTAG_BEGIN = 0x10 (16)` 기준. 텍스트 추출에 실제로 필요한 것만 다룬다.

| 상수 | 값 | 용도 |
|---|---|---|
| `HWPTAG_PARA_HEADER` | 66 | 문단 시작. 여기서 블록을 끊는다 |
| `HWPTAG_PARA_TEXT` | **67** | **실제 본문 텍스트** |
| `HWPTAG_PARA_CHAR_SHAPE` | 68 | 글자 모양 (v1 미사용) |
| `HWPTAG_CTRL_HEADER` | 71 | 컨트롤 (표·그림 등) |
| `HWPTAG_LIST_HEADER` | 72 | 표 셀 등 하위 리스트 시작 |
| `HWPTAG_TABLE` | 77 | 표 정보 (행·열 수) |

`HWPTAG_PARA_TEXT` 레코드에 실제 문단 텍스트가 담긴다는 점은 한컴테크 문서에서도 확인된다.
→ https://tech.hancom.com/python-hwp-parsing-2/

#### 7.4.5 PARA_TEXT 디코딩 ★ 핵심

페이로드는 **UTF-16LE 시퀀스**인데, 그 안에 제어 문자가 섞여 있다. 제어 문자마다 차지하는 WCHAR 수가 달라서, 이걸 모르면 텍스트가 통째로 오염된다.

```ts
// src/core/parsers/hwp/paraText.ts

// 1 WCHAR 만 차지하는 문자 컨트롤
const CHAR_CTRL = new Set([0,10,13,24,25,26,27,28,29,30,31]);
// 8 WCHAR 를 차지하는 인라인 컨트롤 (탭, 각주 등)
const INLINE_CTRL = new Set([4,5,6,7,8,9,19,20]);
// 8 WCHAR 를 차지하는 확장 컨트롤 (표, 그림, 구역정의 등)
const EXTENDED_CTRL = new Set([1,2,3,11,12,14,15,16,17,18,21,22,23]);

export function decodeParaText(payload: DataView): string {
  const out: string[] = [];
  const n = payload.byteLength >> 1;
  let i = 0;
  while (i < n) {
    const code = payload.getUint16(i * 2, true);
    if (code >= 32) {                       // 일반 문자
      out.push(String.fromCharCode(code));
      i += 1;
    } else if (CHAR_CTRL.has(code)) {
      if (code === 10) out.push('\n');      // 줄바꿈
      else if (code === 13) out.push('\n'); // 문단 끝
      else if (code === 24) out.push('-');  // 하이픈
      else if (code === 30 || code === 31) out.push(' '); // 묶음/고정폭 빈칸
      i += 1;
    } else if (INLINE_CTRL.has(code) || EXTENDED_CTRL.has(code)) {
      if (code === 9) out.push('\t');       // 탭
      i += 8;                               // ★ 8 WCHAR 건너뛴다
    } else {
      i += 1;                               // 미지 코드는 안전하게 1칸
    }
  }
  return out.join('');
}
```

> **가장 흔한 버그가 여기서 나온다.** 확장 컨트롤을 1 WCHAR로 처리하면 컨트롤 내부 바이너리가 한글로 디코딩돼 본문에 섞여 들어간다. 텍스트가 "그럴듯한데 이상한 글자가 껴 있다"면 이 로직을 먼저 의심하라.

#### 7.4.6 조립

```ts
export async function parseHwp(buf: ArrayBuffer, ctx: ParseCtx): Promise<NormalizedDoc> {
  const cfb = CFB.read(new Uint8Array(buf), { type: 'array' });
  const header = readFileHeader(stream(cfb, 'FileHeader')!);

  if (header.passwordProtected) throw new AppError('ENCRYPTED');
  if (header.distributionDoc)   throw new AppError('HWP_DISTRIBUTION_DOC');   // §7.7

  const sections = listSectionStreams(cfb);            // BodyText/Section0..N
  const blocks: Block[] = [];
  const warnings: ParseWarning[] = [];

  for (let s = 0; s < sections.length; s++) {
    let raw = sections[s];
    if (header.compressed) raw = pako.inflateRaw(raw);

    let current: string[] = [];
    for (const rec of readRecords(raw)) {
      if (rec.tagId === HWPTAG_PARA_HEADER) {
        flush(current, blocks, s);                      // 이전 문단 확정
        current = [];
      } else if (rec.tagId === HWPTAG_PARA_TEXT) {
        current.push(decodeParaText(rec.payload));
      }
      // TABLE / LIST_HEADER 는 v1에서 무시 (셀 텍스트는 PARA_TEXT 로 자연 수집됨)
    }
    flush(current, blocks, s);
    ctx.progress({ phase: 'parsing', current: s + 1, total: sections.length });
  }

  warnings.push(warn('HWP_NO_PAGE_INFO', 'info',
    'HWP는 페이지 정보를 저장하지 않아 페이지 번호를 표시하지 않습니다'));

  return { format: 'hwp', meta: { …, sectionCount: sections.length, parserVersion: 'hwp@1' },
           blocks, warnings, confidence: 0.85 };
}
```

#### 7.4.7 PrvText 폴백

`PrvText` 스트림에는 미리보기용 **순수 텍스트**가 UTF-16LE로 들어 있다. 본문 파싱이 실패하거나 결과가 비정상적으로 짧을 때 이걸로 폴백하면 최소한 뷰어 모드는 살릴 수 있다.

```ts
if (blocks.length === 0 || totalChars(blocks) < 50) {
  const prv = stream(cfb, 'PrvText');
  if (prv) {
    warnings.push(warn('PARTIAL_PARSE', 'warn', '본문 파싱에 실패해 미리보기 텍스트로 대체했습니다'));
    return fromPlainText(new TextDecoder('utf-16le').decode(prv), 0.4);
  }
}
```

단, `PrvText`는 앞부분만 담고 있을 수 있으므로 **비교에는 쓰지 않고 뷰어 전용**으로 제한한다.

### 7.5 HWP에는 페이지가 없다

hwp.js 개발자도 공지에서 밝혔듯 한/글 포맷은 명시적인 페이지 나눔 정보를 저장하지 않는다. 또한 한/글은 1/7200인치(HWPUNIT) 단위로 데이터를 저장한다.
→ https://github.com/hahnlee/hwp.js/issues/7

**설계 반영**
- `Block.source.page`는 HWP/HWPX에서 항상 `undefined`
- UI는 페이지 번호 대신 **구역/문단 번호**로 위치를 표시한다
- 좌표 기반 로직(머리말 제거 등)이 전혀 필요 없다는 뜻이기도 하다 — PDF보다 오히려 diff 품질이 좋다

### 7.6 표 처리 (v1)

- HWP/HWPX 모두 표 셀 텍스트를 ` | `로 join한 **단일 `table` 블록**으로 평탄화
- `TABLE_FLATTENED` 경고(info)
- 셀 단위 diff는 v2. 다만 평탄화 시 **행 구분에 `\n`을 쓰면** 나중에 셀 단위로 확장하기 쉽다

### 7.7 배포용(열람 제한) HWP

관공서가 배포용으로 잠근 HWP는 Section 스트림이 암호화돼 있어 일반 경로로는 읽히지 않는다. hwp.js도 배포용 문서는 파싱·렌더링이 불가하다고 명시한다.

**v1 정책: 미지원.**
- `FileHeader` 속성 비트로 사전 감지 → `HWP_DISTRIBUTION_DOC` 에러
- 안내: "이 문서는 배포용으로 보호돼 있어 열 수 없습니다. 한/글에서 일반 문서로 다시 저장한 뒤 올려주세요."

**v2 검토**: MIT 라이선스로 공개된 구현(rhwp 등)이 존재하고 kordoc이 이를 포팅해 지원한다. 다만 문서 보호 기능 우회에 해당할 수 있으므로 **법률 검토를 먼저 거친 뒤** 판단한다. 기술적 가능 여부와 별개의 문제다.

### 7.8 M4 종료 조건

| # | 항목 | 기준 |
|---|---|---|
| 1 | HWPX 자기 비교 (20건) | 변경점 0 |
| 2 | HWP 5.0 자기 비교 (20건) | 변경점 0 |
| 3 | 동일 내용 hwp ↔ hwpx 비교 | 유의미한 차이만 표시 (참고 지표) |
| 4 | 제어문자 오해석 검사 | 추출 텍스트에 U+0000~U+001F 잔여 0건 |
| 5 | 표 포함 문서 (5건) | 셀 텍스트 누락 0건 |
| 6 | 배포용 HWP | 정확히 감지하고 안내 |
| 7 | 손상 파일 | 크래시 없이 에러 처리 |
| 8 | 실문서 추출 성공률 | **80% 이상** (미달 시 `.hwp` 제외 결정) |

---
## 8. TXT / MD / DOCX 파서

### 8.1 TXT — 인코딩이 전부다

국내 텍스트 파일은 CP949(EUC-KR 확장)가 여전히 많다. UTF-8로 강제 디코딩하면 전부 깨진다.

```ts
// src/core/parsers/text.ts
import jschardet from 'jschardet';

export function decodeBytes(buf: ArrayBuffer): { text: string; guessed: boolean } {
  const u8 = new Uint8Array(buf);

  // 1. BOM 확인 (가장 확실)
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF)
    return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), guessed: false };
  if (u8[0] === 0xFF && u8[1] === 0xFE)
    return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), guessed: false };

  // 2. UTF-8 유효성 엄격 검사
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return { text: t, guessed: false };
  } catch { /* UTF-8 아님 */ }

  // 3. jschardet 추정 → euc-kr 폴백
  const det = jschardet.detect(Buffer.from(u8.subarray(0, 8192)));
  const enc = (det?.encoding ?? 'euc-kr').toLowerCase();
  const label = /euc-?kr|cp949|ks_c/.test(enc) ? 'euc-kr' : enc;
  return { text: new TextDecoder(label).decode(u8), guessed: true };
}
```

`guessed === true`면 `ENCODING_GUESS` 경고 + `confidence = 0.7`.

문단 분리는 **빈 줄 기준**. 단일 개행은 같은 문단 안의 줄바꿈으로 보존한다.

### 8.2 MD

`marked`의 lexer로 토큰화한다.

| 토큰 | Block |
|---|---|
| `heading` | `heading` + `level` |
| `paragraph` | `paragraph` |
| `list_item` | `listItem` + depth |
| `code` | `code` |
| `blockquote` | `quote` |
| `table` | `table` (셀을 ` | `로 join) |

`rawText`에는 마크다운 원문을, `text`에는 마크업을 제거한 순수 텍스트를 넣는다. 이렇게 하면 "굵게 표시만 바뀐 경우"가 diff에 안 잡히는데, v1 방침(D-03)과 일치한다.

### 8.3 DOCX

```ts
import mammoth from 'mammoth';

const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer: buf });
const dom = new DOMParser().parseFromString(html, 'text/html');
// h1~h6 → heading, p → paragraph, li → listItem, table → table, pre → code
```

- mammoth의 `messages`에 경고가 있으면 `PARTIAL_PARSE`로 옮겨 담는다
- `.doc`(구버전 바이너리)는 매직 넘버로 감지해 "docx로 저장 후 재시도" 안내
- 대안(직접 `document.xml` 파싱)은 서식 정보가 정확하지만 v1에는 과하다

### 8.4 형식 감지는 확장자를 믿지 않는다

```ts
// src/core/detect.ts — 매직 넘버 우선
export function sniffFormat(u8: Uint8Array, ext: string): Format | 'unknown' {
  if (startsWith(u8, [0x25,0x50,0x44,0x46])) return 'pdf';            // %PDF
  if (startsWith(u8, [0xD0,0xCF,0x11,0xE0])) return 'hwp';            // CFB (또는 .doc/.xls)
  if (startsWith(u8, [0x50,0x4B,0x03,0x04])) return zipKind(u8, ext); // docx | hwpx
  return isProbablyText(u8) ? (ext === 'md' ? 'md' : 'txt') : 'unknown';
}
```

- CFB 시그니처는 `.hwp`뿐 아니라 `.doc`/`.xls`도 같다. `FileHeader` 스트림의 `HWP Document File` 문자열로 최종 확정한다
- ZIP 시그니처는 `.docx`/`.hwpx`/`.xlsx` 공통. `mimetype` 엔트리 또는 `Contents/header.xml` 존재로 구분한다
- 확장자와 실제 내용이 다르면 실제 내용을 따르고 사용자에게 알린다

---

## 9. UI 명세

### 9.1 화면

| ID | 화면 | 진입 조건 |
|---|---|---|
| SC-01 | 랜딩 / 업로드 | 초기 |
| SC-02 | 처리 중 | 파싱·diff 진행 |
| SC-03 | 비교 결과 | `mode.kind === 'compare'` 성공 |
| SC-04 | 뷰어 (분할) | `viewer-split` |
| SC-05 | 뷰어 (단일) | `viewer-single` |
| SC-06 | 에러 | 파싱 실패 |

### 9.2 SC-03 레이아웃

```
┌──────────────────────────────────────────────────────┐
│ 계약서_v2.docx  ⇄  계약서_v3.docx     [Split│Unified] │
│ +128  −43  ~12                        [↑][↓]  3 / 12 │
├──────────────────────────────────────────────────────┤
│ ⚠ 표는 텍스트로 평탄화되어 비교되었습니다      [자세히] │
├───────────────────────────┬──────────────────────────┤
│ 12  제3조 (계약기간)       │ 12  제3조 (계약기간)      │▮
│     ⋯ 8줄 동일 ⋯          │     ⋯ 8줄 동일 ⋯         │▯ 미니맵
│ 21 −본 계약의 기간은 1년   │ 21 +본 계약의 기간은 2년  │▮
└───────────────────────────┴──────────────────────────┘
```

### 9.3 시각 규칙

| 요소 | 라이트 | 다크 |
|---|---|---|
| 추가 배경 | `#E6FFEC` | `#0D4429` |
| 추가 인라인 강조 | `#ABF2BC` | `#1A7F37` |
| 삭제 배경 | `#FFEBE9` | `#5A1E1E` |
| 삭제 인라인 강조 | `#FFC1BC` | `#B62324` |
| 동일 | 투명 | 투명 |

- **색만으로 구분하지 않는다.** 좌측 거터에 `+` `−` `~` 기호를 항상 표시 (색각 이상 대응, WCAG)
- 본문은 등폭이 아닌 가독성 폰트(Pretendard). 코드 블록만 등폭
- 인라인 강조는 배경색 + 밑줄/취소선 병용

### 9.4 상태 관리

```ts
// src/store/index.ts (Zustand)
interface AppState {
  files: [File | null, File | null];
  mode: Mode;
  docs: [NormalizedDoc | null, NormalizedDoc | null];
  diff: DiffResult | null;
  progress: Progress | null;
  error: AppError | null;
  view: 'split' | 'unified';
  normalizeOptions: NormalizeOptions;
  cursor: number;              // changeIndices 내 현재 위치

  setFile(slot: 0 | 1, f: File | null): void;
  run(): Promise<void>;        // parse ×2 → diff
  cancel(): void;
  setOption<K extends keyof NormalizeOptions>(k: K, v: NormalizeOptions[K]): void; // → renormalize + diff
  next(): void; prev(): void;
}
```

**중요**: `setOption`은 재파싱하지 않는다. `renormalize()` + `diff()`만 다시 돈다.

### 9.5 가상 스크롤

- `@tanstack/react-virtual`. `DiffRow` 배열을 그대로 아이템으로 쓴다
- 행 높이가 가변이므로 `measureElement` 사용
- **Split 뷰의 좌우 동기 스크롤**: 두 패널을 별도 스크롤러로 두지 말고 **하나의 스크롤 컨테이너 안에 2열 그리드**로 렌더한다. 동기화 로직이 통째로 사라진다
- 변경점 점프는 `scrollToIndex(changeIndices[cursor])`

### 9.6 반응형

- `>= 768px`: Split 기본
- `< 768px`: **Unified 강제**. 좁은 화면의 Split은 양쪽 다 못 읽는다
- 모바일에서는 파일 선택 시점에 크기를 확인해 10MB 초과 시 사전 경고

### 9.7 접근성

- 모든 인터랙티브 요소에 키보드 접근
- 변경 행에 `aria-label="추가된 줄"` / `"삭제된 줄"`
- 진행률은 `role="progressbar"` + `aria-valuenow`
- 색상 대비 4.5:1 이상

---

## 10. 성능 · 에러

### 10.1 목표

| 항목 | 목표 |
|---|---|
| 초기 로드 (LCP) | 1.5s |
| 초기 번들 (gzip) | **200KB 이하** |
| TXT/MD 100KB 비교 | 0.5s |
| DOCX 50p | 3s |
| HWPX 50p | 3s |
| HWP 5.0 50p | 5s |
| PDF 100p | 8s |
| PDF 500p | 30s (취소 가능) |
| 스크롤 | 60fps |
| 탭 메모리 | 500MB 이하 |

### 10.2 코드 스플리팅

파서를 전부 초기 로드하면 5MB를 넘는다. **확장자 확인 후 동적 로드.**

```ts
// src/core/parsers/index.ts
const LOADERS: Record<Format, () => Promise<Parser>> = {
  txt:  () => import('./text').then(m => m.default),
  md:   () => import('./markdown').then(m => m.default),
  docx: () => import('./docx').then(m => m.default),
  pdf:  () => import('./pdf').then(m => m.default),
  hwpx: () => import('./hwpx').then(m => m.default),
  hwp:  () => import('./hwp').then(m => m.default),
};
```

예상 청크 크기(gzip): `pdf` ~350KB, `hwp` ~80KB(cfb+pako), `hwpx` ~40KB(jszip), `docx` ~120KB(mammoth), `text/md` ~30KB.

### 10.3 상한

```ts
export const LIMITS = {
  MAX_FILE_BYTES: 30 * 1024 * 1024,
  WARN_FILE_BYTES: 10 * 1024 * 1024,
  MAX_PDF_PAGES: 1_000,
  MAX_ZIP_ENTRIES: 2_000,
  MAX_UNZIPPED_BYTES: 256 * 1024 * 1024,   // ZIP bomb 방어
  PARSE_TIMEOUT_MS: 120_000,
};
```

### 10.4 에러 카탈로그

| 코드 | 사용자 메시지 | 복구 |
|---|---|---|
| `TOO_MANY_FILES` | 파일은 2개까지 올릴 수 있습니다 | 토스트 |
| `UNSUPPORTED_FORMAT` | 지원하지 않는 형식입니다 (지원: …) | 목록 표시 |
| `FORMAT_MISMATCH` | 확장자와 실제 내용이 다릅니다 | 실제 형식으로 진행 제안 |
| `FILE_TOO_LARGE` | 30MB를 초과합니다 | — |
| `EMPTY_FILE` | 파일이 비어 있습니다 | — |
| `CORRUPTED` | 파일을 읽을 수 없습니다 | — |
| `ENCRYPTED` | 암호가 걸려 있습니다 | PDF는 비밀번호 모달 |
| `HWP_DISTRIBUTION_DOC` | 배포용 문서라 열 수 없습니다 | 일반 저장 후 재시도 안내 |
| `SCANNED_PDF` | 이미지 PDF는 비교할 수 없습니다 | 뷰어 전환 |
| `GARBLED_TEXT` | 폰트 문제로 텍스트를 정확히 읽을 수 없습니다 | 뷰어 전환 |
| `OUT_OF_MEMORY` | 문서가 너무 큽니다 | 페이지 범위 제안 |
| `TIMEOUT` | 처리 시간이 초과됐습니다 | 부분 결과 표시 |

### 10.5 엣지 케이스

| 상황 | 처리 |
|---|---|
| 두 문서가 완전히 동일 | "두 문서가 동일합니다" 명시. **빈 화면 금지** |
| 유사도 거의 0 | "공통 부분이 거의 없습니다. 파일을 확인해 주세요" |
| 한쪽만 파싱 실패 | 비교 불가 + 성공한 쪽만 뷰어 제공 |
| 한쪽만 스캔본 | **어느 쪽이 문제인지 파일명으로 명시** |
| 같은 파일을 두 번 올림 | 동일 판정 후 안내 |
| 빈 문서 | "내용이 없습니다" |

---

## 11. 파일 구조

```
src/
├── app/
│   ├── App.tsx
│   └── routes.tsx
├── components/
│   ├── upload/       DropZone, FileSlot, FormatBadge
│   ├── diff/         SplitView, UnifiedView, DiffRow, InlineSpans,
│   │                 SummaryBar, Minimap, CollapsedGap, OptionToggles
│   ├── viewer/       PdfViewer, HtmlViewer, ViewerSplit
│   └── common/       WarningBanner, ProgressBar, ErrorPanel, Shortcuts
├── core/                          ← DOM·React 의존성 0. Node에서 그대로 테스트
│   ├── types.ts
│   ├── mode.ts
│   ├── detect.ts
│   ├── normalize.ts
│   ├── errors.ts
│   ├── parsers/
│   │   ├── index.ts               확장자 → 동적 import
│   │   ├── text.ts
│   │   ├── markdown.ts
│   │   ├── docx.ts
│   │   ├── pdf/
│   │   │   ├── index.ts           트랙 A/B/C 라우팅
│   │   │   ├── constants.ts
│   │   │   ├── structTree.ts      트랙 A
│   │   │   ├── items.ts           단계 0
│   │   │   ├── lineGrouping.ts    단계 1
│   │   │   ├── columnDetect.ts    단계 2 (XY-cut)
│   │   │   ├── headerFooter.ts    단계 3
│   │   │   ├── paragraphMerge.ts  단계 4
│   │   │   ├── pageJoin.ts        단계 6
│   │   │   ├── hangulSanity.ts    mojibake 탐지
│   │   │   └── scanDetect.ts      트랙 C
│   │   ├── hwpx.ts
│   │   └── hwp/
│   │       ├── index.ts
│   │       ├── fileHeader.ts
│   │       ├── record.ts
│   │       ├── tags.ts
│   │       ├── paraText.ts        제어문자 디코딩 ★
│   │       └── prvText.ts         폴백
│   └── diff/
│       ├── index.ts
│       ├── blockDiff.ts
│       ├── anchorSplit.ts         대용량 분할
│       ├── pairing.ts
│       └── wordDiff.ts            한국어 2.5단계
├── workers/
│   ├── document.worker.ts
│   └── protocol.ts
├── store/
├── i18n/
└── fixtures/                      테스트 픽스처 (git-lfs 권장)
```

---

## 12. 구현 티켓

의존 관계 순서대로 나열했다. 위에서부터 그대로 처리하면 된다.

### M0 — 스파이크 & 뼈대 (1주)

| ID | 작업 | 완료 기준 |
|---|---|---|
| T-001 | Vite + TS(strict) + React + Tailwind + Vitest 세팅 | `npm run dev` / `test` 동작 |
| T-002 | `core/types.ts` 전체 타입 확정 | 컴파일 통과 |
| T-003 | Comlink 워커 왕복 뼈대 (`parse`/`diff` 스텁) | UI에서 워커 호출 성공 |
| T-004 | **U-01 스파이크**: kordoc 브라우저 구동 시험 | 채택/불채택 결정서 1장 |
| T-005 | **U-02 스파이크**: 국내 PDF 30건의 `getStructTree()` 유효 비율 측정 | 수치 보고 |
| T-006 | **U-03 스파이크**: HWP 5.0 실문서 20건 추출 성공률 | 수치 보고 + `.hwp` 포함 여부 결정 |
| T-007 | CI에 "파일 바이트를 전송하는 fetch 없음" 정적 검사 추가 | D-01 자동 보증 |

### M1 — 텍스트 관통 (1주)

| ID | 작업 | 완료 기준 |
|---|---|---|
| T-010 | `detect.ts` 매직 넘버 감지 | 6개 형식 판별 테스트 통과 |
| T-011 | `parsers/text.ts` + 인코딩 감지 | CP949/UTF-8/UTF-16 픽스처 통과 |
| T-012 | `normalize.ts` 전체 규칙 | 규칙별 단위 테스트 |
| T-013 | `diff/blockDiff.ts` | 자기 비교 = 0 변경 |
| T-014 | `diff/pairing.ts` + Dice | 유사 블록 짝짓기 테스트 |
| T-015 | `diff/wordDiff.ts` 한국어 2.5단계 | "계약서를→계약서는"이 조사만 강조 |
| T-016 | `UnifiedView` + 가상 스크롤 | 10만 줄 60fps |
| T-017 | 진행률 + 취소 | Esc로 즉시 중단 |
| T-018 | **골든 테스트 하네스** | 픽스처 스냅샷 비교 자동화 |

### M2 — DOCX + 비교 UX (1주)

| ID | 작업 | 완료 기준 |
|---|---|---|
| T-020 | `parsers/markdown.ts` | 토큰 → Block 매핑 테스트 |
| T-021 | `parsers/docx.ts` (mammoth) | 픽스처 10건 통과 |
| T-022 | `SplitView` (단일 스크롤 2열 그리드) | 동기 스크롤 자동 성립 |
| T-023 | `SummaryBar` + 변경점 네비게이션 | `n`/`p` 동작 |
| T-024 | `WarningBanner` | warnings 렌더링 |
| T-025 | 에러 카탈로그 전체 | 12개 코드 UI 확인 |

### M3 — PDF (3주)

| ID | 작업 | 완료 기준 |
|---|---|---|
| T-030 | pdf.js 워커 설정 + **중첩 워커 검증** | 워커 안에서 파싱 성공 |
| T-031 | `structTree.ts` 트랙 A | 태그 PDF에서 heading 계층 복원 |
| T-032 | `items.ts` 회전·invisible 처리 | 회전 텍스트 유실 0 |
| T-033 | `lineGrouping.ts` | 라인 분리 픽스처 통과 |
| T-034 | `columnDetect.ts` XY-cut | 2단 논문 5건 읽기 순서 정확 |
| T-035 | `headerFooter.ts` | 머리말 제거 후 diff 0 |
| T-036 | `paragraphMerge.ts` | 문단 경계 정확도 검수 |
| T-037 | `pageJoin.ts` | 페이지 나눔 다른 쌍 3건 통과 |
| T-038 | `hangulSanity.ts` mojibake 탐지 | 정상/깨짐 각 5건 100% 분류 |
| T-039 | `scanDetect.ts` 트랙 C | 스캔 3건 전부 차단 |
| T-040 | 암호 PDF 모달 | 비밀번호 입력 후 파싱 |
| T-041 | **§6.10 검수 10항목 전체** | 전부 통과해야 M3 종료 |

### M4 — HWP / HWPX (3주)

| ID | 작업 | 완료 기준 |
|---|---|---|
| T-050 | `parsers/hwpx.ts` — ZIP + secCnt + 문단 순회 | 20건 자기 비교 0 |
| T-051 | HWPX 표 평탄화 + tab 보존 | 셀 누락 0 |
| T-052 | `hwp/fileHeader.ts` | 버전·플래그 파싱 테스트 |
| T-053 | `hwp/record.ts` — 0xFFF 확장 크기 포함 | 레코드 개수 정합 |
| T-054 | `hwp/paraText.ts` — **제어문자 8 WCHAR 처리** | 제어문자 잔여 0 |
| T-055 | `hwp/index.ts` 조립 + pako inflateRaw | 20건 추출 성공 |
| T-056 | `prvText.ts` 폴백 (뷰어 전용) | 파싱 실패 시 뷰어 동작 |
| T-057 | 배포용 문서 감지 + 안내 | 정확히 차단 |
| T-058 | **§7.8 검수 8항목 전체** | 성공률 80% 이상 |

### M5 — 뷰어 · UX 완성 (1주)

| ID | 작업 |
|---|---|
| T-060 | `viewer/PdfViewer` (pdf.js 캔버스 렌더) |
| T-061 | `viewer/HtmlViewer` (그 외 형식) |
| T-062 | `ViewerSplit` + 안내 배너 |
| T-063 | `OptionToggles` + `renormalize` 경로 |
| T-064 | 동일 구간 접기 |
| T-065 | 미니맵 |
| T-066 | 다크모드 + i18n(ko/en) |
| T-067 | 단축키 + 도움말 오버레이 |

### M6 — 성능 · 배포 (1주)

| ID | 작업 |
|---|---|
| T-070 | 코드 스플리팅 + 번들 200KB 검증 |
| T-071 | `anchorSplit.ts` 대용량 diff |
| T-072 | 접근성 감사 (axe) |
| T-073 | Playwright E2E 6개 시나리오 |
| T-074 | Cloudflare Pages 배포 + 도메인 |
| T-075 | 개인정보처리방침 · 랜딩 카피 |
| T-076 | Sentry 스크러빙 (파일명·내용 제외 확인) |

---

## 13. 테스트

### 13.1 최상위 회귀 테스트

```ts
// 이 서비스에서 가장 중요한 단 하나의 테스트
test.each(ALL_FIXTURES)('%s: 자기 자신과 비교하면 변경점 0', async (path) => {
  const doc = await parseFile(path);
  const result = await runDiff(doc, doc, DEFAULT_NORMALIZE[groupOf(path)]);
  expect(result.stats.insertBlocks).toBe(0);
  expect(result.stats.deleteBlocks).toBe(0);
  expect(result.stats.modifyBlocks).toBe(0);
});
```

여기에 더해 **의미상 같지만 바이트가 다른 쌍**을 확보한다. 이게 실제 사용 패턴이다.
- 같은 문서를 Word에서 재저장
- 같은 문서를 다른 도구로 PDF 출력
- UTF-8 / CP949로 각각 저장한 텍스트
- 같은 문서를 HWP / HWPX로 각각 저장

### 13.2 픽스처 세트

| 카테고리 | 개수 |
|---|---|
| 형식별 정상 문서 | 각 10 |
| 인코딩 변형 TXT | 5 |
| 태그된 PDF | 5 |
| 다단 조판 PDF | 5 |
| 스캔 PDF | 3 |
| 한글 CID / mojibake PDF | 5 |
| 회전 텍스트·괘선 없는 표 PDF | 3 |
| 같은 원본 다른 출력 PDF 쌍 | 5쌍 |
| 페이지 나눔 다른 PDF 쌍 | 3쌍 |
| 실제 공문서 HWP | 20 |
| 실제 공문서 HWPX | 20 |
| 표 포함 문서 | 각 형식 3 |
| 대용량 (200p+) | 3 |
| 손상 / 암호화 / 배포용 | 8 |

수집처: 정부24, 조달청 나라장터 공고문, 국회 의안정보시스템, 지자체 예산서 공개 자료.

### 13.3 골든 테스트

각 픽스처의 `NormalizedDoc`을 JSON 스냅샷으로 저장한다. 파서 수정 시 의도치 않은 회귀를 즉시 잡는다. `parserVersion`을 올리면 스냅샷을 갱신한다.

### 13.4 E2E (Playwright)

1. TXT 2개 업로드 → Unified 비교 → 변경점 점프
2. DOCX 2개 → Split → 옵션 토글 → 결과 갱신
3. PDF 2개 → 진행률 표시 → 취소
4. PDF + DOCX → 뷰어 분할 전환 안내
5. HWPX 1개 → 단일 뷰어
6. 손상 파일 → 에러 화면

---

## 14. 배포 · 운영

- **호스팅**: Cloudflare Pages. main push 시 자동 배포
- **애널리틱스**: Plausible 또는 Cloudflare Web Analytics
  - 수집: 페이지뷰, 사용 형식, 성공/실패, 파싱 소요시간, 문서 크기 구간
  - **절대 수집 금지**: 파일명, 파일 내용, 텍스트 일부
- **Sentry**: `beforeSend`에서 파일명·문서 내용 스크러빙. 스택트레이스에 사용자 데이터가 섞이지 않는지 T-076에서 검증
- **개인정보처리방침**: "모든 처리가 브라우저에서 이루어지며 파일은 서버로 전송되지 않습니다"를 명시. 이 문장이 곧 랜딩 히어로 카피다
- **PWA (v2 권장)**: Service Worker로 오프라인 동작을 만들면 "인터넷을 끊고도 쓸 수 있다"로 무전송을 증명할 수 있다. 마케팅 효과가 크다

---

## 15. 리스크 관리

| 리스크 | 영향 | 대응 |
|---|---|---|
| **한글 PDF mojibake 무경고 통과** | 조용히 틀린 결과 = 신뢰 붕괴 | §6.6 종성 분포 탐지. **에러보다 무경고가 더 위험** |
| **PDF 페이지 경계 문단 분리** | 같은 문서가 전부 다르게 나옴 | §6.5 단계 6 필수 구현. T-037 |
| **HWP 제어문자 오해석** | 본문에 바이너리 쓰레기 혼입 | §7.4.5 8 WCHAR 규칙. T-054 |
| HWP 5.0 추출 성공률 저조 | 차별점 상실 | M0 스파이크로 조기 판단, `.hwpx`만 지원으로 축소 |
| kordoc이 Node 전용 | 3주 추가 | M0에서 먼저 확인. 서버 우회는 금지(D-01) |
| MuPDF.js AGPL 감염 | 소스 공개 의무 | v1 의존성 배제 (D-04) |
| 번들 크기 폭증 | 초기 로드 저하 | 동적 import, 200KB 목표, CI에 번들 예산 검사 |
| 대용량 브라우저 크래시 | 이탈 | 상한 + 워커 + 가상 스크롤 + 타임아웃 |
| 한국어 diff 품질 | 조사만 바뀌어도 통째 변경 | §5.4 2.5단계 재귀 diff |
| 모바일 사용성 | 트래픽 절반 손실 | Unified 강제 + 사전 크기 경고 |

---

## 16. v2 이후

- 문단 이동(move) 감지
- 표 셀 단위 diff
- 서식 변경 감지 (볼드·색상·크기)
- 결과 PDF/HTML 내보내기
- OCR (사용자 명시 요청 시에만)
- 배포용 HWP 지원 (**법률 검토 선행**)
- 형식 교차 비교 (DOCX ↔ PDF)
- PWA / 오프라인
- 3-way diff
- 브라우저 확장 (Confluence·Google Docs 리비전 비교, `core/` 재사용)

---

## 부록 A. 착수 전 체크리스트

- [ ] T-004 kordoc 브라우저 구동 스파이크 — **가장 먼저**. 결과가 3주를 좌우한다
- [ ] T-005 국내 PDF의 `getStructTree()` 유효 비율 측정
- [ ] T-006 HWP 5.0 실문서 추출 성공률 측정
- [ ] pdfjs-dist 최신 메이저의 워커 설정 방식 + 중첩 워커 동작 확인
- [ ] MuPDF.js 사용 여부 = 오픈소스 공개 여부 결정
- [ ] 사용 라이브러리 전체 라이선스 감사 (AGPL 유무)
- [ ] 공문서 픽스처 40건 수집
- [ ] 도메인 확보
- [ ] 개인정보처리방침 초안

## 부록 B. 참고 자료

**포맷 명세**
- 한/글 문서 파일 형식 5.0 (한컴 공식) — https://cdn.hancom.com/link/docs/한글문서파일형식_5.0_revision1.3.pdf
- HWPX 포맷 구조 (한컴테크) — https://tech.hancom.com/hwpxformat/
- HWPX 본문 파싱 (한컴테크) — https://tech.hancom.com/python-hwpx-parsing-2/
- HWP 레코드 구조 정리 — https://github.com/hallazzang/hwp5-table-extractor/wiki

**PDF**
- pdf.js 읽기 순서 이슈 #17191 — https://github.com/mozilla/pdf.js/issues/17191
- pdf.js 아이템 순서 이슈 #14493 — https://github.com/mozilla/pdf.js/issues/14493
- Apryse 텍스트 추출 가이드 — https://docs.apryse.com/web/guides/extraction/text-extract

**라이브러리**
- hwp.js 메인터넌스 공지 — https://github.com/hahnlee/hwp.js/issues/7
- @ohah/hwpjs — https://github.com/ohah/hwpjs
- kordoc — https://github.com/chrisryugj/kordoc
- MuPDF.js — https://github.com/ArtifexSoftware/mupdf.js

## 부록 C. 코드 상수 요약

| 상수 | 값 | 출처 |
|---|---|---|
| HWP 레코드 헤더 | tagId 10bit / level 10bit / size 12bit | §7.4.3 |
| HWP 확장 크기 트리거 | `size === 0xFFF` | §7.4.3 |
| `HWPTAG_PARA_HEADER` | 66 | §7.4.4 |
| `HWPTAG_PARA_TEXT` | 67 | §7.4.4 |
| HWP 문자 컨트롤 (1 WCHAR) | 0,10,13,24~31 | §7.4.5 |
| HWP 인라인/확장 컨트롤 (8 WCHAR) | 1~9,11~23 | §7.4.5 |
| HWP 단위 | 1/7200 inch | §7.5 |
| HWPX 네임스페이스 | `http://www.hancom.co.kr/hwpml/2011/paragraph` | §7.3 |
| PDF 라인 허용 오차 | `median(height) × 0.3` | §6.3 |
| PDF 문단 분리 임계 | `median(행간) × 1.5` | §6.3 |
| PDF 스캔 판정 | `< 50자/페이지` | §6.3 |
| Dice 짝짓기 임계 | 0.5 | §5.3 |
| 인라인 재분해 임계 | 0.4 | §5.4 |
| diff 타임아웃 | 10초 | §5.5 |
