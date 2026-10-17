import { clock } from '../clock.js';
import { config } from '../config.js';
import type { BusBody, Envelope } from '../contracts/index.js';
import { events } from '../events.js';
import { bus, makeEnvelope } from '../runtime/bus.js';
import { hooks } from '../runtime/hooks.js';
import { negotiationLog } from './log.js';
import {
  nextOffer,
  withinBounds,
  type LinkBounds,
  type LinkResult,
  type SessionState,
  type Side,
} from './pricing.js';
import { templateWording, wording, type WordingContext } from './wording.js';

export const SESSION_TIMEOUT_MS = 15_000;

export type SessionOptions = {
  key: string;
  arrangementId?: string;
  payerId: string;
  receiverId: string;
  bounds: LinkBounds;
  rounds?: number;
  timeoutMs?: number;
};

const sessions = new Map<string, Session>();

class Session {
  readonly done: Promise<LinkResult>;
  private resolve!: (result: LinkResult) => void;
  private reject!: (error: unknown) => void;
  private finished = false;
  private maxRound = 0;
  private readonly rounds: number;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(private readonly opts: SessionOptions) {
    this.rounds = opts.rounds ?? config.NEGOTIATION_ROUNDS;
    this.done = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.timer = setTimeout(() => this.finish({ state: 'failed', rounds: this.maxRound, reason: 'timeout' }), opts.timeoutMs ?? SESSION_TIMEOUT_MS);
  }

  private state(round: number): SessionState {
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

  private bounds(side: Side) {
    return side === 'payer' ? this.opts.bounds.payer : this.opts.bounds.receiver;
  }

  private ids(side: Side): { from: string; to: string } {
    return side === 'payer'
      ? { from: this.opts.payerId, to: this.opts.receiverId }
      : { from: this.opts.receiverId, to: this.opts.payerId };
  }

  finish(result: LinkResult): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    sessions.delete(this.opts.key);
    this.resolve(result);
  }

  fail(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timer);
    sessions.delete(this.opts.key);
    this.reject(error);
  }

  private async record(side: Side, round: number, kind: 'offer' | 'accept' | 'walk' | 'say', amountCents: number | null, text: string | null): Promise<void> {
    const { from, to } = this.ids(side);
    this.maxRound = Math.max(this.maxRound, round);
    await negotiationLog().append({
      linkId: this.opts.key, arrangementId: this.opts.arrangementId ?? null,
      round, from, to, kind, amountCents, text, at: clock.now(),
    });
    events.emit('negotiation.round', { arrangementId: this.opts.arrangementId, linkId: this.opts.key, round });
  }

  private async deliver(side: Side, body: BusBody): Promise<boolean> {
    const { from, to } = this.ids(side);
    return (await bus.send(makeEnvelope(from, to, body))).delivered;
  }

  // Bounds are enforced here, in code, before anything reaches the guard.
  private async sendMoney(side: Side, kind: 'offer' | 'accept', round: number, amountCents: number, tone: WordingContext['tone']): Promise<boolean> {
    if (!withinBounds(side, amountCents, this.bounds(side))) {
      throw new Error(`Out-of-bounds ${kind} on ${this.opts.key} (${side})`);
    }
    const body: BusBody = kind === 'offer'
      ? { type: 'offer', linkId: this.opts.key, round, amountCents }
      : { type: 'accept', linkId: this.opts.key, amountCents };
    if (!(await this.deliver(side, body))) {
      this.finish({ state: 'failed', rounds: this.maxRound, reason: 'blocked' });
      return false;
    }
    await this.record(side, round, kind, amountCents, null);
    await this.say(side, { round, amountCents, tone });
    return true;
  }

  private async say(side: Side, ctx: WordingContext): Promise<void> {
    const generated = await wording(ctx);
    const fallback = templateWording(ctx);
    for (const text of generated === fallback ? [fallback] : [generated, fallback]) {
      if (await this.deliver(side, { type: 'say', linkId: this.opts.key, text })) {
        await this.record(side, ctx.round, 'say', null, text);
        return;
      }
    }
  }

  private async walk(side: Side, round: number): Promise<void> {
    await this.deliver(side, { type: 'walk', linkId: this.opts.key });
    await this.record(side, round, 'walk', null, null);
    this.finish({ state: 'failed', rounds: round, reason: 'no_overlap' });
  }

  async start(): Promise<void> {
    const b = this.opts.bounds;
    if (b.payer.maxCents < 0 || b.receiver.minCents > b.receiver.maxCents) {
      this.finish({ state: 'failed', rounds: 0, reason: 'infeasible' });
      return;
    }
    await this.sendMoney('payer', 'offer', 1, nextOffer(this.state(1), 'payer'), 'open');
  }

  async onEnvelope(env: Envelope): Promise<void> {
    if (this.finished) return;
    const body = env.body;
    if (body.type === 'say') return;
    const side: Side = env.to === this.opts.receiverId ? 'receiver' : 'payer';

    if (body.type === 'walk') {
      this.finish({ state: 'failed', rounds: this.maxRound, reason: 'no_overlap' });
      return;
    }
    if (body.type === 'accept') {
      if (!withinBounds(side, body.amountCents, this.bounds(side))) {
        throw new Error(`Out-of-bounds accept received on ${this.opts.key}`);
      }
      this.finish({ state: 'agreed', amountCents: body.amountCents, rounds: this.maxRound });
      return;
    }
    if (body.type !== 'offer') return;

    const round = body.round;
    if (side === 'receiver') {
      const ask = nextOffer(this.state(round), 'receiver');
      if (body.amountCents >= ask) {
        await this.sendMoney('receiver', 'accept', round, ask, 'accept');
      } else {
        await this.sendMoney('receiver', 'offer', round, nextOffer(this.state(round + 1), 'receiver'), 'counter');
      }
      return;
    }

    const counter = body.amountCents;
    const planned = nextOffer(this.state(round + 1), 'payer');
    if (counter <= planned) await this.sendMoney('payer', 'accept', round, counter, 'accept');
    else if (round < this.rounds) await this.sendMoney('payer', 'offer', round + 1, planned, 'open');
    else await this.walk('payer', round);
  }
}

export async function runSession(opts: SessionOptions): Promise<LinkResult> {
  if (sessions.has(opts.key)) throw new Error(`Negotiation already running for ${opts.key}`);
  const session = new Session(opts);
  sessions.set(opts.key, session);
  session.start().catch((error) => session.fail(error));
  return session.done;
}

export function routeNegotiation(env: Envelope): void {
  const body = env.body as { linkId?: string };
  const session = body.linkId ? sessions.get(body.linkId) : undefined;
  session?.onEnvelope(env).catch((error) => session.fail(error));
}

export function resetSessions(): void {
  for (const session of [...sessions.values()]) {
    session.finish({ state: 'failed', rounds: 0, reason: 'restart' });
  }
  sessions.clear();
}

export function installNegotiation(): void {
  hooks.negotiation = routeNegotiation;
  hooks.resetNegotiation = resetSessions;
}
