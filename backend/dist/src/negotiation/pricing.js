export const UNBOUNDED = Number.MAX_SAFE_INTEGER;
export function withinBounds(side, amountCents, bounds) {
    if (!Number.isInteger(amountCents))
        return false;
    return side === 'payer'
        ? amountCents <= bounds.maxCents && amountCents >= 0
        : amountCents >= bounds.minCents && amountCents <= bounds.maxCents;
}
// Linear concession from the opening position to the bound over `rounds` steps (pure, integer cents).
export function nextOffer(state, side) {
    const step = Math.min(Math.max(state.round, 1), state.rounds + 1) - 1;
    if (side === 'payer') {
        return state.payerOpenCents + Math.round(((state.payerMaxCents - state.payerOpenCents) * step) / state.rounds);
    }
    return state.receiverAskCents - Math.round(((state.receiverAskCents - state.receiverMinCents) * step) / state.rounds);
}
// Bounds for one participant on `target`. Other unpriced links settle at the best case for that participant.
export function deriveLinkBounds(party, target, all, pricedSoFar) {
    const limit = party.minNetCents ?? party.declaredNetCents;
    const isPayer = target.payer === party.id;
    let net = 0;
    for (const other of all) {
        if (other.link.id === target.link.id)
            continue;
        const receives = other.receiver === party.id;
        const pays = other.payer === party.id;
        if (!receives && !pays)
            continue;
        const fixed = pricedSoFar.get(other.link.id);
        if (receives)
            net += fixed ?? other.payCents ?? 0;
        else
            net -= fixed ?? other.askCents ?? 0;
    }
    if (isPayer) {
        let maxCents = limit === null ? UNBOUNDED : net - limit;
        if (target.payerFirm && target.payCents !== null)
            maxCents = Math.min(maxCents, target.payCents);
        return { minCents: 0, maxCents };
    }
    let minCents = limit === null ? 0 : Math.max(0, limit - net);
    if (target.receiverFirm && target.askCents !== null)
        minCents = Math.max(minCents, target.askCents);
    return { minCents, maxCents: UNBOUNDED };
}
export function linkBounds(target, payerBounds, receiverBounds, anchors = {}) {
    const open = target.payerFirm ? payerBounds.maxCents : (anchors.payerOpenCents ?? target.payCents ?? 0);
    const ask = target.receiverFirm ? receiverBounds.minCents : (anchors.receiverAskCents ?? target.askCents ?? receiverBounds.minCents);
    return {
        payer: payerBounds,
        receiver: receiverBounds,
        payerOpenCents: Math.max(0, Math.min(open, payerBounds.maxCents)),
        receiverAskCents: Math.max(ask, receiverBounds.minCents),
    };
}
// Prefer links where a participant has no other unpriced cash link; ties go to the lowest id.
export function pricingOrder(unpriced) {
    const sorted = [...unpriced].sort((x, y) => (x.link.id < y.link.id ? -1 : x.link.id > y.link.id ? 1 : 0));
    const othersOf = (id, self) => sorted.filter((l) => l !== self && (l.payer === id || l.receiver === id)).length;
    const leaf = sorted.filter((l) => othersOf(l.payer, l) === 0 || othersOf(l.receiver, l) === 0);
    const rest = sorted.filter((l) => !leaf.includes(l));
    return [...leaf, ...rest];
}
