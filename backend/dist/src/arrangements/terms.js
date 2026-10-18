export const itemSig = (i) => [
    i.kind,
    i.label.trim().toLowerCase(),
    Object.entries(i.attrs)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join(','),
    i.qty,
].join(':');
const handleOf = (arr, intents, intentId) => intents.get(intentId)?.public.ownerHandle ?? 'unknown';
export function netFor(arr, intentId) {
    let net = 0;
    for (const link of arr.links) {
        if (!link.payer || link.amountCents === null)
            continue;
        const receiver = link.payer === link.a ? link.b : link.a;
        if (link.payer === intentId)
            net -= link.amountCents;
        if (receiver === intentId)
            net += link.amountCents;
    }
    return net;
}
// Hash of what the participant gives and gets. Counterparty identity and cash are excluded.
export function termsHash(arr, intentId) {
    const gives = [];
    const gets = [];
    for (const link of arr.links) {
        for (const flow of link.flows) {
            if (flow.from === intentId)
                gives.push(itemSig(flow.item));
            if (flow.to === intentId)
                gets.push(itemSig(flow.item));
        }
    }
    return `give[${gives.sort().join('|')}]get[${gets.sort().join('|')}]`;
}
export function gradeOf(net, intent) {
    const declared = intent.private.declaredNetCents;
    return declared === null || net >= declared ? 'exact' : 'within_tolerance';
}
export function termsView(arr, slot, intents, expiresAt) {
    const me = slot.intentId;
    const gives = [];
    const gets = [];
    const cashOut = [];
    const cashIn = [];
    const counterparties = new Set();
    const unpriced = [];
    const proposedLink = arr.state === 'proposed' && arr.proposal
        ? arr.links.find((link) => link.id === arr.proposal.linkId && (link.a === me || link.b === me))
        : undefined;
    const proposal = proposedLink && arr.proposal ? {
        amountCents: arr.proposal.amountCents,
        otherHandle: handleOf(arr, intents, proposedLink.a === me ? proposedLink.b : proposedLink.a),
        awaiting: arr.proposal.fromIntentId === me ? 'counterparty' : 'user',
        ...(arr.proposal.source ? { source: arr.proposal.source } : {}),
    } : undefined;
    const visible = proposal ? {
        ...arr,
        links: arr.links.map((link) => link.id === proposedLink.id ? { ...link, amountCents: proposal.amountCents } : link),
    } : arr;
    for (const link of visible.links) {
        if (link.a !== me && link.b !== me)
            continue;
        const other = link.a === me ? link.b : link.a;
        counterparties.add(other);
        for (const flow of link.flows) {
            if (flow.from === me)
                gives.push({ item: flow.item, toHandle: handleOf(arr, intents, other) });
            if (flow.to === me)
                gets.push({ item: flow.item, fromHandle: handleOf(arr, intents, other) });
        }
        if (link.payer && link.amountCents === null) {
            unpriced.push({
                otherHandle: handleOf(arr, intents, other),
                role: link.payer === me ? 'buyer' : 'seller',
                items: link.flows.filter((f) => (link.payer === me ? f.to === me : f.from === me)).map((f) => f.item.label),
            });
        }
        if (link.payer && link.amountCents !== null) {
            if (link.payer === me)
                cashOut.push({ toHandle: handleOf(arr, intents, other), amountCents: link.amountCents });
            else
                cashIn.push({ fromHandle: handleOf(arr, intents, other), amountCents: link.amountCents });
        }
    }
    const intent = intents.get(me);
    const net = netFor(visible, me);
    const participants = arr.slots.filter((s) => s.approval !== 'void').length;
    return {
        arrangementId: arr.id,
        revision: arr.revision,
        intentId: me,
        intentVersion: slot.intentVersion,
        state: arr.state,
        approval: slot.approval,
        expiresAt,
        gives,
        gets,
        cashOut,
        cashIn,
        netCents: net,
        declaredNetCents: intent.private.declaredNetCents,
        grade: gradeOf(net, intent),
        otherParticipants: Math.max(0, participants - 1 - counterparties.size),
        ...(unpriced.length > 0 ? { unpriced } : {}),
        ...(proposal ? { proposal } : {}),
    };
}
