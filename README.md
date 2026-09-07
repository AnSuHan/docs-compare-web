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

`web-hosting` 서비스에 앱으로 올라간다. 한 서비스에 프로젝트를 여러 개 두고 경로로 가른다.

| 경로 | 앱 |
|---|---|
| `/` | landing (프로젝트 목록) |
| `/docdiff` | 이 프로젝트 |
| `/php` | php-project |

접속: https://web-hosting.egghosting.com/docdiff

배포하면서 부딪힌 제약 셋. 새 프로젝트를 올릴 때도 그대로 적용된다.

- **`base` 는 빌드만 `/docdiff/`, 서빙(dev·preview)은 `/`.** 프록시가 `/docdiff` prefix 를 떼고 앱에 넘긴다.
  - 빌드를 상대경로(`'./'`)로 두면, 끝 슬래시 없는 주소(`/docdiff`)로 들어왔을 때 브라우저가
    `./assets/...` 를 `/assets/...` 로 풀어 **루트에 붙은 다른 앱**으로 새어 나간다.
    제목만 뜨고 본문이 백지가 된다. 이게 실제로 났던 증상이다.
  - 반대로 preview 의 base 까지 `/docdiff/` 로 두면, prefix 가 떼인 요청에 preview 가 다시
    `/docdiff/` 로 리디렉트해 **무한 리디렉트**가 된다.
  - 게다가 nginx 는 라우팅을 막 저장한 직후에는 prefix 를 떼지 않다가 재동기화 뒤에 떼기 시작했다.
    그래서 `vite.config.ts` 의 `tolerate-mount-prefix` 플러그인이 양쪽을 다 받아준다.
- **`preview.allowedHosts` 가 필요하다.** 플랫폼이 이 앱을 `node/vite_static` 으로 감지해
  `vite preview`(포트 4173)로 띄우는데, preview 는 모르는 Host 헤더를 403 으로 막는다.
  증상은 `Blocked request. This host ... is not allowed.`
- **빌드 도구는 `dependencies` 에 둔다.** 배포 서버가 프로덕션 의존성만 설치한 뒤 `npm run build` 를 돌린다.
  `vite`/`typescript`/`tailwindcss` 를 `devDependencies` 에 두면 `tsc: not found` 로 빌드가 실패한다.

`server/static.mjs` 는 `npm start` 용 의존성 0 정적 서버다(현재 플랫폼은 `vite preview` 를 쓰므로
프로덕션에서 돌지는 않는다). `dist/` 만 내려주고 문서 바이트는 서버로 오지 않는다(D-01).
