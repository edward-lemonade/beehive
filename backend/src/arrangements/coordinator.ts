import { getEdges } from '../discovery/service.js';
import { buildArrangement, findClosedSets } from '../engine/index.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { hooks } from '../runtime/hooks.js';
import { noteBudget, searchBudget } from '../runtime/metrics.js';
import { signalRepo } from '../runtime/signals.js';
import type { RelevantEdge } from '../contracts/index.js';
import {
  isActiveIntentInArrangement,
  onIntentClosed,
  onIntentUpdated,
  proposeDraft,
  rehydrateArrangements,
  retryVacancies,
  stopArrangementTimers,
} from './service.js';

const log = (error: unknown): void => {
  console.error('[coordinator]', error);
};

// One serialized pass: find closed sets among open intents and propose any that are new.
export async function evaluate(): Promise<number> {
  const repo = getIntentRepository();
  const open = await repo.listOpen();
  if (open.length < 2) return 0;

  const intents = new Map(open.map((i) => [i.id, i.public] as const));
  const stored = new Map(open.map((i) => [i.id, i] as const));
  const edges = new Map<string, RelevantEdge[]>();
  for (const intent of open) edges.set(intent.id, await getEdges(intent.id));
  const signals = await signalRepo().all();

  const closed = findClosedSets(intents, signals, edges, searchBudget());
  noteBudget(closed.budgetExhausted, 'closed_sets');

  let proposed = 0;
  for (const set of closed.sets) {
    // Seeding from each member surfaces distinct arrangements that share intents.
    const seen = new Set<string>();
    for (const seed of [...set].sort()) {
      const built = buildArrangement(set, intents, edges, searchBudget(), { seed });
      noteBudget(built.budgetExhausted, 'build_arrangement');
      if (!built.draft || seen.has(built.draft.key)) continue;
      seen.add(built.draft.key);
      if (await proposeDraft(built.draft, stored)) proposed += 1;
    }
  }
  return proposed;
}

class Coordinator {
  coalesceMs = 250;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: Promise<void> | null = null;
  private dirty = false;
  private started = false;

  poke = (): void => {
    if (!this.started) return;
    this.dirty = true;
    if (this.timer || this.current) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.launch();
    }, this.coalesceMs);
  };

  private launch(): void {
    this.dirty = false;
    this.current = (async () => {
      await retryVacancies();
      await evaluate();
    })()
      .catch(log)
      .finally(() => {
        this.current = null;
        if (this.dirty) this.poke();
      });
  }

  async idle(): Promise<void> {
    while (this.timer || this.current || this.dirty) {
      if (this.current) await this.current;
      else await new Promise((resolve) => setTimeout(resolve, this.coalesceMs + 5));
    }
  }

  async start(options: { rehydrate?: boolean } = {}): Promise<void> {
    if (this.started) return;
    this.started = true;
    hooks.hasPendingArrangement = isActiveIntentInArrangement;
    hooks.coordinatorRecipients = async (env) =>
      (await isActiveIntentInArrangement(env.to)) ? new Set([env.to]) : new Set<string>();
    events.on('signal.changed', this.poke);
    events.on('arrangement.dissolved', this.poke);
    events.on('intent.closed', onClosed);
    events.on('intent.updated', onUpdated);
    if (options.rehydrate !== false) await rehydrateArrangements();
    this.poke();
  }

  stop(): void {
    this.started = false;
    events.off('signal.changed', this.poke);
    events.off('arrangement.dissolved', this.poke);
    events.off('intent.closed', onClosed);
    events.off('intent.updated', onUpdated);
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
    stopArrangementTimers();
  }
}

const onClosed = ({ intentId }: { intentId: string }): void => {
  onIntentClosed(intentId).catch(log);
};
const onUpdated = ({ intentId }: { intentId: string }): void => {
  onIntentUpdated(intentId).catch(log);
};

export const coordinator = new Coordinator();
export const startCoordinator = (options?: { rehydrate?: boolean }): Promise<void> => coordinator.start(options);
export const stopCoordinator = (): void => coordinator.stop();
