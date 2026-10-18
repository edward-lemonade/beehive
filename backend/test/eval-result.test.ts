import { beforeEach, describe, expect, it, vi } from 'vitest';

const sink = vi.hoisted(() => ({ spans: [] as Array<{ op: string; name: string; attributes: Record<string, unknown>; status?: unknown }>, logs: [] as Array<{ level: string; message: string }>, issues: [] as Array<{ level: string; message: string }>, scopeLevel: 'info' as string }));
vi.mock('../src/observability/telemetry.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/observability/telemetry.js')>();
  return {
    ...real,
    Sentry: {
      ...real.Sentry,
      startSpan: (opts: { op: string; name: string; attributes: Record<string, unknown> }, fn: (span: unknown) => unknown) => {
        const rec: (typeof sink.spans)[number] = { ...opts };
        sink.spans.push(rec);
        return fn({ setStatus: (s: unknown) => { rec.status = s; }, setAttributes: () => {} });
      },
      getActiveSpan: () => undefined,
      withScope: (fn: (scope: { setLevel: (level: string) => void; setFingerprint: () => void; setTags: () => void; setContext: () => void; setUser: () => void }) => void) => {
        sink.scopeLevel = 'info';
        fn({
          setLevel: (level) => { sink.scopeLevel = level; },
          setFingerprint: () => {},
          setTags: () => {},
          setContext: () => {},
          setUser: () => {},
        });
      },
      captureMessage: (message: string) => sink.issues.push({ level: sink.scopeLevel, message }),
    },
    log: { info: (message: string) => sink.logs.push({ level: 'info', message }), warn: (message: string) => sink.logs.push({ level: 'warn', message }), error: (message: string) => sink.logs.push({ level: 'error', message }) },
  };
});

const { recordChatEval, recordEvalResult } = await import('../src/observability/evals.js');

beforeEach(() => {
  sink.spans.length = 0;
  sink.logs.length = 0;
  sink.issues.length = 0;
});

describe('per-eval results', () => {
  it('writes one eval span per result, stamping pass_at or fail_at so the latest result per eval is queryable', () => {
    recordEvalResult({ name: 'approve_after_offer', source: 'offline', pass: true, attrs: { 'eval.pass_rate': 1 } });
    recordEvalResult({ name: 'injection_in_listing', source: 'offline', pass: false, detail: 'called approve' });
    const [ok, bad] = sink.spans;
    expect(ok).toMatchObject({ op: 'eval', name: 'eval approve_after_offer', attributes: { 'eval.name': 'approve_after_offer', 'eval.source': 'offline', 'eval.result': 'pass', 'eval.pass': 1, 'eval.pass_rate': 1 } });
    expect(ok!.attributes['eval.pass_at']).toEqual(expect.any(Number));
    expect(ok!.attributes['eval.fail_at']).toBeUndefined();
    expect(bad!.attributes).toMatchObject({ 'eval.result': 'fail', 'eval.pass': 0, 'eval.detail': 'called approve' });
    expect(bad!.attributes['eval.fail_at']).toEqual(expect.any(Number));
    expect(bad!.status).toBeDefined();
    expect(sink.logs.map((l) => `${l.level} ${l.message}`)).toEqual(['info eval approve_after_offer pass', 'error eval injection_in_listing fail']);
    expect(sink.issues).toEqual([{ level: 'error', message: 'Eval failed: injection_in_listing (offline)' }]);
  });

  it('emits one live eval span per grader on every chat turn', () => {
    recordChatEval({ reply: 'They offered $500.', groundingText: 'edward offered $200', actions: [], toolOutcomes: [], hitMaxSteps: false, promptLeak: false, userInjection: false, flaggedListingsInContext: 0 }, { trigger: 'message', userId: 'u1' });
    const byName = Object.fromEntries(sink.spans.map((s) => [s.attributes['eval.name'], s.attributes['eval.result']]));
    expect(sink.spans.filter((s) => s.op === 'eval').every((s) => s.attributes['eval.source'] === 'live')).toBe(true);
    expect(byName.grounded_prices).toBe('fail');
    expect(byName.no_prompt_leak).toBe('pass');
    expect(new Set(Object.keys(byName)).size).toBe(sink.spans.length);
    expect(sink.issues.some((issue) => issue.level === 'error' && issue.message === 'Eval failed: grounded_prices (live)'), JSON.stringify(sink.issues)).toBe(true);
  });
});
