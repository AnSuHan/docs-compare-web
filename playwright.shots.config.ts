import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * README 이미지 캡처 전용 (`npm run docs:shots`).
 *
 * 기본 E2E 와 섞지 않는다 — 검사는 매번 돌아야 하고, 캡처는 화면이 바뀌었을 때만
 * 돌리면 된다. 매 실행마다 PNG 가 새로 써지면 git 이 계속 시끄러워진다.
 */
export default defineConfig({
  ...base,
  testDir: './tests/shots',
  globalSetup: undefined,
  // 결과 화면이 잘리지 않게 넉넉히. 캡처는 이 폭 기준으로 나온다.
  use: { ...base.use, viewport: { width: 1280, height: 1100 } },
});
