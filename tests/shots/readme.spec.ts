import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { SAMPLES, SAMPLE_DIR, writeSamples } from './samples';

/**
 * README 에 넣을 화면을 찍는다. `npm run docs:shots` 로만 돈다.
 *
 * 손으로 찍은 스크린샷은 화면이 바뀌면 조용히 낡는다. 여기서 찍으면
 * 표본 문서까지 코드로 만들어지므로, 한 번의 명령으로 언제든 다시 찍힌다.
 */

const OUT = fileURLToPath(new URL('../../docs/images', import.meta.url));

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  await writeSamples();
});

async function compareSamples(page: Page) {
  await page.goto('/');
  const inputs = page.locator('input[type=file]');
  await inputs.nth(0).setInputFiles(join(SAMPLE_DIR, SAMPLES.before));
  await inputs.nth(1).setInputFiles(join(SAMPLE_DIR, SAMPLES.after));
  await page.getByRole('button', { name: '비교하기' }).click();
  await expect(page.getByTitle('좌우 바꾸기')).toBeVisible();

  // 결과 영역만 찍는다. 헤더·업로드 칸까지 넣으면 정작 볼 것이 작아진다.
  return page.locator('section').filter({ has: page.getByTitle('좌우 바꾸기') });
}

/** 가상 스크롤이 아래쪽 행을 아직 안 그렸을 수 있다. 한 번 훑어 전부 채운 뒤 위로 돌아온다. */
async function settle(page: Page) {
  const scroller = page.locator('[tabindex="0"]').first();
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(300);
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.waitForTimeout(300);
}

const VIEWS: Array<{ button: string; file: string }> = [
  { button: '세 칸', file: 'triple.png' },
  { button: '한 줄로', file: 'unified.png' },
  { button: '나란히', file: 'split.png' },
];

for (const v of VIEWS) {
  test(`스크린샷 — ${v.button}`, async ({ page }) => {
    const result = await compareSamples(page);

    await page.getByRole('button', { name: v.button }).click();
    await expect(page.getByRole('button', { name: v.button })).toHaveAttribute('aria-pressed', 'true');
    await settle(page);

    await result.screenshot({ path: join(OUT, v.file), scale: 'css' });
  });
}
