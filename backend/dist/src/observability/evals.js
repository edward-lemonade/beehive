import { Sentry, log, metric } from './telemetry.js';
const OUTBOUND_COMMUNICATION_CLAIM = /\b(?:i|we|my agent|our agent)\s+(?:(?:have|has|had|already|just|previously|['’]ve|['’]d)\s+)*(?:told|asked|messaged|contacted|notified|spoke|talked|reached out|sent|been in touch)\b/i;
const INBOUND_COMMUNICATION_CLAIM = /\b(?:they|the other agent|@[\w.-]+)\s+(?:(?:have|has|had|already|just|previously|['’]ve)\s+)*(?:told|asked|messaged|contacted|notified|replied|responded|sent|offered|accepted|declined|said|spoke|talked)\b|\b(?:i|we)\s+(?:(?:have|had)\s+)?heard back\b/i;
const normalizedName = (name) => name.replace(/^@/, '').replace(/['’]s$/i, '').toLowerCase();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentionsNamedParty = (reply, name, after) => {
    return new RegExp(`\\b@?${escapeRegex(name)}(?:['’]s)?\\s+(?:agent\\s+)?${after.source}`, 'i').test(reply);
};
/** A focused delivery-consistency eval, intentionally separate from the general chat score. */
export function gradeAgentDesync(reply, evidence = { counterparties: [], outbound: [], inbound: [], waitingFor: [], accepted: [] }) {
    const counterparty = (name) => evidence.counterparties.find((candidate) => normalizedName(candidate) === normalizedName(name));
    const waitingClaims = [...reply.matchAll(/\bwait(?:ing)?\s+(?:on|for)\s+@?([\p{L}\w.-]+)(?:['’]s)?(?:\s+(?:answer|reply|response))?/giu)]
        .map((match) => match[1])
        .filter((name) => !['the', 'them', 'their', 'someone'].includes(name.toLowerCase()));
    for (const claimed of waitingClaims) {
        const name = counterparty(claimed);
        if (!name || !evidence.waitingFor.some((waiting) => normalizedName(waiting) === normalizedName(name))) {
            return { result: 'fail', detail: `waiting claim does not match authoritative pending party: ${claimed}` };
        }
    }
    const statusClaims = /\b(?:agreed|accepted|confirmed)\b/i;
    const claimedAgreements = evidence.counterparties.filter((name) => mentionsNamedParty(reply, name, statusClaims));
    for (const name of claimedAgreements) {
        const priceMatch = new RegExp(`\\b@?${escapeRegex(name)}(?:['’]s)?\\s+(?:agent\\s+)?(?:agreed|accepted|confirmed)(?:\\s+to)?\\s+\\$\\s?([\\d,]+(?:\\.\\d{1,2})?)`, 'i').exec(reply);
        const claimedCents = priceMatch ? Math.round(Number(priceMatch[1].replace(/,/g, '')) * 100) : undefined;
        const verified = evidence.accepted.some((entry) => normalizedName(entry.counterparty) === normalizedName(name)
            && (claimedCents === undefined || entry.amountCents === claimedCents));
        if (!verified)
            return { result: 'fail', detail: `agreement claim about ${name} has no matching accepted offer` };
    }
    const claimsOutbound = OUTBOUND_COMMUNICATION_CLAIM.test(reply);
    const claimsInbound = INBOUND_COMMUNICATION_CLAIM.test(reply);
    if (!claimsOutbound && !claimsInbound && waitingClaims.length === 0 && claimedAgreements.length === 0)
        return { result: 'pass' };
    const relevantStatuses = (rows, known) => rows.filter((row) => !known.length || known.some((name) => normalizedName(name) === normalizedName(row.counterparty)));
    const namedParties = evidence.counterparties.filter((name) => new RegExp(`\\b@?${escapeRegex(name)}(?:['’]s)?\\b`, 'i').test(reply));
    const outbound = relevantStatuses(evidence.outbound, namedParties);
    const inbound = relevantStatuses(evidence.inbound, namedParties);
    const unsupported = [];
    const pending = [];
    if (claimsOutbound && !outbound.some((message) => message.status === 'processed')) {
        if (outbound.some((message) => message.status === 'enqueued'))
            pending.push('outbound');
        else
            unsupported.push('outbound');
    }
    if (claimsInbound && !inbound.some((message) => message.status === 'processed')) {
        if (inbound.some((message) => message.status === 'enqueued'))
            pending.push('inbound');
        else
            unsupported.push('inbound');
    }
    if (unsupported.length)
        return { result: 'fail', detail: `unsupported ${unsupported.join(' and ')} communication claim` };
    if (pending.length)
        return { result: 'inconclusive', detail: `delivery still pending for ${pending.join(' and ')} claim` };
    return { result: 'pass' };
}
const MONEY = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const cents = (s) => Math.round(Number(s.replace(/,/g, '')) * 100);
/** Every dollar amount in the reply must appear in what the model was shown. Catches invented prices. */
export function gradeGroundedPrices(reply, grounding) {
    const allowed = new Set([...grounding.matchAll(MONEY)].map((m) => cents(m[1])));
    const invented = [...reply.matchAll(MONEY)].map((m) => cents(m[1])).filter((c) => !allowed.has(c));
    return { name: 'grounded_prices', pass: invented.length === 0, detail: invented.length ? `${invented.length} unsupported amount(s)` : undefined };
}
/** The prompt forbids these; seeing them means the model ignored a rule. */
export function gradeForbiddenPhrases(reply) {
    const hit = /\bfor \$0\b|\bfor free\b|\bproposed\b.*\bswap\b/i.test(reply);
    return { name: 'forbidden_phrases', pass: !hit };
}
export function gradeChatTurn(turn) {
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
export function recordChatEval(turn, attrs) {
    const grades = gradeChatTurn(turn);
    const desync = gradeAgentDesync(turn.reply, turn.communicationEvidence);
    const passed = grades.filter((g) => g.pass).length;
    const score = passed / grades.length;
    const span = Sentry.getActiveSpan();
    span?.setAttributes({
        'eval.score': score,
        'eval.failed': grades.filter((g) => !g.pass).map((g) => g.name).join(',') || 'none',
        'eval.actions': turn.actions.join(',') || 'none',
        'eval.agent_desync': desync.result,
        'security.user_injection': turn.userInjection,
        'security.flagged_listings_in_context': turn.flaggedListingsInContext,
        ...Object.fromEntries(grades.map((g) => [`eval.${g.name}`, g.pass])),
    });
    const tags = { trigger: attrs.trigger, injected_context: turn.flaggedListingsInContext > 0 || turn.userInjection };
    metric.dist('agent.eval.score', score, 'ratio', tags);
    for (const g of grades) {
        metric.count('agent.eval.grade', { ...tags, grader: g.name, result: g.pass ? 'pass' : 'fail' });
        recordEvalResult({ name: g.name, source: 'live', pass: g.pass, detail: g.detail, attrs: { 'eval.trigger': attrs.trigger, 'eval.injected_context': tags.injected_context } });
    }
    recordAgentDesyncEval(desync, {
        trigger: attrs.trigger,
        userId: attrs.userId,
        outboundProcessed: turn.communicationEvidence?.outbound.filter((message) => message.status === 'processed').length ?? 0,
        outboundPending: turn.communicationEvidence?.outbound.filter((message) => message.status === 'enqueued').length ?? 0,
        inboundProcessed: turn.communicationEvidence?.inbound.filter((message) => message.status === 'processed').length ?? 0,
        inboundPending: turn.communicationEvidence?.inbound.filter((message) => message.status === 'enqueued').length ?? 0,
    });
    return { score, grades, desync };
}
function recordAgentDesyncEval(result, attrs) {
    const at = Math.floor(Date.now() / 1000);
    const resultKey = result.result === 'pass' ? 'eval.pass_at'
        : result.result === 'fail' ? 'eval.fail_at' : 'eval.inconclusive_at';
    const attributes = {
        'eval.name': 'agent_desync',
        'eval.category': 'agent_desync',
        'eval.source': 'live',
        'eval.result': result.result,
        [resultKey]: at,
        'eval.trigger': attrs.trigger,
        'eval.detail': result.detail,
        'bus.outbound.processed_count': attrs.outboundProcessed,
        'bus.outbound.pending_count': attrs.outboundPending,
        'bus.inbound.processed_count': attrs.inboundProcessed,
        'bus.inbound.pending_count': attrs.inboundPending,
    };
    Sentry.startSpan({
        op: 'eval.agent_desync',
        name: `eval agent_desync ${result.result}`,
        attributes,
    }, (span) => {
        if (result.result === 'fail')
            span.setStatus({ code: 2, message: 'unsupported_communication_claim' });
    });
    metric.count('agent.desync_eval.result', { result: result.result, trigger: attrs.trigger });
    log[result.result === 'fail' ? 'error' : 'info'](`agent desync eval ${result.result}`, attributes);
    if (result.result !== 'fail')
        return;
    Sentry.withScope((scope) => {
        scope.setLevel('error');
        scope.setFingerprint(['agent-desync', result.detail ?? 'unsupported-communication-claim']);
        scope.setTags({ 'eval.name': 'agent_desync', 'eval.trigger': attrs.trigger });
        scope.setContext('agent_desync', {
            result: result.result,
            detail: result.detail,
            outbound_processed_count: attrs.outboundProcessed,
            outbound_pending_count: attrs.outboundPending,
            inbound_processed_count: attrs.inboundProcessed,
            inbound_pending_count: attrs.inboundPending,
        });
        scope.setUser({ id: attrs.userId });
        Sentry.captureMessage('Agent desync eval failed: unsupported communication claim');
    });
}
/**
 * One `eval` span per eval result. Group a spans table by `eval.name` with `max(eval.pass_at)` and
 * `max(eval.fail_at)`: one row per eval, and whichever timestamp is newer is its latest result.
 */
export function recordEvalResult(r) {
    const result = r.pass ? 'pass' : 'fail';
    const at = Math.floor(Date.now() / 1000);
    Sentry.startSpan({
        op: 'eval',
        name: `eval ${r.name}`,
        attributes: {
            'eval.name': r.name,
            'eval.source': r.source,
            'eval.result': result,
            'eval.pass': r.pass ? 1 : 0,
            [r.pass ? 'eval.pass_at' : 'eval.fail_at']: at,
            'eval.detail': r.detail,
            ...r.attrs,
        },
    }, (span) => {
        if (!r.pass)
            span.setStatus({ code: 2, message: 'eval_failed' });
    });
    const logAttrs = { 'eval.name': r.name, 'eval.source': r.source, 'eval.result': result, 'eval.detail': r.detail, ...r.attrs };
    log[r.pass ? 'info' : 'error'](`eval ${r.name} ${result}`, logAttrs);
    if (!r.pass) {
        Sentry.withScope((scope) => {
            scope.setLevel('error');
            scope.setFingerprint(['agent-eval', r.source, r.name]);
            scope.setTags({ 'eval.name': r.name, 'eval.source': r.source });
            scope.setContext('eval', { result, detail: r.detail ?? null, ...r.attrs });
            Sentry.captureMessage(`Eval failed: ${r.name} (${r.source})`);
        });
    }
}
