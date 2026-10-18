import type { Item, TermsView } from '../contracts/index.js';
import type { StoredIntent } from '../intents/repository.js';
import type { StoredArrangement, StoredSlot } from './types.js';

export const itemSig = (i: Item): string =>
  [
    i.kind,
    i.label.trim().toLowerCase(),
    Object.entries(i.attrs)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join(','),
    i.qty,
  ].join(':');

const handleOf = (arr: StoredArrangement, intents: Map<string, StoredIntent>, intentId: string): string =>
  intents.get(intentId)?.public.ownerHandle ?? 'unknown';

export function netFor(arr: StoredArrangement, intentId: string): number {
  let net = 0;
  for (const link of arr.links) {
    if (!link.payer || link.amountCents === null) continue;
    const receiver = link.payer === link.a ? link.b : link.a;
    if (link.payer === intentId) net -= link.amountCents;
    if (receiver === intentId) net += link.amountCents;
  }
  return net;
}

// Hash of what the participant gives and gets. Counterparty identity and cash are excluded.
export function termsHash(arr: StoredArrangement, intentId: string): string {
  const gives: string[] = [];
  const gets: string[] = [];
  for (const link of arr.links) {
    for (const flow of link.flows) {
      if (flow.from === intentId) gives.push(itemSig(flow.item));
      if (flow.to === intentId) gets.push(itemSig(flow.item));
    }
  }
  return `give[${gives.sort().join('|')}]get[${gets.sort().join('|')}]`;
}

export function gradeOf(net: number, intent: StoredIntent): TermsView['grade'] {
  const declared = intent.private.declaredNetCents;
  return declared === null || net >= declared ? 'exact' : 'within_tolerance';
}

export function termsView(
  arr: StoredArrangement,
  slot: StoredSlot,
  intents: Map<string, StoredIntent>,
  expiresAt: number | null,
): TermsView {
  const me = slot.intentId;
  const gives: TermsView['gives'] = [];
  const gets: TermsView['gets'] = [];
  const cashOut: TermsView['cashOut'] = [];
  const cashIn: TermsView['cashIn'] = [];
  const counterparties = new Set<string>();
  const unpriced: NonNullable<TermsView['unpriced']> = [];

  for (const link of arr.links) {
    if (link.a !== me && link.b !== me) continue;
    const other = link.a === me ? link.b : link.a;
    counterparties.add(other);
    for (const flow of link.flows) {
      if (flow.from === me) gives.push({ item: flow.item, toHandle: handleOf(arr, intents, other) });
      if (flow.to === me) gets.push({ item: flow.item, fromHandle: handleOf(arr, intents, other) });
    }
    if (link.payer && link.amountCents === null) {
      unpriced.push({
        otherHandle: handleOf(arr, intents, other),
        role: link.payer === me ? 'buyer' : 'seller',
        items: link.flows.filter((f) => (link.payer === me ? f.to === me : f.from === me)).map((f) => f.item.label),
      });
    }
    if (link.payer && link.amountCents !== null) {
      if (link.payer === me) cashOut.push({ toHandle: handleOf(arr, intents, other), amountCents: link.amountCents });
      else cashIn.push({ fromHandle: handleOf(arr, intents, other), amountCents: link.amountCents });
    }
  }

  const intent = intents.get(me)!;
  const net = netFor(arr, me);
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
  };
}
