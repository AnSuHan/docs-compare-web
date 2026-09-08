import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { pdfParser } from '../src/core/parsers/pdf';
import { DEFAULT_NORMALIZE } from '../src/core/normalize';
import { AppError } from '../src/core/errors';
import type { ParseCtx } from '../src/core/types';
import { makeEncryptedPdf } from './helpers/encryptedPdf';

/**
 * T-040 — 암호 PDF 를 실제로 열어 본다.
 *
 * 에러 분류만 단위로 확인하면 "정말 열리는가" 는 끝까지 아무도 안 본 채 남는다.
 * 여기서는 pdfjs 를 그대로 태워서 세 갈래(안 줌 / 틀림 / 맞음)를 다 지난다.
 */

const PASSWORD = 'yeolryeora';
const LINES = ['Article 1. This document is locked.', 'Article 2. It opens with the password.'];

const ctx = (password?: string): ParseCtx => ({
  progress: () => {},
  shouldAbort: () => false,
  options: DEFAULT_NORMALIZE.pdf,
  password,
});

beforeAll(async () => {
  // node 에는 Worker 전역도 `?url` 임포트도 없다. 파서가 쓰기 전에 경로를 못 박는다.
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve(
      'pdfjs-dist/build/pdf.worker.mjs',
    );
  }
});

describe('암호 PDF 파싱', () => {
  const buf = () => makeEncryptedPdf(PASSWORD, LINES).slice().buffer as ArrayBuffer;

  it('비밀번호 없이 열면 물어봐야 한다고 알린다', async () => {
    await expect(pdfParser.parse(buf(), 'locked.pdf', ctx())).rejects.toMatchObject({
      code: 'PDF_PASSWORD_REQUIRED',
      detail: 'locked.pdf',
    });
  });

  it('틀린 비밀번호는 틀렸다고 알린다 — 다시 물어볼 근거다', async () => {
    await expect(pdfParser.parse(buf(), 'locked.pdf', ctx('wrong'))).rejects.toMatchObject({
      code: 'PDF_PASSWORD_WRONG',
    });
  });

  it('맞는 비밀번호를 주면 본문이 나온다', async () => {
    const doc = await pdfParser.parse(buf(), 'locked.pdf', ctx(PASSWORD));

    expect(doc.blocks.length).toBeGreaterThan(0);
    expect(doc.blocks.map((b) => b.text).join(' ')).toContain('opens with the password');
  });

  it('던지는 것은 AppError 다 — 워커 경계를 넘을 수 있어야 한다', async () => {
    const e = await pdfParser.parse(buf(), 'locked.pdf', ctx()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).toJSON()).toMatchObject({ __appError: true, code: 'PDF_PASSWORD_REQUIRED' });
  });
});
