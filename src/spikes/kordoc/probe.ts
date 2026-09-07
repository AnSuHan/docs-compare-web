export interface KordocProbeResult {
  installed: boolean;
  imported: boolean;
  /** 실패했다면 무엇 때문인지. Node 내장 모듈 참조면 브라우저 불가 판정. */
  reason?: string;
  exportNames?: string[];
  parsedOk?: boolean;
  sample?: string;
}

const NODE_ONLY = /\b(fs|path|node:|Buffer|process|child_process|os|crypto)\b/;

/**
 * U-01 — kordoc 이 브라우저 번들에서 도는가.
 * 이 한 줄의 답이 M4 의 3주를 좌우한다.
 *
 * 정적 분석을 피하려고 지정자를 변수에 담는다.
 * 패키지가 설치돼 있지 않아도 빌드가 깨지지 않아야 한다.
 */
export async function probeKordoc(file?: File): Promise<KordocProbeResult> {
  const spec = 'kordoc';
  let mod: Record<string, unknown>;

  try {
    mod = (await import(/* @vite-ignore */ spec)) as Record<string, unknown>;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return {
      installed: !/Failed to (resolve|fetch)|Cannot find module/i.test(reason),
      imported: false,
      reason: NODE_ONLY.test(reason)
        ? `Node 전용 의존성으로 보입니다: ${reason}`
        : reason,
    };
  }

  const exportNames = Object.keys(mod);
  const result: KordocProbeResult = { installed: true, imported: true, exportNames };
  if (!file) return result;

  try {
    const parse = mod['parse'] as ((b: ArrayBuffer) => Promise<{ success: boolean; markdown?: string }>) | undefined;
    if (typeof parse !== 'function') return { ...result, parsedOk: false, reason: 'parse() export 없음' };

    const r = await parse(await file.arrayBuffer());
    return { ...result, parsedOk: !!r?.success, sample: (r?.markdown ?? '').slice(0, 300) };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ...result, parsedOk: false, reason };
  }
}
