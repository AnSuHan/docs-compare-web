import { expect, test, type Page } from '@playwright/test';
import { F, LOCKED_PASSWORD, fixture } from './fixtures';

/**
 * T-073 / §13.4 — 6개 시나리오 + 암호 PDF(T-040).
 *
 * 여기까지가 "배포할 때마다 사람이 눌러 보던 것"이다. 화면 문구를 그대로
 * 확인한다 — 사용자가 읽는 문장이 바뀌면 테스트도 같이 바뀌어야 한다.
 */

/** 슬롯 순서대로 파일을 넣는다. input 은 sr-only 라 눈에 보이지 않는다. */
async function upload(page: Page, ...names: string[]) {
  const inputs = page.locator('input[type=file]');
  for (let i = 0; i < names.length; i++) {
    await inputs.nth(i).setInputFiles(fixture(names[i]!));
  }
}

const compare = (page: Page) => page.getByRole('button', { name: '비교하기' });
const nextChange = (page: Page) => page.getByTitle('다음 변경점 (n)');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DocDiff' })).toBeVisible();
});

test('1. TXT 두 개 → 비교 → 변경점 점프', async ({ page }) => {
  await upload(page, F.txtBefore, F.txtAfter);
  await compare(page).click();

  // 요약이 떴다 = diff 가 끝났다.
  await expect(page.getByTitle('좌우 바꾸기')).toBeVisible();
  await expect(page.getByText('두 문서가 같습니다.')).toHaveCount(0);

  // 이 제품의 핵심 화면 — 어절 통째가 아니라 조사 한 글자만 강조되어야 한다.
  const modified = page.getByLabel('수정된 문단');
  await expect(modified).toBeVisible();
  await expect(modified.locator('mark')).toHaveText(['를', '는']);

  // 아직 아무 데도 안 갔다 → 0 / N. 한 번 누르면 1 / N.
  await expect(page.getByText(/^0 \/ \d+$/)).toBeVisible();
  await nextChange(page).click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
});

test('2. DOCX 두 개 → 나란히 → 옵션 토글 → 결과 갱신', async ({ page }) => {
  await upload(page, F.docxBefore, F.docxAfter);
  await compare(page).click();

  // 두 파일의 차이는 공백뿐이다. DOCX 기본 옵션은 공백을 무시하므로 같게 나온다.
  await expect(page.getByText('두 문서가 같습니다.')).toBeVisible();

  const split = page.getByRole('button', { name: '나란히' });
  await split.click();
  await expect(split).toHaveAttribute('aria-pressed', 'true');

  // 공백 무시를 끄면 재파싱 없이 결과만 다시 계산된다(§4.3).
  await page.getByLabel('공백 무시').uncheck();

  await expect(page.getByText('두 문서가 같습니다.')).toHaveCount(0);
  await expect(nextChange(page)).toBeVisible();

  // 화면은 나란히 그대로다.
  await expect(split).toHaveAttribute('aria-pressed', 'true');
});

test('3. PDF 두 개 → 진행률 → 취소', async ({ page }) => {
  await upload(page, F.pdfBefore, F.pdfAfter);
  await compare(page).click();

  const progress = page.getByRole('progressbar');
  await expect(progress).toBeVisible();
  await expect(progress).toContainText('페이지');

  await page.getByRole('button', { name: '중단' }).click();

  await expect(page.getByText('처리를 중단했습니다.')).toBeVisible();
  await expect(progress).toHaveCount(0);
});

test('4. PDF + DOCX → 뷰어 분할', async ({ page }) => {
  await upload(page, F.pdfSmall, F.docxBefore);

  // 형식 그룹이 달라 비교로 가지 않는다(D-02).
  await expect(page.getByText('형식이 서로 달라 비교할 수 없습니다. 같은 형식끼리 올려주세요.')).toBeVisible();
  await expect(page.getByText('형식이 서로 달라 비교할 수 없습니다. 내용만 나란히 봅니다.')).toBeVisible();

  // 왼쪽은 캔버스로 그린 PDF, 오른쪽은 파서를 태운 DOCX 본문.
  await expect(page.getByLabel('1 쪽')).toBeVisible();
  await expect(page.getByText('계약 기간은 1년으로 한다.')).toBeVisible();
});

test('5. HWPX 하나 → 단일 뷰어', async ({ page }) => {
  await upload(page, F.hwpx);

  await expect(page.getByText('비교하려면 파일이 하나 더 필요합니다.')).toBeVisible();
  await expect(page.getByText('한글 표본 문서')).toBeVisible();
  await expect(page.getByText('둘째 문단이다.')).toBeVisible();
});

test('6. 손상 파일 → 에러 화면', async ({ page }) => {
  await upload(page, F.docxBefore, F.docxBroken);
  await compare(page).click();

  // 빈 화면이 아니라 문장이 나와야 한다(§10.5).
  await expect(page.getByText('파일을 읽을 수 없습니다. 손상된 것 같습니다.')).toBeVisible();
});

test('7. 암호 PDF → 비밀번호 모달 → 비교 (T-040)', async ({ page }) => {
  await upload(page, F.pdfLocked, F.pdfLockedCopy);
  await compare(page).click();

  // 암호 문서는 에러가 아니라 물어볼 것이 남은 상태다.
  const dialog = page.getByRole('dialog', { name: 'PDF 비밀번호' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('서버로 전송되지 않고, 저장되지도 않습니다.');

  const submit = async (pw: string) => {
    await dialog.getByLabel('문서 비밀번호').fill(pw);
    await dialog.getByRole('button', { name: '열기' }).click();
  };

  // 틀리면 그 자리에서 다시 묻는다.
  await submit('nope');
  await expect(dialog.getByRole('alert')).toContainText('비밀번호가 맞지 않습니다');

  // 파일마다 따로 묻는다 — 비밀번호를 파일별로 들고 있기 때문이다.
  await submit(LOCKED_PASSWORD);
  await expect(dialog).toBeVisible();
  await submit(LOCKED_PASSWORD);

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('두 문서가 같습니다.')).toBeVisible();
});
