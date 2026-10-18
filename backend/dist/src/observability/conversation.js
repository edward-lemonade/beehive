import { arrangementRepo } from '../arrangements/repository.js';
import { config } from '../config.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { bus } from '../runtime/bus.js';
import { Sentry } from './telemetry.js';
const enabled = () => config.SENTRY_CONVERSATION_LOG && Boolean(Sentry.getClient());
const money = (cents) => (typeof cents === 'number' ? `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}` : 'unknown');
const clip = (s, n = 600) => (s.length > n ? `${s.slice(0, n)}…` : s);
const short = (id) => id.slice(0, 8);
let seq = 0;
// Lines are emitted through one queue so async handle lookups can never reorder them.
let queue = Promise.resolve();
function emit(channel, message, attrs, level = 'info') {
    const all = { 'conv.channel': channel, 'conv.seq': (seq += 1), ...attrs };
    const clean = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined && v !== null));
    Sentry.logger[level](message, clean);
}
/** Queues work that resolves names before logging, keeping the caller's trace so each line links to its trace. */
function enqueue(work) {
    if (!enabled())
        return;
    const span = Sentry.getActiveSpan() ?? null;
    queue = queue.then(() => Sentry.withActiveSpan(span, work)).catch(() => { });
}
const intentHandles = new Map();
function handleOfIntent(intentId) {
    if (intentId === 'coordinator')
        return Promise.resolve('coordinator');
    let found = intentHandles.get(intentId);
    if (!found) {
        found = getIntentRepository().get(intentId).then((i) => (i ? `@${i.public.ownerHandle}` : `intent ${short(intentId)}`), () => `intent ${short(intentId)}`);
        intentHandles.set(intentId, found);
    }
    return found;
}
const agentOf = (handle) => (handle === 'coordinator' ? 'coordinator' : `${handle}'s agent`);
/** One delivered agent↔agent message from a negotiation. */
export function logRound(r) {
    enqueue(async () => {
        if (!r.fromIntentId || !r.toIntentId)
            return;
        const [from, to] = await Promise.all([handleOfIntent(r.fromIntentId), handleOfIntent(r.toIntentId)]);
        const summary = r.kind === 'say' ? `"${clip(r.text ?? '')}"`
            : r.kind === 'offer' ? `offers ${money(r.amountCents)} (round ${r.round})`
                : r.kind === 'accept' ? `accepts ${money(r.amountCents)}`
                    : r.kind === 'walk' ? 'walks away' : r.kind;
        emit('agent_agent', `[agent↔agent] ${agentOf(from)} → ${agentOf(to)}: ${summary}`, {
            'conv.kind': r.kind,
            'conv.from': agentOf(from),
            'conv.to': agentOf(to),
            'conv.from_user': from,
            'conv.to_user': to,
            'conv.text': r.text ? clip(r.text) : undefined,
            'conv.amount_usd': typeof r.amountCents === 'number' ? r.amountCents / 100 : undefined,
            'conv.round': r.round,
            'link.id': r.linkId,
            'arrangement.id': r.arrangementId,
        });
    });
}
/** A bus message the guard dropped. Content violations leaked a private bound, so the words are withheld. */
export function logBlocked(env, rule) {
    enqueue(async () => {
        const [from, to] = await Promise.all([handleOfIntent(String(env.from)), handleOfIntent(String(env.to))]);
        const body = env.body;
        const showText = rule !== 'content' && typeof body.text === 'string';
        emit('agent_agent', `[agent↔agent] BLOCKED ${agentOf(from)} → ${agentOf(to)}: ${String(body.type)} dropped by guard (${rule})${showText ? ` "${clip(body.text)}"` : ''}`, {
            'conv.kind': `blocked_${String(body.type)}`,
            'conv.from': agentOf(from),
            'conv.to': agentOf(to),
            'conv.from_user': from,
            'conv.to_user': to,
            'conv.text': showText ? clip(body.text) : undefined,
            'conv.delivered': false,
            'conv.violation': rule,
            'link.id': body.linkId,
        }, 'warn');
    });
}
/** The agent stopped negotiating and handed the price decision to its user. */
function logHandoff(e) {
    enqueue(async () => {
        const who = await handleOfIntent(e.intentId);
        const other = e.counterpartIntentId ? await handleOfIntent(e.counterpartIntentId) : 'the other side';
        emit('agent_agent', `[agent↔agent] ${agentOf(who)} pauses talks with ${agentOf(other)}: asking ${who} about ${money(e.amountCents)}`, {
            'conv.kind': 'awaiting_user',
            'conv.from': agentOf(who),
            'conv.to': who,
            'conv.amount_usd': typeof e.amountCents === 'number' ? e.amountCents / 100 : undefined,
            'link.id': e.linkId,
            'arrangement.id': e.arrangementId,
        });
    });
}
/** A stored chat line between a user and their own agent. */
export function logChatMessage(m) {
    enqueue(async () => {
        const who = m.handle ? `@${m.handle}` : `user ${short(m.userId)}`;
        const line = m.from === 'me' ? `${who} → their agent` : `${agentOf(who)} → ${who}`;
        emit('user_agent', `[user↔agent] ${line}: "${clip(m.text)}"`, {
            'conv.kind': m.from === 'me' ? 'user_message' : 'agent_message',
            'conv.from': m.from === 'me' ? who : agentOf(who),
            'conv.to': m.from === 'me' ? agentOf(who) : who,
            'conv.user': who,
            'conv.text': clip(m.text),
            'conv.key': m.key,
            'arrangement.id': m.arrangementId,
        });
    });
}
/** One tool the chat agent ran for its user, with what it got back. */
export function logToolCall(t) {
    enqueue(async () => {
        const who = `@${t.handle}`;
        const { type, ...args } = t.action;
        const argText = Object.entries(args)
            .map(([k, v]) => `${k}=${typeof v === 'number' && /cents/i.test(k) ? money(v) : typeof v === 'string' && /id$/i.test(k) ? short(v) : JSON.stringify(v)}`)
            .join(', ');
        const arrangementId = typeof args.arrangementId === 'string' ? args.arrangementId : undefined;
        emit('tool', `[tool] ${agentOf(who)} ran ${type}(${argText}) → ${t.outcome}: ${clip(t.result, 400)}`, {
            'conv.kind': 'tool_call',
            'conv.from': agentOf(who),
            'conv.user': who,
            'conv.tool': type,
            'conv.tool_args': clip(JSON.stringify(args), 600),
            'conv.tool_result': clip(t.result),
            'conv.tool_outcome': t.outcome,
            'conv.duration_ms': Math.round(t.durationMs),
            'arrangement.id': arrangementId,
        }, t.outcome === 'ok' ? 'info' : 'warn');
    });
}
/** A deal milestone with its full terms: who gives what to whom, and who pays how much. */
export function logDeal(stage, arrangementId, extra = {}) {
    enqueue(async () => {
        const arr = await arrangementRepo().get(arrangementId);
        const parts = [];
        const handles = [];
        let totalCents = 0;
        let hasUnpricedLink = false;
        if (arr) {
            for (const slot of arr.slots)
                handles.push(await handleOfIntent(slot.intentId));
            for (const link of arr.links) {
                const [a, b] = await Promise.all([handleOfIntent(link.a), handleOfIntent(link.b)]);
                const flows = await Promise.all(link.flows.map(async (f) => `${await handleOfIntent(f.from)} gives ${f.item.qty > 1 ? `${f.item.qty}× ` : ''}${f.item.label} to ${await handleOfIntent(f.to)}`));
                let cash = '';
                if (link.payer) {
                    const payer = link.payer === link.a ? a : b;
                    const payee = link.payer === link.a ? b : a;
                    if (link.amountCents === null) {
                        hasUnpricedLink = true;
                        cash = `price not set; seller ${payee} must name the asking price; buyer ${payer} is waiting`;
                    }
                    else {
                        cash = `${payer} pays ${payee} ${money(link.amountCents)}`;
                        totalCents += link.amountCents;
                    }
                }
                parts.push([...flows, cash].filter(Boolean).join(', '));
            }
        }
        const by = extra.intentId ? ` by ${await handleOfIntent(extra.intentId)}` : '';
        const why = extra.reason ? ` (${extra.reason})` : '';
        emit('deal', `[deal] ${stage.toUpperCase()}${by}${why} · deal ${short(arrangementId)}: ${parts.join(' | ') || 'terms unavailable'}`, {
            'conv.kind': `deal_${stage}`,
            'conv.stage': stage,
            'conv.participants': handles.join(', '),
            'conv.terms': clip(parts.join(' | '), 1000),
            'conv.total_usd': hasUnpricedLink ? undefined : totalCents / 100,
            'conv.reason': extra.reason,
            'conv.by': extra.intentId ? await handleOfIntent(extra.intentId) : undefined,
            'arrangement.id': arrangementId,
        });
    });
}
let installed = false;
export function installConversationLog() {
    if (installed)
        return;
    installed = true;
    events.on('negotiation.round', logRound);
    events.on('negotiation.awaiting_user', logHandoff);
    events.on('arrangement.proposed', ({ arrangementId }) => logDeal('proposed', arrangementId));
    events.on('arrangement.approved', ({ arrangementId, intentId }) => logDeal('approved', arrangementId, { intentId }));
    events.on('arrangement.committed', ({ arrangementId }) => logDeal('committed', arrangementId));
    events.on('arrangement.dissolved', ({ arrangementId, reason }) => logDeal('dissolved', arrangementId, { reason }));
    bus.onViolation((violation, env) => logBlocked(env, violation.rule));
}
/** Waits for queued lines; for tests and graceful shutdown. */
export function conversationLogIdle() {
    return queue;
}
