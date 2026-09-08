import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { F, LOCKED_PASSWORD, fixture } from './fixtures';

/**
 * T-072 — 접근성 감사.
 *
 * 화면 상태마다 axe 를 돌린다. 빈 첫 화면만 훑으면 정작 이 제품의 본체인
 * diff 결과·뷰어·모달은 한 번도 검사되지 않는다.
 *
 * 색 대비까지 포함해 WCAG 2.1 AA 를 기준으로 본다. 위반이 하나라도 나오면
 * 실패한다 — "나중에 보자" 로 넘기면 다시 안 본다.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // 실패했을 때 무엇을 고쳐야 하는지 바로 읽히게 남긴다. axe 의 전체 덤프는 너무 길다.
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')} :: ${n.html.slice(0, 120)}`),
  }));
}

async function upload(page: Page, ...names: string[]) {
  const inputs = page.locator('input[type=file]');
  for (let i = 0; i < names.length; i++) await inputs.nth(i).setInputFiles(fixture(names[i]!));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DocDiff' })).toBeVisible();
});

test('첫 화면', async ({ page }) => {
  expect(await audit(page)).toEqual([]);
});

test('비교 결과 — 한 줄로', async ({ page }) => {
  await upload(page, F.txtBefore, F.txtAfter);
  await page.getByRole('button', { name: '비교하기' }).click();
  await expect(page.getByTitle('좌우 바꾸기')).toBeVisible();

  expect(await audit(page)).toEqual([]);
});

test('비교 결과 — 나란히', async ({ page }) => {
  await upload(page, F.txtBefore, F.txtAfter);
  await page.getByRole('button', { name: '비교하기' }).click();
  await page.getByRole('button', { name: '나란히' }).click();
  await expect(page.getByRole('button', { name: '나란히' })).toHaveAttribute('aria-pressed', 'true');

  expect(await audit(page)).toEqual([]);
});

test('뷰어 분할', async ({ page }) => {
  await upload(page, F.pdfSmall, F.docxBefore);
  await expect(page.getByLabel('1 쪽')).toBeVisible();

  expect(await audit(page)).toEqual([]);
});

test('에러 화면', async ({ page }) => {
  await upload(page, F.docxBefore, F.docxBroken);
  await page.getByRole('button', { name: '비교하기' }).click();
  await expect(page.getByText('파일을 읽을 수 없습니다. 손상된 것 같습니다.')).toBeVisible();

  expect(await audit(page)).toEqual([]);
});

test('비밀번호 모달', async ({ page }) => {
  await upload(page, F.pdfLocked, F.pdfLockedCopy);
  await page.getByRole('button', { name: '비교하기' }).click();

  const dialog = page.getByRole('dialog', { name: 'PDF 비밀번호' });
  await expect(dialog).toBeVisible();
  expect(await audit(page)).toEqual([]);

  // 틀린 뒤의 상태(alert 가 붙은 화면)도 본다.
  await dialog.getByLabel('문서 비밀번호').fill('nope');
  await dialog.getByRole('button', { name: '열기' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await audit(page)).toEqual([]);

  await dialog.getByLabel('문서 비밀번호').fill(LOCKED_PASSWORD);
});

test('단축키 도움말', async ({ page }) => {
  await page.getByRole('button', { name: '단축키 (?)' }).click();
  await expect(page.getByRole('dialog', { name: '단축키' })).toBeVisible();

  expect(await audit(page)).toEqual([]);
});

test('진단 화면', async ({ page }) => {
  await page.getByRole('button', { name: '관리 · 진단 화면' }).click();
  await expect(page.getByRole('heading', { name: '관리 · 진단', level: 1 })).toBeVisible();

  expect(await audit(page)).toEqual([]);
});

/**
 * 다크 모드는 팔레트가 통째로 다르다. 밝은 쪽만 통과한 대비를 어두운 쪽에서
 * 다시 확인하지 않으면 절반만 본 것이다.
 */
test.describe('다크 모드', () => {
  test.use({ colorScheme: 'dark' });

  test('비교 결과', async ({ page }) => {
    // 팔레트가 정말 바뀌었는지 먼저 본다. 아니면 밝은 화면을 한 번 더 보는 것뿐이다.
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 23, 28)');

    await upload(page, F.txtBefore, F.txtAfter);
    await page.getByRole('button', { name: '비교하기' }).click();
    await expect(page.getByTitle('좌우 바꾸기')).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });

  test('비밀번호 모달 — 틀린 뒤', async ({ page }) => {
    await upload(page, F.pdfLocked, F.pdfLockedCopy);
    await page.getByRole('button', { name: '비교하기' }).click();

    const dialog = page.getByRole('dialog', { name: 'PDF 비밀번호' });
    await dialog.getByLabel('문서 비밀번호').fill('nope');
    await dialog.getByRole('button', { name: '열기' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();

    expect(await audit(page)).toEqual([]);
  });
});

/** axe 는 초점 순서를 보지 않는다. 키보드만으로 실제로 되는지는 따로 눌러 봐야 한다. */
test('키보드만으로 비교하고 변경점을 옮겨 다닌다', async ({ page }) => {
  await upload(page, F.txtBefore, F.txtAfter);

  // Tab 으로 "비교하기" 까지 갈 수 있어야 한다.
  const compare = page.getByRole('button', { name: '비교하기' });
  await page.keyboard.press('Tab');
  for (let i = 0; i < 12 && !(await compare.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(compare).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByTitle('좌우 바꾸기')).toBeVisible();

  // n / p 로 변경점을 오간다.
  await page.keyboard.press('n');
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible(); // 첫 변경점에서 더 못 올라간다

  // s 로 나란히, ? 로 도움말, Esc 로 닫기.
  await page.keyboard.press('s');
  await expect(page.getByRole('button', { name: '나란히' })).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: '단축키' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '단축키' })).toHaveCount(0);
});
