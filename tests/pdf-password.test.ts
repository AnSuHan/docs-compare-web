import { beforeEach, describe, expect, it } from 'vitest';
import { toAppError } from '../src/core/parsers/pdf';
import { messageFor } from '../src/core/errors';
import { fileKey, useApp } from '../src/store';

/** pdfjs 의 PasswordException 을 흉내낸다. name 과 code 만 보고 분류한다. */
function passwordException(code: number) {
  const e = new Error('No password given');
  e.name = 'PasswordException';
  (e as Error & { code: number }).code = code;
  return e;
}

describe('T-040 — 암호 PDF 에러 분류', () => {
  it('비밀번호를 아직 안 준 경우와 틀린 경우를 가른다', () => {
    expect(toAppError(passwordException(1), 'a.pdf').code).toBe('PDF_PASSWORD_REQUIRED');
    expect(toAppError(passwordException(2), 'a.pdf').code).toBe('PDF_PASSWORD_WRONG');
  });

  it('어느 파일인지 detail 에 남긴다 — UI 가 슬롯을 찾는 근거다', () => {
    expect(toAppError(passwordException(1), '공고문.pdf').detail).toBe('공고문.pdf');
  });

  it('손상된 PDF 는 여전히 CORRUPTED 다', () => {
    const e = new Error('bad xref');
    e.name = 'InvalidPDFException';
    expect(toAppError(e, 'a.pdf').code).toBe('CORRUPTED');
  });

  it('두 코드 모두 사용자에게 보여줄 문장이 있다', () => {
    expect(messageFor('PDF_PASSWORD_REQUIRED')).toContain('비밀번호');
    expect(messageFor('PDF_PASSWORD_WRONG')).toContain('비밀번호');
  });
});

describe('T-040 — 비밀번호 상태', () => {
  const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], '잠긴문서.pdf');

  beforeEach(() => {
    useApp.getState().reset();
  });

  it('뷰어에서 물으면 모달 상태가 열린다', () => {
    const f = pdf();
    useApp.getState().askPassword(f, false);

    const ask = useApp.getState().passwordAsk;
    expect(ask).toMatchObject({ key: fileKey(f), fileName: '잠긴문서.pdf', wrong: false, source: 'viewer' });
  });

  it('비밀번호를 넣으면 파일별로 보관하고 모달을 닫는다', async () => {
    const f = pdf();
    useApp.getState().askPassword(f, true);
    await useApp.getState().submitPassword('열려라');

    expect(useApp.getState().passwordAsk).toBeNull();
    expect(useApp.getState().passwords[fileKey(f)]).toBe('열려라');
  });

  it('뷰어에서 취소하면 조용히 닫힌다', () => {
    useApp.getState().askPassword(pdf(), false);
    useApp.getState().dismissPassword();

    expect(useApp.getState().passwordAsk).toBeNull();
    expect(useApp.getState().error).toBeNull();
  });

  it('비교하다 취소하면 빈 화면 대신 이유를 남긴다', () => {
    const f = pdf();
    useApp.setState({ passwordAsk: { key: fileKey(f), fileName: f.name, wrong: false, source: 'compare' } });
    useApp.getState().dismissPassword();

    expect(useApp.getState().passwordAsk).toBeNull();
    expect(useApp.getState().error?.code).toBe('PDF_PASSWORD_REQUIRED');
  });

  it('처음부터 를 누르면 비밀번호도 함께 버린다', async () => {
    const f = pdf();
    useApp.getState().askPassword(f, false);
    await useApp.getState().submitPassword('열려라');
    useApp.getState().reset();

    expect(useApp.getState().passwords).toEqual({});
    expect(useApp.getState().passwordAsk).toBeNull();
  });
});
