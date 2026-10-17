const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));
export class Scheduler {
    run;
    coalesceMs = 250;
    pending = new Map();
    timer;
    running = new Map();
    inflight = new Set();
    flushing = null;
    constructor(run) {
        this.run = run;
    }
    wake(intentId, reason) {
        const reasons = this.pending.get(intentId) ?? new Set();
        reasons.add(reason);
        this.pending.set(intentId, reasons);
        if (this.timer)
            return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flushing = this.flush().finally(() => { this.flushing = null; });
        }, this.coalesceMs);
    }
    async flush() {
        const batch = [...this.pending];
        this.pending.clear();
        for (const [intentId, reasons] of batch) {
            this.launch(intentId, reasons);
            await yieldToEventLoop();
        }
    }
    // Wakes for the same intent never overlap; different intents run concurrently.
    launch(intentId, reasons) {
        const previous = this.running.get(intentId) ?? Promise.resolve();
        const next = previous
            .then(() => this.run(intentId, reasons))
            .catch((error) => console.error('agent wake failed', intentId, error))
            .finally(() => {
            if (this.running.get(intentId) === next)
                this.running.delete(intentId);
            this.inflight.delete(next);
        });
        this.running.set(intentId, next);
        this.inflight.add(next);
    }
    isIdle() {
        return !this.timer && this.pending.size === 0 && this.inflight.size === 0 && !this.flushing;
    }
    async idle() {
        while (!this.isIdle()) {
            await Promise.all([...this.inflight, ...(this.flushing ? [this.flushing] : [])]);
            if (this.timer)
                await new Promise((resolve) => setTimeout(resolve, this.coalesceMs + 5));
        }
    }
    stop() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = undefined;
        this.pending.clear();
    }
}
