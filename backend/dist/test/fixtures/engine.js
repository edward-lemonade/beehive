import { directlyRelevant } from '../../src/discovery/match.js';
import { localStatus } from '../../src/engine/index.js';
export const ticket = (label, qty = 1) => ({ kind: 'ticket', label, attrs: {}, qty });
export const cash = (amountCents) => ({ kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents });
export function intent(id, give, want, opts = {}) {
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
export const toMap = (list) => new Map(list.map((i) => [i.intentId, i]));
export function edgesFor(intents) {
    const out = new Map();
    for (const x of intents.values()) {
        const list = [];
        for (const y of intents.values()) {
            if (x.intentId === y.intentId)
                continue;
            const edge = directlyRelevant(x, y);
            if (edge)
                list.push(edge);
        }
        out.set(x.intentId, list);
    }
    return out;
}
// Simulates the distributed protocol: start all-true and iterate to the greatest fixed point.
export function simulateSignals(intents, edges) {
    let signals = [];
    for (const [id, list] of edges) {
        for (const e of list) {
            signals.push({
                from: id, to: e.other, fromVersion: intents.get(id).version, toVersion: e.otherVersion, satisfiable: true,
            });
        }
    }
    for (let round = 0; round < 200; round += 1) {
        const next = signals.map((s) => ({
            ...s,
            satisfiable: localStatus(intents.get(s.from), edges.get(s.from) ?? [], signals).satisfiable,
        }));
        const changed = next.some((s, i) => s.satisfiable !== signals[i].satisfiable);
        signals = next;
        if (!changed)
            break;
    }
    return signals;
}
