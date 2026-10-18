import { negotiationLog } from './log.js';
import { refreshEdges } from '../discovery/service.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { ensureAgent } from '../runtime/registry.js';
import { deriveLinkBounds, linkBounds, pricingOrder, withinBounds, } from './pricing.js';
import { runSession } from './session.js';
const cashGiven = (i) => i.give.filter((x) => x.kind === 'cash').reduce((s, x) => s + (x.amountCents ?? 0) * x.qty, 0);
const cashWanted = (i) => i.want.reduce((sum, w) => {
    const amounts = w.anyOf.filter((x) => x.kind === 'cash').map((x) => (x.amountCents ?? 0) * x.qty);
    return sum + (amounts.length > 0 ? Math.min(...amounts) : 0);
}, 0);
const hasFirmCash = (items) => items.some((x) => x.kind === 'cash' && x.flex === 'firm');
export function termsFor(link, payer, receiver) {
    return {
        link,
        payer: payer.id,
        receiver: receiver.id,
        payCents: cashGiven(payer.public) || null,
        askCents: cashWanted(receiver.public) || null,
        payerFirm: hasFirmCash(payer.public.give),
        receiverFirm: hasFirmCash(receiver.public.want.flatMap((w) => w.anyOf)),
    };
}
const partyOf = (intent) => ({
    id: intent.id,
    minNetCents: intent.private.minNetCents,
    declaredNetCents: intent.private.declaredNetCents,
});
// A comparable firm listing is a public benchmark, not permission to buy or a private spending limit.
export async function competitiveOpening(payer, receiver, target) {
    if (target.payCents !== null || target.payerFirm || target.receiverFirm || !target.askCents)
        return undefined;
    if (payer.public.give.some((item) => item.kind !== 'cash')
        || payer.public.want.filter((slot) => slot.anyOf.some((item) => item.kind !== 'cash')).length !== 1
        || receiver.public.give.filter((item) => item.kind !== 'cash').length !== 1
        || receiver.public.want.some((slot) => slot.anyOf.some((item) => item.kind !== 'cash')))
        return undefined;
    const edges = await refreshEdges(payer.id);
    const requested = edges.find((edge) => edge.other === receiver.id)?.selfWants;
    if (requested?.length !== 1)
        return undefined;
    let cheapest = target.askCents;
    const repo = getIntentRepository();
    for (const edge of edges) {
        if (edge.other === receiver.id || edge.selfWants.length !== 1
            || edge.selfWants[0].slot !== requested[0].slot
            || edge.selfWants[0].item.qty !== requested[0].item.qty)
            continue;
        const other = await repo.get(edge.other);
        if (!other || other.state !== 'open'
            || other.public.give.filter((item) => item.kind !== 'cash').length !== 1
            || other.public.want.length !== 1 || other.public.want[0].anyOf.length !== 1)
            continue;
        const price = other.public.want[0].anyOf[0];
        if (price.kind === 'cash' && price.flex === 'firm' && price.amountCents && price.amountCents > 0) {
            cheapest = Math.min(cheapest, price.amountCents * price.qty);
        }
    }
    if (cheapest >= target.askCents)
        return undefined;
    const opening = Math.floor(cheapest * 0.9);
    return opening > 0 ? opening : undefined;
}
export async function priceArrangement(arrangement) {
    const repo = getIntentRepository();
    const intents = new Map();
    for (const slot of arrangement.slots) {
        const intent = await repo.get(slot.intentId);
        if (!intent || intent.state !== 'open' || intent.version !== slot.intentVersion) {
            return { state: 'failed', links: arrangement.links, reason: 'stale' };
        }
        intents.set(intent.id, intent);
    }
    const links = arrangement.links.map((link) => ({ ...link }));
    const terms = [];
    for (const link of links) {
        if (!link.payer) {
            link.state = 'agreed';
            link.amountCents = 0;
            continue;
        }
        const receiverId = link.payer === link.a ? link.b : link.a;
        terms.push(termsFor(link, intents.get(link.payer), intents.get(receiverId)));
    }
    const priced = new Map();
    let proposal;
    let remaining = terms;
    while (remaining.length > 0) {
        const target = pricingOrder(remaining)[0];
        const payer = intents.get(target.payer);
        const receiver = intents.get(target.receiver);
        const payerBounds = deriveLinkBounds(partyOf(payer), target, terms, priced);
        const receiverBounds = deriveLinkBounds(partyOf(receiver), target, terms, priced);
        // Nobody has named a price, so there is nothing to haggle over: leave the link unpriced for the seller to name.
        if (target.payCents === null && target.askCents === null && !target.payerFirm && !target.receiverFirm && receiverBounds.minCents === 0) {
            target.link.amountCents = null;
            target.link.state = 'unpriced';
            remaining = remaining.filter((t) => t !== target);
            continue;
        }
        const bounds = linkBounds(target, payerBounds, receiverBounds, {
            competitiveOpenCents: await competitiveOpening(payer, receiver, target),
        });
        ensureAgent(payer.id);
        ensureAgent(receiver.id);
        const result = await runSession({
            key: `${arrangement.id}/${target.link.id}`,
            arrangementId: arrangement.id,
            payerId: payer.id,
            receiverId: receiver.id,
            bounds,
        });
        if (result.state !== 'agreed' || result.amountCents === undefined) {
            target.link.state = 'failed';
            const failure = {
                state: 'failed',
                links: links.map((l) => (l === target.link ? l : { ...l, amountCents: null, state: l.payer ? 'unpriced' : l.state })),
                failedLinkId: target.link.id,
                reason: result.reason,
            };
            if (result.reason === 'no_overlap' && target.payCents !== null && target.askCents !== null) {
                failure.gapCents = Math.max(0, target.askCents - target.payCents);
                if (failure.gapCents > 0) {
                    for (const owner of new Set([payer.ownerId, receiver.ownerId])) {
                        events.emit('notify', {
                            userId: owner,
                            kind: 'near_miss',
                            payload: { linkId: target.link.id, gapCents: failure.gapCents },
                        });
                    }
                }
            }
            return failure;
        }
        target.link.state = 'agreed';
        target.link.amountCents = result.amountCents;
        if (terms.length === 1 && result.pendingUser && result.pendingSide) {
            proposal = {
                linkId: target.link.id,
                amountCents: result.amountCents,
                fromIntentId: result.pendingSide === 'receiver' ? payer.id : receiver.id,
                source: 'agent',
            };
        }
        priced.set(target.link.id, result.amountCents);
        remaining = remaining.filter((t) => t !== target);
    }
    events.emit('arrangement.priced', { arrangementId: arrangement.id });
    return { state: 'agreed', links, ...(proposal ? { proposal } : {}) };
}
// Re-runs one link of a priced arrangement with the others held fixed. `anchor` is the caller's target.
export async function repriceLink(arrangement, linkId, anchor, attempt) {
    const repo = getIntentRepository();
    const intents = new Map();
    for (const slot of arrangement.slots) {
        const intent = await repo.get(slot.intentId);
        if (!intent || intent.state !== 'open' || intent.version !== slot.intentVersion) {
            return { state: 'failed', reason: 'stale' };
        }
        intents.set(intent.id, intent);
    }
    const all = [];
    const priced = new Map();
    for (const link of arrangement.links) {
        if (!link.payer)
            continue;
        const receiverId = link.payer === link.a ? link.b : link.a;
        all.push(termsFor(link, intents.get(link.payer), intents.get(receiverId)));
        if (link.id !== linkId && link.amountCents !== null)
            priced.set(link.id, link.amountCents);
    }
    const target = all.find((t) => t.link.id === linkId);
    if (!target)
        return { state: 'failed', reason: 'no_cash_link' };
    const payer = intents.get(target.payer);
    const receiver = intents.get(target.receiver);
    const payerBounds = deriveLinkBounds(partyOf(payer), target, all, priced);
    let receiverBounds = deriveLinkBounds(partyOf(receiver), target, all, priced);
    // A seller naming a price is the user speaking: it replaces the listed ask and becomes a stated floor.
    if (anchor.side === 'receiver' && anchor.cents !== undefined && anchor.cents >= 0) {
        receiverBounds = { ...receiverBounds, minCents: anchor.cents, floorStated: true };
    }
    if (anchor.cents !== undefined && !withinBounds(anchor.side, anchor.cents, anchor.side === 'payer' ? payerBounds : receiverBounds)) {
        return { state: 'failed', reason: 'needs_bound_change' };
    }
    // If the other side's latest offer on this arrangement is exactly this price, the user is saying yes to it: settle, don't restart haggling.
    if (anchor.cents !== undefined) {
        const mine = anchor.side === 'payer' ? payer.id : receiver.id;
        const entries = (await negotiationLog().forIntents([mine], 200)).filter((e) => e.arrangementId === arrangement.id && e.kind === 'offer');
        const latest = entries[entries.length - 1];
        if (latest && latest.from !== mine && latest.amountCents === anchor.cents) {
            return { state: 'agreed', amountCents: anchor.cents };
        }
    }
    if (anchor.cents === undefined && target.payCents === null && target.askCents === null
        && !target.payerFirm && !target.receiverFirm && receiverBounds.minCents === 0) {
        return { state: 'failed', reason: 'no_price_named' };
    }
    const bounds = linkBounds(target, payerBounds, receiverBounds, anchor.cents === undefined
        ? { competitiveOpenCents: await competitiveOpening(payer, receiver, target) }
        : anchor.side === 'payer' ? { payerOpenCents: anchor.cents } : { receiverAskCents: anchor.cents });
    ensureAgent(payer.id);
    ensureAgent(receiver.id);
    const result = await runSession({
        key: `${arrangement.id}/${linkId}/${attempt}`,
        arrangementId: arrangement.id,
        payerId: payer.id,
        receiverId: receiver.id,
        bounds,
    });
    // The other agent only escalated to its user, so nothing has been agreed yet.
    if (result.state === 'agreed' && result.amountCents !== undefined && result.pendingUser) {
        return { state: 'pending', amountCents: result.amountCents };
    }
    return result.state === 'agreed' && result.amountCents !== undefined
        ? { state: 'agreed', amountCents: result.amountCents }
        : { state: 'failed', reason: result.reason ?? 'no_agreement' };
}
