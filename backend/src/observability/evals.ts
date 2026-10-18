import { Sentry, log, metric } from './telemetry.js';

/** Everything the graders need about one chat turn. Free text stays in-process; only verdicts leave. */
export type ChatTurnTrace = {
  reply: string;
  /** Text the model was allowed to quote from: the CONTEXT block, the user's message and tool results. */
  groundingText: string;
  actions: string[];
  toolOutcomes: Array<'ok' | 'blocked' | 'failed'>;
  hitMaxSteps: boolean;
  promptLeak: boolean;
  userInjection: boolean;
  flaggedListingsInContext: number;
};

export type Grade = { name: string; pass: boolean; detail?: string };

const MONEY = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const cents = (s: string): number => Math.round(Number(s.replace(/,/g, '')) * 100);

/** Every dollar amount in the reply must appear in what the model was shown. Catches invented prices. */
export function gradeGroundedPrices(reply: string, grounding: string): Grade {
  const allowed = new Set([...grounding.matchAll(MONEY)].map((m) => cents(m[1])));
  const invented = [...reply.matchAll(MONEY)].map((m) => cents(m[1])).filter((c) => !allowed.has(c));
  return { name: 'grounded_prices', pass: invented.length === 0, detail: invented.length ? `${invented.length} unsupported amount(s)` : undefined };
}

/** The prompt forbids these; seeing them means the model ignored a rule. */
export function gradeForbiddenPhrases(reply: string): Grade {
  const hit = /\bfor \$0\b|\bfor free\b|\bproposed\b.*\bswap\b/i.test(reply);
  return { name: 'forbidden_phrases', pass: !hit };
}

export function gradeChatTurn(turn: ChatTurnTrace): Grade[] {
  const blocked = turn.toolOutcomes.filter((o) => o === 'blocked').length;
  const failed = turn.toolOutcomes.filter((o) => o === 'failed').length;
  return [
    gradeGroundedPrices(turn.reply, turn.groundingText),
    gradeForbiddenPhrases(turn.reply),
    { name: 'no_guardrail_block', pass: blocked === 0, detail: blocked ? `${blocked} action(s) refused by a guardrail` : undefined },
    { name: 'no_tool_failure', pass: failed === 0 },
    { name: 'within_step_budget', pass: !turn.hitMaxSteps },
    { name: 'no_prompt_leak', pass: !turn.promptLeak },
    { name: 'reply_length', pass: turn.reply.length > 0 && turn.reply.length <= 900 },
  ];
}

/**
 * Online eval: attaches every grade to the active `invoke_agent` span, emits a score distribution
 * for dashboards/alerts, and opens one Sentry issue per failing grader so regressions are triaged like bugs.
 */
export function recordChatEval(turn: ChatTurnTrace, attrs: { trigger: 'message' | 'event'; userId: string }): { score: number; grades: Grade[] } {
  const grades = gradeChatTurn(turn);
  const passed = grades.filter((g) => g.pass).length;
  const score = passed / grades.length;
  const span = Sentry.getActiveSpan();
  span?.setAttributes({
    'eval.score': score,
    'eval.failed': grades.filter((g) => !g.pass).map((g) => g.name).join(',') || 'none',
    'eval.actions': turn.actions.join(',') || 'none',
    'security.user_injection': turn.userInjection,
    'security.flagged_listings_in_context': turn.flaggedListingsInContext,
    ...Object.fromEntries(grades.map((g) => [`eval.${g.name}`, g.pass])),
  });
  const tags = { trigger: attrs.trigger, injected_context: turn.flaggedListingsInContext > 0 || turn.userInjection };
  metric.dist('agent.eval.score', score, 'ratio', tags);
  for (const g of grades) {
    metric.count('agent.eval.grade', { ...tags, grader: g.name, result: g.pass ? 'pass' : 'fail' });
    if (g.pass) continue;
    log.warn('Agent eval failed', { grader: g.name, detail: g.detail, trigger: attrs.trigger, injected_context: tags.injected_context });
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setFingerprint(['agent-eval', g.name]);
      scope.setTags({ 'eval.grader': g.name, 'eval.trigger': attrs.trigger, 'eval.injected_context': String(tags.injected_context) });
      scope.setContext('eval', { score, failed: g.name, detail: g.detail ?? null, actions: turn.actions, toolOutcomes: turn.toolOutcomes });
      scope.setUser({ id: attrs.userId });
      Sentry.captureMessage(`Agent eval failed: ${g.name}`);
    });
  }
  return { score, grades };
}
