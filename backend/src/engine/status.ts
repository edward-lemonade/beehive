import type { IntentPublic, RelevantEdge, Signal } from '../contracts/index.js';
import { candidatesBySlot, slotsOf } from './slots.js';
import { BudgetMeter, type Budget, type Id, type SlotId } from './types.js';

export type LocalStatus = {
  satisfiable: boolean;
  covers: Record<SlotId, Id[]>;
};

// An intent with no non-cash slots cannot trade, so it is never satisfiable.
export function localStatus(self: IntentPublic, edges: RelevantEdge[], incoming: Signal[]): LocalStatus {
  const versions = new Map(edges.filter((e) => e.self === self.intentId).map((e) => [e.other, e.otherVersion]));
  const trusted = new Set(
    incoming
      .filter((s) => s.to === self.intentId && s.satisfiable
        && s.toVersion === self.version && s.fromVersion === versions.get(s.from))
      .map((s) => s.from),
  );
  const covers: Record<SlotId, Id[]> = {};
  let satisfiable = false;
  const slots = slotsOf(self);
  const candidates = candidatesBySlot(self, edges);
  satisfiable = slots.length > 0;
  for (const slot of slots) {
    covers[slot.id] = (candidates.get(slot.id) ?? []).filter((other) => trusted.has(other));
    if (covers[slot.id]!.length === 0) satisfiable = false;
  }
  return { satisfiable, covers };
}

// Greatest fixed point: repeatedly drop intents with an uncovered slot, driven by a queue keyed by neighbor.
export function pruneToReady(intents: Map<Id, IntentPublic>, edges: Map<Id, RelevantEdge[]>): Set<Id> {
  const isCurrent = (other: Id, version: number): boolean => intents.get(other)?.version === version;
  const liveCount = new Map<string, number>();
  const dependents = new Map<Id, Array<{ intent: Id; slot: SlotId }>>();
  const alive = new Set(intents.keys());
  const queue: Id[] = [];

  for (const [id, intent] of intents) {
    const slots = slotsOf(intent);
    if (slots.length === 0) {
      alive.delete(id);
      queue.push(id);
      continue;
    }
    const candidates = candidatesBySlot(intent, edges.get(id) ?? [], isCurrent);
    for (const slot of slots) {
      const others = (candidates.get(slot.id) ?? []).filter((other) => other !== id);
      liveCount.set(`${id}#${slot.id}`, others.length);
      for (const other of others) {
        const list = dependents.get(other) ?? [];
        list.push({ intent: id, slot: slot.id });
        dependents.set(other, list);
      }
      if (others.length === 0 && alive.delete(id)) queue.push(id);
    }
  }

  while (queue.length > 0) {
    const removed = queue.shift()!;
    for (const { intent, slot } of dependents.get(removed) ?? []) {
      const key = `${intent}#${slot}`;
      const left = (liveCount.get(key) ?? 0) - 1;
      liveCount.set(key, left);
      if (left <= 0 && alive.delete(intent)) queue.push(intent);
    }
  }
  return alive;
}

export type ClosedSets = { sets: Id[][]; budgetExhausted: boolean };

export function findClosedSets(
  intents: Map<Id, IntentPublic>,
  signals: Signal[],
  edges: Map<Id, RelevantEdge[]>,
  budget: Budget,
): ClosedSets {
  const signalFor = new Map(signals.map((s) => [`${s.from}>${s.to}`, s] as const));
  const signalOk = (from: Id, to: Id): boolean => {
    const s = signalFor.get(`${from}>${to}`);
    return !!s && s.satisfiable
      && s.fromVersion === intents.get(from)?.version && s.toVersion === intents.get(to)?.version;
  };

  const usable = new Map<Id, RelevantEdge[]>();
  for (const [id, list] of edges) {
    if (!intents.has(id)) continue;
    usable.set(id, list.filter((e) => e.self === id
      && intents.get(e.other)?.version === e.otherVersion && signalOk(e.other, id)));
  }

  const ready = pruneToReady(intents, usable);
  const adjacency = new Map<Id, Set<Id>>();
  for (const id of ready) adjacency.set(id, new Set());
  for (const id of ready) {
    for (const edge of usable.get(id) ?? []) {
      if (!ready.has(edge.other)) continue;
      adjacency.get(id)!.add(edge.other);
      adjacency.get(edge.other)!.add(id);
    }
  }

  const meter = new BudgetMeter(budget);
  const seen = new Set<Id>();
  const sets: Id[][] = [];
  for (const start of [...ready].sort()) {
    if (seen.has(start)) continue;
    const component: Id[] = [];
    const stack = [start];
    seen.add(start);
    let complete = true;
    while (stack.length > 0) {
      if (!meter.tick()) {
        complete = false;
        break;
      }
      const node = stack.pop()!;
      component.push(node);
      for (const next of [...adjacency.get(node)!].sort()) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    if (!complete) break;
    if (component.length >= 2) sets.push(component.sort());
  }
  return { sets, budgetExhausted: meter.exhausted };
}
