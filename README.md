# DocDiff — M0 스캐폴딩

문서 두 개를 브라우저에서 비교하는 웹앱. 이 저장소는 기획서의 **M0(T-001 ~ T-007)** 까지 구현된 상태다.

## 빠른 시작

```bash
npm install
npm run dev        # 개발 서버
npm run verify     # 전송검사 + 테스트 + 빌드 + 번들예산. CI 가 도는 것과 같다
```

## 지금 되는 것

| 티켓 | 내용 | 상태 |
|---|---|---|
| T-001 | Vite + TS(strict) + React + Tailwind v4 + Vitest | ✅ |
| T-002 | `src/core/types.ts` 전체 계약 확정 | ✅ |
| T-003 | Comlink 워커 왕복 (`ping` / `parse` / `renormalize` / `diff`) | ✅ |
| T-004 | kordoc 브라우저 구동 스파이크 | 🔧 도구 준비됨, 측정 필요 |
| T-005 | PDF 구조 트리 적중률 스파이크 | 🔧 도구 준비됨, 측정 필요 |
| T-006 | HWP 5.0 추출 성공률 스파이크 | 🔧 도구 준비됨, 측정 필요 |
| T-007 | D-01 정적 검사 (파일 전송 코드 금지) | ✅ |
| — | 번들 예산 검사 (초기 로드 200KB) | ✅ 현재 62.6KB |

파서는 아직 **스텁**이다. `src/core/parsers/stub.ts` 가 바이트를 UTF-8 로 읽어 빈 줄로 끊는다.
파이프라인이 끝까지 관통하는지 확인하는 것이 M0 의 목적이고, 실제 파서는 M1~M4 에서 하나씩 교체된다.

## 스파이크 실행 방법

`npm run dev` → 페이지 하단 **"스파이크 도구 열기"**.

1. **T-004**: [확인] 버튼. kordoc 이 설치돼 있지 않으면 미설치로 나온다.
   `npm i kordoc` 후 다시 눌러서 브라우저에서 import 되는지, Node 전용 의존성으로 깨지는지 본다.
2. **T-005 / T-006**: 공문서 `.pdf` 와 `.hwp` 를 한꺼번에 선택.
   - PDF: 페이지별 `getStructTree()` 유효 비율 → 트랙 A 적중률
   - HWP: FileHeader → 압축 해제 → 레코드 → 제어문자 디코딩까지 실제로 돌린다.
     성공률, 제어문자 잔여 수, 미지 코드 수가 나온다.
   - 결과 JSON 을 그대로 `docs/decisions/` 에 붙이면 결정서가 된다.

**판단 기준**
- HWP 성공률 < 80% → v1 에서 `.hwp` 제외, `.hwpx` 만 지원
- 제어문자 잔여 > 0 → `paraText.ts` 의 8 WCHAR 처리 버그
- PDF 트랙 A 적중률이 높을수록 §6.5 기하 재조립 부담이 줄어든다

## 구조

```
src/
├── core/          DOM·React 의존성 0. Node 에서 그대로 테스트된다
│   ├── types.ts       모든 레이어가 공유하는 계약
│   ├── detect.ts      매직 넘버 우선 형식 감지
│   ├── mode.ts        비교/뷰어 모드 결정 (D-02)
│   ├── normalize.ts   정규화 파이프라인 (NFC 는 항상 적용)
│   ├── diff/          M0 는 LCS 만. 짝짓기·인라인은 M1
│   └── parsers/       확장자 → 동적 import
├── workers/       Comlink 프로토콜 + 클라이언트
├── components/    UI
├── store/         Zustand
└── spikes/        M0 측정 도구. hwp/ 는 그대로 M4 로 승격된다
```

## 규칙

- **`src/core` 에 DOM 을 들이지 않는다.** 테스트가 브라우저 없이 돌아야 한다.
- **파일 바이트를 네트워크로 보내지 않는다.** `npm run lint:no-upload` 가 강제한다.
- **형식별 파서는 반드시 동적 import.** 정적으로 넣으면 번들 예산 검사가 실패한다.
- **정규화 옵션을 바꿔도 재파싱하지 않는다.** `rawText` 를 들고 있으므로 `renormalize` 만 돈다.

## 다음 (M1)

T-010 형식 감지 마무리 → T-011 인코딩 감지 실파서 → T-013~T-015 diff 3단계 → T-016 Unified 가상 스크롤 → T-018 골든 테스트 하네스.

## 배포 (에그호스팅)

`web-hosting` 서비스에 앱으로 올라간다. 여러 프로젝트를 한 서비스에 두므로 경로 라우팅을 쓴다.

| 경로 | 앱 |
|---|---|
| `/` | php-project (기존) |
| `/docdiff` | 이 프로젝트 |

- `vite.config.ts` 의 `base: './'` — 어느 경로에 마운트해도 자산이 깨지지 않는다. 새 프로젝트도 이 값을 유지할 것.
- `server/static.mjs` — `npm start` 가 띄우는 의존성 0 정적 서버. `dist/` 만 내려주고 문서 바이트는 서버로 오지 않는다(D-01).
  마운트 prefix 가 붙어 오든 떼여 오든 둘 다 찾고, 자산이 아닌 경로는 `index.html` 로 떨어뜨린다.
- **빌드 도구가 `dependencies` 에 있는 이유**: 배포 서버가 프로덕션 의존성만 설치한 뒤 `npm run build` 를 돌린다.
  `vite`/`typescript`/`tailwindcss` 를 `devDependencies` 에 두면 `tsc: not found` 로 빌드가 실패한다.
