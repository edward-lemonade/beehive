import type { IntentPublic, Item, RelevantEdge, Signal } from '../../src/contracts/index.js';
import { directlyRelevant } from '../../src/discovery/match.js';
import { localStatus } from '../../src/engine/index.js';

export const ticket = (label: string, qty = 1): Item => ({ kind: 'ticket', label, attrs: {}, qty });
export const cash = (amountCents: number): Item => ({ kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents });

export function intent(
  id: string,
  give: Item[],
  want: Item[][],
  opts: { version?: number; tier?: string } = {},
): IntentPublic {
  return {
    intentId: id,
    version: opts.version ?? 1,
    ownerHandle: `h-${id}`,
    tier: opts.tier ?? 'new',
    give,
    want: want.map((anyOf) => ({ anyOf })),
    deadline: null,
    freeText: '',
  };
}

export const toMap = (list: IntentPublic[]): Map<string, IntentPublic> => new Map(list.map((i) => [i.intentId, i]));

export function edgesFor(intents: Map<string, IntentPublic>): Map<string, RelevantEdge[]> {
  const out = new Map<string, RelevantEdge[]>();
  for (const x of intents.values()) {
    const list: RelevantEdge[] = [];
    for (const y of intents.values()) {
      if (x.intentId === y.intentId) continue;
      const edge = directlyRelevant(x, y);
      if (edge) list.push(edge);
    }
    out.set(x.intentId, list);
  }
  return out;
}

// Simulates the distributed protocol: start all-true and iterate to the greatest fixed point.
export function simulateSignals(intents: Map<string, IntentPublic>, edges: Map<string, RelevantEdge[]>): Signal[] {
  let signals: Signal[] = [];
  for (const [id, list] of edges) {
    for (const e of list) {
      signals.push({
        from: id, to: e.other, fromVersion: intents.get(id)!.version, toVersion: e.otherVersion, satisfiable: true,
      });
    }
  }
  for (let round = 0; round < 200; round += 1) {
    const next = signals.map((s) => ({
      ...s,
      satisfiable: localStatus(intents.get(s.from)!, edges.get(s.from) ?? [], signals).satisfiable,
    }));
    const changed = next.some((s, i) => s.satisfiable !== signals[i]!.satisfiable);
    signals = next;
    if (!changed) break;
  }
  return signals;
}
