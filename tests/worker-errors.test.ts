import { describe, expect, it } from 'vitest';
import { AppError, isAppErrorPayload } from '../src/core/errors';

/**
 * 워커 경계에서 에러 코드가 살아남는지.
 *
 * Comlink 는 던져진 Error 를 message/name/stack 으로만 직렬화한다. AppError 를
 * 그대로 던지면 `code` 가 사라지고, 화면은 어떤 실패든 문구만 같은 CORRUPTED 로
 * 본다 — 암호 PDF 에서 비밀번호를 물어볼 수조차 없었다(E2E 시나리오 7 이 잡았다).
 * 그래서 워커는 toJSON() 으로 바꿔 던지고 클라이언트가 되살린다.
 */
describe('AppError 직렬화', () => {
  it('toJSON 은 구조화 복제를 지나도 코드를 지킨다', () => {
    const payload = structuredClone(new AppError('PDF_PASSWORD_WRONG', 'a.pdf').toJSON());

    expect(isAppErrorPayload(payload)).toBe(true);
    expect(payload).toMatchObject({ code: 'PDF_PASSWORD_WRONG', detail: 'a.pdf' });
  });

  it('클라이언트는 payload 에서 같은 코드의 AppError 를 다시 만든다', () => {
    const payload = new AppError('SCANNED_PDF', 'scan.pdf').toJSON();
    const restored = new AppError(payload.code, payload.detail);

    expect(restored.code).toBe('SCANNED_PDF');
    expect(restored.message).toBe(new AppError('SCANNED_PDF').message);
  });

  it('Comlink 가 Error 를 눌러 담은 모양은 payload 로 보지 않는다', () => {
    // Comlink 의 throw 핸들러가 만드는 것과 같은 모양 — 코드가 없다.
    const flattened = { message: '암호가 걸린 PDF 입니다.', name: 'AppError', stack: '...' };

    expect(isAppErrorPayload(flattened)).toBe(false);
  });
});
