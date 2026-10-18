import { randomUUID } from 'node:crypto';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { events } from '../events.js';
import { bus, makeEnvelope } from '../runtime/bus.js';
import { BoundsViolationError, reportBoundsViolation, reportNegotiationOutcome } from '../observability/monitors.js';
import { Sentry } from '../observability/telemetry.js';
import { hooks } from '../runtime/hooks.js';
import { negotiationLog } from './log.js';
import { nextOffer, withinBounds, } from './pricing.js';
import { templateWording, wording } from './wording.js';
export const SESSION_TIMEOUT_MS = 90_000;
const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
const sessions = new Map();
function messageText(side, body) {
    const speaker = side === 'payer' ? 'Payer agent' : 'Receiver agent';
    switch (body.type) {
        case 'signal': return `${speaker}: Updates negotiation status.`;
        case 'say': return `${speaker}: ${body.text}`;
        case 'offer': return `${speaker}: Offers ${money(body.amountCents)} (round ${body.round}).`;
        case 'accept': return `${speaker}: Accepts ${money(body.amountCents)}.`;
        case 'walk': return `${speaker}: Walks away.`;
    }
}
class Session {
    opts;
    done;
    resolve;
    reject;
    finished = false;
    maxRound = 0;
    rounds;
    timer;
    startedAt = performance.now();
    conversationId = randomUUID();
    agentSpan;
    agentInputs = [];
    agentOutputs = [];
    chatSpanOutputs = new WeakMap();
    agentMessageCount = 0;
    constructor(opts) {
        this.opts = opts;
        this.rounds = opts.rounds ?? config.NEGOTIATION_ROUNDS;
        this.agentSpan = Sentry.startInactiveSpan({
            op: 'gen_ai.invoke_agent',
            name: 'invoke_agent trade-negotiator',
            attributes: {
                'gen_ai.operation.name': 'invoke_agent',
                'gen_ai.agent.name': 'trade-negotiator',
                'gen_ai.conversation.id': this.conversationId,
                'agent.conversation.kind': 'agent_agent',
                'link.id': opts.key,
                'gen_ai.agent.from_id': opts.payerId,
                'gen_ai.agent.to_id': opts.receiverId,
                ...(opts.arrangementId ? { 'arrangement.id': opts.arrangementId } : {}),
            },
        });
        this.done = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        this.timer = setTimeout(() => this.finish({ state: 'failed', rounds: this.maxRound, reason: 'timeout' }), opts.timeoutMs ?? SESSION_TIMEOUT_MS);
    }
    state(round) {
        const b = this.opts.bounds;
        return {
            round,
            rounds: this.rounds,
            payerOpenCents: b.payerOpenCents,
            payerMaxCents: b.payer.maxCents,
            receiverAskCents: b.receiverAskCents,
            receiverMinCents: b.receiver.minCents,
        };
    }
    bounds(side) {
        return side === 'payer' ? this.opts.bounds.payer : this.opts.bounds.receiver;
    }
    ids(side) {
        return side === 'payer'
            ? { from: this.opts.payerId, to: this.opts.receiverId }
            : { from: this.opts.receiverId, to: this.opts.payerId };
    }
    finish(result) {
        if (this.finished)
            return;
        this.finished = true;
        clearTimeout(this.timer);
        sessions.delete(this.opts.key);
        this.agentSpan.setAttributes({
            'agent.conversation.state': result.state,
            'agent.conversation.rounds': result.rounds,
            'agent.conversation.message_count': this.agentMessageCount,
            ...(result.state === 'failed' ? { 'agent.conversation.failure_reason': result.reason } : {}),
            ...(config.SENTRY_CONVERSATION_LOG ? {
                'gen_ai.input.messages': JSON.stringify(this.agentInputs),
                'gen_ai.output.messages': JSON.stringify(this.agentOutputs),
            } : {}),
        });
        if (result.state === 'failed')
            this.agentSpan.setStatus({ code: 2, message: result.reason });
        this.agentSpan.end();
        reportNegotiationOutcome({
            linkId: this.opts.key,
            state: result.state,
            reason: result.state === 'failed' ? result.reason : undefined,
            rounds: result.rounds,
            pendingUser: result.state === 'agreed' ? result.pendingUser : undefined,
            durationMs: performance.now() - this.startedAt,
        });
        this.resolve(result);
    }
    fail(error) {
        if (this.finished)
            return;
        this.finished = true;
        clearTimeout(this.timer);
        sessions.delete(this.opts.key);
        this.agentSpan.setStatus({ code: 2, message: error instanceof Error ? error.message : 'negotiation_failed' });
        this.agentSpan.end();
        if (error instanceof BoundsViolationError)
            reportBoundsViolation(error);
        this.reject(error);
    }
    recordAgentMessage(direction, side, text) {
        this.agentMessageCount += 1;
        if (!config.SENTRY_CONVERSATION_LOG)
            return;
        const speaker = side === 'payer' ? 'Payer agent' : 'Receiver agent';
        const part = { type: 'text', content: `${speaker}: ${text}`.slice(0, 1000) };
        if (direction === 'input' && this.agentInputs.length < 100) {
            this.agentInputs.push({ role: 'user', parts: [part] });
        }
        else if (direction === 'output' && this.agentOutputs.length < 100) {
            this.agentOutputs.push({ role: 'assistant', parts: [part] });
        }
    }
    async record(side, round, kind, amountCents, text) {
        const { from, to } = this.ids(side);
        this.maxRound = Math.max(this.maxRound, round);
        await negotiationLog().append({
            linkId: this.opts.key, arrangementId: this.opts.arrangementId ?? null,
            round, from, to, kind, amountCents, text, at: clock.now(),
        });
        events.emit('negotiation.round', {
            arrangementId: this.opts.arrangementId, linkId: this.opts.key, round,
            fromIntentId: from, toIntentId: to, kind, amountCents, text,
        });
    }
    async deliver(side, body) {
        const { from, to } = this.ids(side);
        const delivered = (await bus.send(makeEnvelope(from, to, body))).delivered;
        if (delivered) {
            const span = Sentry.getActiveSpan();
            const outputs = span ? this.chatSpanOutputs.get(span) : undefined;
            if (span && outputs) {
                outputs.push({ role: 'assistant', parts: [{ type: 'text', content: messageText(side, body).slice(0, 1000) }] });
                span.setAttribute('gen_ai.output.messages', JSON.stringify(outputs));
            }
        }
        return delivered;
    }
    async withChatSpan(input, fn) {
        if (!config.SENTRY_CONVERSATION_LOG)
            return fn();
        return Sentry.startSpan({
            op: 'gen_ai.chat',
            name: 'chat trade-negotiator',
            attributes: {
                'gen_ai.operation.name': 'chat',
                'gen_ai.agent.name': 'trade-negotiator',
                'gen_ai.conversation.id': this.conversationId,
                ...(input ? {
                    'gen_ai.input.messages': JSON.stringify([{
                            role: 'user',
                            parts: [{ type: 'text', content: messageText(input.side, input.body).slice(0, 1000) }],
                        }]),
                } : {}),
            },
        }, async (span) => {
            this.chatSpanOutputs.set(span, []);
            try {
                return await fn();
            }
            finally {
                this.chatSpanOutputs.delete(span);
            }
        });
    }
    // Bounds are enforced here, in code, before anything reaches the guard.
    async sendMoney(side, kind, round, amountCents, tone) {
        if (!withinBounds(side, amountCents, this.bounds(side))) {
            throw new BoundsViolationError(`Out-of-bounds ${kind} on ${this.opts.key} (${side})`, this.opts.key, side);
        }
        // The agent says its line first so the conversation reads in order, before the reply it triggers.
        await this.say(side, { round, amountCents, tone });
        const body = kind === 'offer'
            ? { type: 'offer', linkId: this.opts.key, round, amountCents }
            : { type: 'accept', linkId: this.opts.key, amountCents };
        if (!(await this.deliver(side, body))) {
            this.finish({ state: 'failed', rounds: this.maxRound, reason: 'blocked' });
            return false;
        }
        this.recordAgentMessage('output', side, kind === 'offer' ? `Offers ${money(amountCents)} (round ${round}).` : `Accepts ${money(amountCents)}.`);
        await this.record(side, round, kind, amountCents, null);
        return true;
    }
    async say(side, ctx) {
        const generated = await wording(ctx);
        const fallback = templateWording(ctx);
        // The guard blocks any line whose number matches a private bound, so the last resort names no amount; the offer itself carries it.
        const plain = templateWording({ ...ctx, amountCents: null });
        for (const text of [...new Set([generated, fallback, plain])]) {
            if (await this.deliver(side, { type: 'say', linkId: this.opts.key, text })) {
                this.recordAgentMessage('output', side, text);
                await this.record(side, ctx.round, 'say', null, text);
                return;
            }
        }
    }
    // The payer never named a price, so the agent stops and hands the counter-price to its user instead of accepting.
    async askUser(side, round, amountCents) {
        await this.say(side, { round, amountCents, tone: side === 'payer' ? 'defer' : 'review' });
        const { from, to } = this.ids(side);
        // Arrangements publish their update only after the proposal is persisted.
        if (!this.opts.arrangementId) {
            events.emit('negotiation.awaiting_user', {
                linkId: this.opts.key, intentId: from, counterpartIntentId: to, amountCents, side,
            });
        }
        this.finish({ state: 'agreed', amountCents, rounds: this.maxRound, pendingUser: true, pendingSide: side });
    }
    async walk(side, round) {
        await this.deliver(side, { type: 'walk', linkId: this.opts.key });
        this.recordAgentMessage('output', side, 'Walks away.');
        await this.record(side, round, 'walk', null, null);
        this.finish({ state: 'failed', rounds: round, reason: 'no_overlap' });
    }
    async start() {
        return Sentry.withActiveSpan(this.agentSpan, () => this.withChatSpan(undefined, () => this.startTurn()));
    }
    async startTurn() {
        const b = this.opts.bounds;
        if (b.payer.maxCents < 0 || b.receiver.minCents > b.receiver.maxCents) {
            this.finish({ state: 'failed', rounds: 0, reason: 'infeasible' });
            return;
        }
        if (b.sellerLed) {
            await this.sendMoney('receiver', 'offer', 1, nextOffer(this.state(1), 'receiver'), 'counter');
            return;
        }
        await this.sendMoney('payer', 'offer', 1, nextOffer(this.state(1), 'payer'), 'open');
    }
    async onEnvelope(env) {
        const side = env.to === this.opts.receiverId ? 'receiver' : 'payer';
        const sender = side === 'receiver' ? 'payer' : 'receiver';
        return Sentry.withActiveSpan(this.agentSpan, () => this.withChatSpan({ side: sender, body: env.body }, () => this.receiveTurn(env)));
    }
    async receiveTurn(env) {
        if (this.finished)
            return;
        const body = env.body;
        const side = env.to === this.opts.receiverId ? 'receiver' : 'payer';
        const sender = side === 'receiver' ? 'payer' : 'receiver';
        if (body.type === 'say') {
            this.recordAgentMessage('input', sender, body.text);
            return;
        }
        if (body.type === 'offer')
            this.recordAgentMessage('input', sender, `Offers ${money(body.amountCents)} (round ${body.round}).`);
        else if (body.type === 'accept')
            this.recordAgentMessage('input', sender, `Accepts ${money(body.amountCents)}.`);
        else if (body.type === 'walk')
            this.recordAgentMessage('input', sender, 'Walks away.');
        if (body.type === 'walk') {
            this.finish({ state: 'failed', rounds: this.maxRound, reason: 'no_overlap' });
            return;
        }
        if (body.type === 'accept') {
            if (!withinBounds(side, body.amountCents, this.bounds(side))) {
                throw new BoundsViolationError(`Out-of-bounds accept received on ${this.opts.key}`, this.opts.key, side);
            }
            this.finish({ state: 'agreed', amountCents: body.amountCents, rounds: this.maxRound });
            return;
        }
        if (body.type !== 'offer')
            return;
        const round = body.round;
        if (side === 'receiver') {
            const ask = nextOffer(this.state(round), 'receiver');
            // A price with no stated floor is only an ask: the seller's user decides on anything lower.
            if (this.opts.bounds.receiver.floorStated === false && body.amountCents > 0 && body.amountCents < ask) {
                await this.askUser('receiver', round, body.amountCents);
                return;
            }
            if (this.opts.bounds.directed && body.amountCents < ask) {
                if (body.amountCents >= this.opts.bounds.receiver.minCents)
                    await this.askUser('receiver', round, body.amountCents);
                else {
                    await this.say('receiver', { round, amountCents: null, tone: 'walk' });
                    await this.walk('receiver', round);
                }
                return;
            }
            if (body.amountCents >= ask) {
                await this.sendMoney('receiver', 'accept', round, body.amountCents, 'accept');
            }
            else {
                await this.sendMoney('receiver', 'offer', round, nextOffer(this.state(round + 1), 'receiver'), 'counter');
            }
            return;
        }
        const counter = body.amountCents;
        const planned = nextOffer(this.state(round + 1), 'payer');
        const b = this.opts.bounds;
        // No stated price: any counter above the opening is the user's call, so stop haggling and ask.
        if (b.payerNegotiable && (b.sellerLed || counter > b.payerOpenCents) && counter <= b.payer.maxCents) {
            await this.askUser('payer', round, counter);
            return;
        }
        if (counter <= planned)
            await this.sendMoney('payer', 'accept', round, counter, 'accept');
        else if (round < this.rounds)
            await this.sendMoney('payer', 'offer', round + 1, planned, 'open');
        else
            await this.walk('payer', round);
    }
}
export async function runSession(opts) {
    if (sessions.has(opts.key))
        throw new Error(`Negotiation already running for ${opts.key}`);
    const session = new Session(opts);
    sessions.set(opts.key, session);
    session.start().catch((error) => session.fail(error));
    return session.done;
}
export function routeNegotiation(env) {
    const body = env.body;
    const session = body.linkId ? sessions.get(body.linkId) : undefined;
    session?.onEnvelope(env).catch((error) => session.fail(error));
}
export function resetSessions() {
    for (const session of [...sessions.values()]) {
        session.finish({ state: 'failed', rounds: 0, reason: 'restart' });
    }
    sessions.clear();
}
export function installNegotiation() {
    hooks.negotiation = routeNegotiation;
    hooks.resetNegotiation = resetSessions;
}
