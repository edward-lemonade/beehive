import { candidatesBySlot, slotsOf } from './slots.js';
import { BudgetMeter } from './types.js';
// An intent with no non-cash slots cannot trade, so it is never satisfiable.
export function localStatus(self, edges, incoming) {
    const versions = new Map(edges.filter((e) => e.self === self.intentId).map((e) => [e.other, e.otherVersion]));
    const trusted = new Set(incoming
        .filter((s) => s.to === self.intentId && s.satisfiable
        && s.toVersion === self.version && s.fromVersion === versions.get(s.from))
        .map((s) => s.from));
    const covers = {};
    let satisfiable = false;
    const slots = slotsOf(self);
    const candidates = candidatesBySlot(self, edges);
    satisfiable = slots.length > 0;
    for (const slot of slots) {
        covers[slot.id] = (candidates.get(slot.id) ?? []).filter((other) => trusted.has(other));
        if (covers[slot.id].length === 0)
            satisfiable = false;
    }
    return { satisfiable, covers };
}
// Greatest fixed point: repeatedly drop intents with an uncovered slot, driven by a queue keyed by neighbor.
export function pruneToReady(intents, edges) {
    const isCurrent = (other, version) => intents.get(other)?.version === version;
    const liveCount = new Map();
    const dependents = new Map();
    const alive = new Set(intents.keys());
    const queue = [];
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
            if (others.length === 0 && alive.delete(id))
                queue.push(id);
        }
    }
    while (queue.length > 0) {
        const removed = queue.shift();
        for (const { intent, slot } of dependents.get(removed) ?? []) {
            const key = `${intent}#${slot}`;
            const left = (liveCount.get(key) ?? 0) - 1;
            liveCount.set(key, left);
            if (left <= 0 && alive.delete(intent))
                queue.push(intent);
        }
    }
    return alive;
}
export function findClosedSets(intents, signals, edges, budget) {
    const signalFor = new Map(signals.map((s) => [`${s.from}>${s.to}`, s]));
    const signalOk = (from, to) => {
        const s = signalFor.get(`${from}>${to}`);
        return !!s && s.satisfiable
            && s.fromVersion === intents.get(from)?.version && s.toVersion === intents.get(to)?.version;
    };
    const usable = new Map();
    for (const [id, list] of edges) {
        if (!intents.has(id))
            continue;
        usable.set(id, list.filter((e) => e.self === id
            && intents.get(e.other)?.version === e.otherVersion && signalOk(e.other, id)));
    }
    const ready = pruneToReady(intents, usable);
    const adjacency = new Map();
    for (const id of ready)
        adjacency.set(id, new Set());
    for (const id of ready) {
        for (const edge of usable.get(id) ?? []) {
            if (!ready.has(edge.other))
                continue;
            adjacency.get(id).add(edge.other);
            adjacency.get(edge.other).add(id);
        }
    }
    const meter = new BudgetMeter(budget);
    const seen = new Set();
    const sets = [];
    for (const start of [...ready].sort()) {
        if (seen.has(start))
            continue;
        const component = [];
        const stack = [start];
        seen.add(start);
        let complete = true;
        while (stack.length > 0) {
            if (!meter.tick()) {
                complete = false;
                break;
            }
            const node = stack.pop();
            component.push(node);
            for (const next of [...adjacency.get(node)].sort()) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        if (!complete)
            break;
        if (component.length >= 2)
            sets.push(component.sort());
    }
    return { sets, budgetExhausted: meter.exhausted };
}
