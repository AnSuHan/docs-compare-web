import { defineConfig } from '@playwright/test';

/**
 * T-073 / §13.4 — E2E.
 *
 * dev 서버에 붙는다. 빌드 산출물이 아니라 지금 소스를 보는 것이 목적이고,
 * preview 는 `rebuild-if-stale` 때문에 시작이 느리다.
 * 이미 띄워 둔 서버가 있으면 그걸 그대로 쓴다.
 */
const PORT = 5173;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/globalSetup.ts',
  // 400쪽 PDF 를 실제로 파싱한다. 기본 30초로는 모자란다.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // 워커 하나를 앱 전체가 공유한다. 브라우저를 여러 개 띄워 봐야 서로 느려지기만 한다.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
