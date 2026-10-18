import { continueFrom, traceHeaders, type TraceHeaders } from '../observability/telemetry.js';
import type { WakeReason } from './agent.js';

export type WakeRunner = (intentId: string, reasons: ReadonlySet<WakeReason>) => Promise<void>;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class Scheduler {
  coalesceMs = 250;
  private pending = new Map<string, Set<WakeReason>>();
  // The first caller's trace, so a coalesced wake still shows up in the trace that caused it.
  private origins = new Map<string, TraceHeaders>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = new Map<string, Promise<void>>();
  private inflight = new Set<Promise<void>>();
  private flushing: Promise<void> | null = null;

  constructor(private readonly run: WakeRunner) {}

  wake(intentId: string, reason: WakeReason): void {
    const reasons = this.pending.get(intentId) ?? new Set<WakeReason>();
    reasons.add(reason);
    this.pending.set(intentId, reasons);
    if (!this.origins.has(intentId)) this.origins.set(intentId, traceHeaders());
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flushing = this.flush().finally(() => { this.flushing = null; });
    }, this.coalesceMs);
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending];
    const origins = new Map(this.origins);
    this.pending.clear();
    this.origins.clear();
    for (const [intentId, reasons] of batch) {
      this.launch(intentId, reasons, origins.get(intentId));
      await yieldToEventLoop();
    }
  }

  // Wakes for the same intent never overlap; different intents run concurrently.
  private launch(intentId: string, reasons: ReadonlySet<WakeReason>, origin?: TraceHeaders): void {
    const previous = this.running.get(intentId) ?? Promise.resolve();
    const next: Promise<void> = previous
      .then(() => continueFrom(origin, () => this.run(intentId, reasons)))
      .catch((error) => console.error('agent wake failed', intentId, error))
      .finally(() => {
        if (this.running.get(intentId) === next) this.running.delete(intentId);
        this.inflight.delete(next);
      });
    this.running.set(intentId, next);
    this.inflight.add(next);
  }

  isIdle(): boolean {
    return !this.timer && this.pending.size === 0 && this.inflight.size === 0 && !this.flushing;
  }

  async idle(): Promise<void> {
    while (!this.isIdle()) {
      await Promise.all([...this.inflight, ...(this.flushing ? [this.flushing] : [])]);
      if (this.timer) await new Promise((resolve) => setTimeout(resolve, this.coalesceMs + 5));
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    this.origins.clear();
  }
}
