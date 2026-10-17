import { randomUUID } from 'node:crypto';
import { clock } from '../clock.js';
import { config } from '../config.js';
import type { BusBody, Envelope } from '../contracts/index.js';
import { guard, type GuardContext, type Violation } from './guard.js';
import { runtimeStats } from './metrics.js';

export type BusLogEntry = {
  id: string;
  at: number;
  from: string;
  to: string;
  type: string;
  delivered: boolean;
  violation?: Violation['rule'];
  body?: BusBody;
};

export type GuardContextProvider = (env: Envelope) => Promise<GuardContext>;
export type SendResult = { delivered: boolean; violation?: Violation };
type Handler = (env: Envelope) => void | Promise<void>;

const LOG_LIMIT = 5000;

export function makeEnvelope(from: string, to: string, body: BusBody): Envelope {
  return { id: randomUUID(), from, to, sentAt: clock.now(), trace: {}, body };
}

const logContent = (): boolean =>
  config.BUS_LOG_CONTENT ? config.BUS_LOG_CONTENT === 'true' : process.env.NODE_ENV !== 'production';

export class Bus {
  readonly log: BusLogEntry[] = [];
  private handlers = new Map<string, Handler>();
  private queues = new Map<string, Promise<void>>();
  private violationListeners = new Set<(violation: Violation, env: Envelope) => void>();
  private provider: GuardContextProvider | null = null;

  setGuardContext(provider: GuardContextProvider | null): void {
    this.provider = provider;
  }

  subscribe(intentId: string, handler: Handler): () => void {
    this.handlers.set(intentId, handler);
    return () => {
      if (this.handlers.get(intentId) === handler) this.handlers.delete(intentId);
    };
  }

  onViolation(listener: (violation: Violation, env: Envelope) => void): () => void {
    this.violationListeners.add(listener);
    return () => this.violationListeners.delete(listener);
  }

  // Drop and report on violation; never sanitize and send.
  async send(env: Envelope): Promise<SendResult> {
    if (!this.provider) throw new Error('Bus guard context is not configured');
    const result = guard(env, await this.provider(env));
    const entry: BusLogEntry = {
      id: env.id, at: Date.now(), from: String(env.from), to: String(env.to),
      type: String(env.body?.type), delivered: result.ok,
    };
    if (logContent()) entry.body = env.body;
    if (!result.ok) {
      entry.violation = result.violation.rule;
      this.record(entry);
      runtimeStats.violations += 1;
      for (const listener of this.violationListeners) listener(result.violation, env);
      return { delivered: false, violation: result.violation };
    }
    this.record(entry);

    const handler = this.handlers.get(env.to);
    if (handler) {
      const previous = this.queues.get(env.to) ?? Promise.resolve();
      const next = previous
        .then(() => handler(result.envelope))
        .catch((error) => console.error('bus handler failed', env.to, error));
      this.queues.set(env.to, next);
      void next.finally(() => {
        if (this.queues.get(env.to) === next) this.queues.delete(env.to);
      });
    }
    return { delivered: true };
  }

  async drain(): Promise<void> {
    while (this.queues.size > 0) await Promise.all([...this.queues.values()]);
  }

  reset(): void {
    this.log.length = 0;
    this.handlers.clear();
    this.queues.clear();
    this.violationListeners.clear();
  }

  private record(entry: BusLogEntry): void {
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
}

export const bus = new Bus();
