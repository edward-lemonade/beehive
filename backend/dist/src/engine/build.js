import { canon, normText, slotsOf } from './slots.js';
import { BudgetMeter } from './types.js';
export function arrangementKey(slots) {
    return slots.map((s) => `${s.intentId}@${s.intentVersion}`).sort().join('|');
}
const TIER_SCORE = { reliable: 1, new: 0, flagged: -1 };
const tierScore = (tier) => TIER_SCORE[tier.trim().toLowerCase()] ?? 0;
const hasCashGive = (intent) => intent.give.some((i) => i.kind === 'cash');
const hasCashWant = (intent) => intent.want.some((w) => w.anyOf.some((i) => i.kind === 'cash'));
function cashGiven(intent) {
    return intent.give.filter((i) => i.kind === 'cash').reduce((sum, i) => sum + (i.amountCents ?? 0) * i.qty, 0);
}
function cashWanted(intent) {
    return intent.want.reduce((sum, w) => {
        const amounts = w.anyOf.filter((i) => i.kind === 'cash').map((i) => (i.amountCents ?? 0) * i.qty);
        return sum + (amounts.length > 0 ? Math.min(...amounts) : 0);
    }, 0);
}
const giveKey = (provider, idx) => `${provider}#${idx}`;
const wantKey = (wanter, slot) => `${wanter}#${slot}`;
function cloneState(state, member) {
    return {
        members: member && !state.members.includes(member) ? [...state.members, member] : [...state.members],
        allocs: [...state.allocs],
        used: new Map(state.used),
        needs: new Map(state.needs),
    };
}
function got(state, wanter, slot) {
    return state.allocs.filter((a) => a.wanter === wanter && a.slot === slot).reduce((s, a) => s + a.qty, 0);
}
function optionQty(options, given) {
    const match = options.find((o) => o.kind === given.kind && normText(o.label) === normText(given.label));
    return (match ?? options[0]).qty;
}
// Payer rules: cash only ever flows between two intents that exchange a non-cash item.
function buildLinks(allocs, intents) {
    const groups = new Map();
    for (const alloc of allocs) {
        const [a, b] = [alloc.provider, alloc.wanter].sort();
        const key = `${a}|${b}`;
        groups.set(key, [...(groups.get(key) ?? []), alloc]);
    }
    const links = [];
    for (const [id, list] of [...groups].sort(([x], [y]) => (x < y ? -1 : 1))) {
        const [a, b] = id.split('|');
        const flows = list.map((alloc) => ({
            from: alloc.provider,
            to: alloc.wanter,
            item: { ...intents.get(alloc.provider).give[alloc.giveIdx], qty: alloc.qty },
        }));
        const directions = new Set(flows.map((f) => f.from));
        let payer = null;
        if (directions.size === 1) {
            const giver = flows[0].from;
            const receiver = giver === a ? b : a;
            if (hasCashGive(intents.get(receiver)) || hasCashWant(intents.get(giver)))
                payer = receiver;
        }
        else {
            const aCash = hasCashGive(intents.get(a));
            const bCash = hasCashGive(intents.get(b));
            if (aCash !== bCash)
                payer = aCash ? a : b;
        }
        links.push({ id, a, b, flows, payer, amountCents: null, state: 'unpriced' });
    }
    return links;
}
export function finalizeDraft(members, links, intents, budgetExhausted) {
    const slots = [...members].sort().map((id) => ({
        intentId: id,
        intentVersion: intents.get(id).version,
        approval: 'queued',
    }));
    const declaredNet = Object.fromEntries(slots.map((s) => [s.intentId, 0]));
    for (const link of links) {
        if (!link.payer)
            continue;
        const receiver = link.payer === link.a ? link.b : link.a;
        const payerIntent = intents.get(link.payer);
        const amount = cashGiven(payerIntent) || cashWanted(intents.get(receiver));
        declaredNet[link.payer] = (declaredNet[link.payer] ?? 0) - amount;
        declaredNet[receiver] = (declaredNet[receiver] ?? 0) + amount;
    }
    return {
        key: arrangementKey(slots),
        slots,
        links,
        declaredNet,
        tierScore: slots.reduce((sum, s) => sum + tierScore(intents.get(s.intentId).tier), 0),
        budgetExhausted,
    };
}
export function buildArrangement(set, intents, edges, budget, options = {}) {
    const inSet = new Set(set.filter((id) => intents.has(id)));
    const initial = [...new Set([...(options.must ?? []), ...(options.seed ? [options.seed] : [])])];
    if (initial.length === 0 && inSet.size > 0)
        initial.push([...inSet].sort()[0]);
    if (initial.length === 0 || initial.some((id) => !inSet.has(id)))
        return { draft: null, budgetExhausted: false };
    const meter = new BudgetMeter(budget);
    const slotCache = new Map();
    const slotsFor = (id) => {
        if (!slotCache.has(id))
            slotCache.set(id, slotsOf(intents.get(id)));
        return slotCache.get(id);
    };
    const giveIndex = (provider, item) => intents.get(provider).give.findIndex((g) => canon(g) === canon(item));
    const rankChoice = (state, other, seedPrice) => [
        state.members.includes(other) ? 0 : 1,
        slotsFor(other).length,
        cashWanted(intents.get(other)) * (seedPrice === other ? 0 : 1),
        other,
    ];
    const compare = (a, b) => {
        for (let i = 0; i < 3; i += 1)
            if (a[i] !== b[i])
                return a[i] - b[i];
        return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
    };
    const seedId = initial[0];
    const wantOptions = (state, wanter, slot) => {
        const out = [];
        for (const edge of edges.get(wanter) ?? []) {
            if (edge.self !== wanter || !inSet.has(edge.other))
                continue;
            if (intents.get(edge.other)?.version !== edge.otherVersion)
                continue;
            for (const cover of edge.selfWants) {
                if (cover.slot !== slot.id)
                    continue;
                const idx = giveIndex(edge.other, cover.item);
                if (idx < 0)
                    continue;
                const capacity = intents.get(edge.other).give[idx].qty - (state.used.get(giveKey(edge.other, idx)) ?? 0);
                if (capacity <= 0)
                    continue;
                const need = state.needs.get(wantKey(wanter, slot.id)) ?? optionQty(slot.options, cover.item);
                const remaining = need - got(state, wanter, slot.id);
                out.push({ provider: edge.other, giveIdx: idx, wanter, slot: slot.id, qty: Math.min(capacity, remaining) });
            }
        }
        return out;
    };
    const takeOptions = (state, provider, giveIdx) => {
        const item = intents.get(provider).give[giveIdx];
        const capacity = item.qty - (state.used.get(giveKey(provider, giveIdx)) ?? 0);
        if (capacity <= 0)
            return [];
        const out = [];
        for (const edge of edges.get(provider) ?? []) {
            if (edge.self !== provider || !inSet.has(edge.other))
                continue;
            if (intents.get(edge.other)?.version !== edge.otherVersion)
                continue;
            const wanter = edge.other;
            for (const cover of (edges.get(wanter) ?? []).flatMap((e) => (e.self === wanter && e.other === provider ? e.selfWants : []))) {
                if (canon(cover.item) !== canon(item))
                    continue;
                const slot = slotsFor(wanter).find((s) => s.id === cover.slot);
                if (!slot || slot.side !== 'want')
                    continue;
                const need = state.needs.get(wantKey(wanter, slot.id)) ?? optionQty(slot.options, item);
                const remaining = need - got(state, wanter, slot.id);
                if (remaining <= 0)
                    continue;
                out.push({ provider, giveIdx, wanter, slot: slot.id, qty: Math.min(capacity, remaining) });
            }
        }
        return out;
    };
    const apply = (state, option) => {
        const next = cloneState(state, option.wanter);
        if (!next.members.includes(option.provider))
            next.members.push(option.provider);
        const slot = slotsFor(option.wanter).find((s) => s.id === option.slot);
        const wk = wantKey(option.wanter, option.slot);
        if (!next.needs.has(wk)) {
            next.needs.set(wk, optionQty(slot.options, intents.get(option.provider).give[option.giveIdx]));
        }
        next.allocs.push({ ...option });
        const gk = giveKey(option.provider, option.giveIdx);
        next.used.set(gk, (next.used.get(gk) ?? 0) + option.qty);
        return next;
    };
    const choices = (state) => {
        for (const member of state.members) {
            for (const slot of slotsFor(member)) {
                if (slot.side === 'want') {
                    const need = state.needs.get(wantKey(member, slot.id));
                    if (need !== undefined && got(state, member, slot.id) >= need)
                        continue;
                    return wantOptions(state, member, slot)
                        .sort((a, b) => compare(rankChoice(state, a.provider, seedId), rankChoice(state, b.provider, seedId)))
                        .map((option) => apply(state, option));
                }
                if (!state.allocs.some((a) => a.provider === member && a.giveIdx === slot.index)) {
                    return takeOptions(state, member, slot.index)
                        .sort((a, b) => compare(rankChoice(state, a.wanter, seedId), rankChoice(state, b.wanter, seedId)))
                        .map((option) => apply(state, option));
                }
            }
        }
        return null;
    };
    const search = (state) => {
        if (!meter.tick())
            return null;
        const next = choices(state);
        if (next === null)
            return state;
        for (const candidate of next) {
            const found = search(candidate);
            if (found)
                return found;
            if (meter.exhausted)
                return null;
        }
        return null;
    };
    const found = search({ members: initial, allocs: [], used: new Map(), needs: new Map() });
    if (!found)
        return { draft: null, budgetExhausted: meter.exhausted };
    const draft = finalizeDraft(found.members, buildLinks(found.allocs, intents), intents, false);
    return { draft, budgetExhausted: false };
}
