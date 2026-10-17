import { getEdges } from '../discovery/service.js';
import { getIntentRepository } from '../intents/service.js';
import { ensureAgent } from '../runtime/registry.js';
import { termsFor } from './arrangement.js';
import { deriveLinkBounds, linkBounds, withinBounds } from './pricing.js';
import { runSession } from './session.js';
const party = (i) => ({
    id: i.id,
    minNetCents: i.private.minNetCents,
    declaredNetCents: i.private.declaredNetCents,
});
const hasCashGive = (i) => i.public.give.some((x) => x.kind === 'cash');
const hasCashWant = (i) => i.public.want.some((w) => w.anyOf.some((x) => x.kind === 'cash'));
// Same payer rule as the engine's link builder, applied to a single pair.
function pairPayer(own, target, ownGives, ownGets) {
    if (!ownGives && !ownGets)
        return undefined;
    if (ownGives !== ownGets) {
        const [giver, receiver] = ownGives ? [own, target] : [target, own];
        return hasCashGive(receiver) || hasCashWant(giver) ? receiver.id : null;
    }
    const ownCash = hasCashGive(own);
    const targetCash = hasCashGive(target);
    return ownCash !== targetCash ? (ownCash ? own.id : target.id) : null;
}
async function neighborTerms(intent, excludeId) {
    const repo = getIntentRepository();
    const out = [];
    for (const edge of await getEdges(intent.id)) {
        if (edge.other === excludeId)
            continue;
        const other = await repo.get(edge.other);
        if (!other)
            continue;
        const payerId = pairPayer(intent, other, edge.selfGives.length > 0, edge.selfWants.some((w) => w.provider === other.id));
        if (!payerId)
            continue;
        const [a, b] = [intent.id, other.id].sort();
        const link = { id: `${a}|${b}`, a, b, flows: [], payer: payerId, amountCents: null, state: 'unpriced' };
        out.push(payerId === intent.id ? termsFor(link, intent, other) : termsFor(link, other, intent));
    }
    return out;
}
// Prices the one link shared by two directly relevant intents, optionally anchored on the caller's target.
export async function negotiateDirect(callerId, input) {
    const repo = getIntentRepository();
    const own = await repo.get(input.ownIntentId);
    if (!own || own.state !== 'open')
        return { status: 'not_found' };
    if (own.ownerId !== callerId)
        return { status: 'forbidden' };
    const target = await repo.get(input.targetIntentId);
    if (!target || target.state !== 'open')
        return { status: 'not_relevant' };
    const ownEdges = await getEdges(own.id);
    if (!ownEdges.some((e) => e.other === target.id))
        return { status: 'not_relevant' };
    const edge = ownEdges.find((e) => e.other === target.id);
    const payerId = pairPayer(own, target, edge.selfGives.length > 0, edge.selfWants.some((w) => w.provider === target.id));
    if (payerId === undefined)
        return { status: 'no_link' };
    if (payerId === null)
        return { status: 'no_price_needed' };
    const [a, b] = [own.id, target.id].sort();
    const link = { id: `${a}|${b}`, a, b, flows: [], payer: payerId, amountCents: null, state: 'unpriced' };
    const payer = link.payer === own.id ? own : target;
    const receiver = payer === own ? target : own;
    const terms = termsFor(link, payer, receiver);
    // Each side's other cash links count at their best case, so a middle participant is not boxed in.
    const all = [terms, ...(await neighborTerms(payer, receiver.id)), ...(await neighborTerms(receiver, payer.id))];
    const payerBounds = deriveLinkBounds(party(payer), terms, all, new Map());
    const receiverBounds = deriveLinkBounds(party(receiver), terms, all, new Map());
    const ownIsPayer = payer === own;
    if (input.targetCents !== undefined) {
        const ok = ownIsPayer
            ? withinBounds('payer', input.targetCents, payerBounds)
            : withinBounds('receiver', input.targetCents, receiverBounds);
        if (!ok)
            return { status: 'needs_bound_change' };
    }
    const bounds = linkBounds(terms, payerBounds, receiverBounds, ownIsPayer
        ? { payerOpenCents: input.targetCents }
        : { receiverAskCents: input.targetCents });
    ensureAgent(own.id);
    ensureAgent(target.id);
    const result = await runSession({
        key: `direct/${own.id}/${target.id}/${Date.now()}`,
        payerId: payer.id,
        receiverId: receiver.id,
        bounds,
    });
    return result.state === 'agreed' && result.amountCents !== undefined
        ? { status: 'agreed', amountCents: result.amountCents, rounds: result.rounds }
        : { status: 'failed', rounds: result.rounds };
}
