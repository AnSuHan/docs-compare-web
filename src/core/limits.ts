export const LIMITS = {
  MAX_FILE_BYTES: 30 * 1024 * 1024,
  WARN_FILE_BYTES: 10 * 1024 * 1024,
  MAX_PDF_PAGES: 1_000,
  MAX_ZIP_ENTRIES: 2_000,
  MAX_UNZIPPED_BYTES: 256 * 1024 * 1024,
  PARSE_TIMEOUT_MS: 120_000,
} as const;

export const DIFF_LIMITS = {
  MAX_BLOCKS_FOR_MYERS: 8_000,
  MAX_TOTAL_BLOCKS: 100_000,
  TIMEOUT_MS: 10_000,
  MAX_INLINE_LEN: 5_000,
} as const;

/** 진행률 폴링 간격. 이 주기로 shouldAbort() 를 확인한다. */
export const ABORT_CHECK_INTERVAL = 1;
