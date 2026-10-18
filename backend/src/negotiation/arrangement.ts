import type { IntentPublic, Link, Slot } from '../contracts/index.js';
import { events } from '../events.js';
import type { StoredIntent } from '../intents/repository.js';
import { getIntentRepository } from '../intents/service.js';
import { ensureAgent } from '../runtime/registry.js';
import {
  deriveLinkBounds,
  linkBounds,
  pricingOrder,
  withinBounds,
  type LinkResult,
  type LinkTerms,
  type Party,
} from './pricing.js';
import { runSession } from './session.js';

export type PricingResult = {
  state: 'agreed' | 'failed';
  links: Link[];
  failedLinkId?: string;
  reason?: string;
  gapCents?: number;
};

const cashGiven = (i: IntentPublic): number =>
  i.give.filter((x) => x.kind === 'cash').reduce((s, x) => s + (x.amountCents ?? 0) * x.qty, 0);

const cashWanted = (i: IntentPublic): number =>
  i.want.reduce((sum, w) => {
    const amounts = w.anyOf.filter((x) => x.kind === 'cash').map((x) => (x.amountCents ?? 0) * x.qty);
    return sum + (amounts.length > 0 ? Math.min(...amounts) : 0);
  }, 0);

const hasFirmCash = (items: Array<{ kind: string; flex?: string }>): boolean =>
  items.some((x) => x.kind === 'cash' && x.flex === 'firm');

export function termsFor(link: Link, payer: StoredIntent, receiver: StoredIntent): LinkTerms {
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

const partyOf = (intent: StoredIntent): Party => ({
  id: intent.id,
  minNetCents: intent.private.minNetCents,
  declaredNetCents: intent.private.declaredNetCents,
});

export async function priceArrangement(arrangement: { id: string; slots: Slot[]; links: Link[] }): Promise<PricingResult> {
  const repo = getIntentRepository();
  const intents = new Map<string, StoredIntent>();
  for (const slot of arrangement.slots) {
    const intent = await repo.get(slot.intentId);
    if (!intent || intent.state !== 'open' || intent.version !== slot.intentVersion) {
      return { state: 'failed', links: arrangement.links, reason: 'stale' };
    }
    intents.set(intent.id, intent);
  }

  const links = arrangement.links.map((link) => ({ ...link }));
  const terms: LinkTerms[] = [];
  for (const link of links) {
    if (!link.payer) {
      link.state = 'agreed';
      link.amountCents = 0;
      continue;
    }
    const receiverId = link.payer === link.a ? link.b : link.a;
    terms.push(termsFor(link, intents.get(link.payer)!, intents.get(receiverId)!));
  }

  const priced = new Map<string, number>();
  let remaining = terms;
  while (remaining.length > 0) {
    const target = pricingOrder(remaining)[0]!;
    const payer = intents.get(target.payer)!;
    const receiver = intents.get(target.receiver)!;
    const bounds = linkBounds(
      target,
      deriveLinkBounds(partyOf(payer), target, terms, priced),
      deriveLinkBounds(partyOf(receiver), target, terms, priced),
    );
    ensureAgent(payer.id);
    ensureAgent(receiver.id);

    const result: LinkResult = await runSession({
      key: `${arrangement.id}/${target.link.id}`,
      arrangementId: arrangement.id,
      payerId: payer.id,
      receiverId: receiver.id,
      bounds,
    });

    if (result.state !== 'agreed' || result.amountCents === undefined) {
      target.link.state = 'failed';
      const failure: PricingResult = {
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
    priced.set(target.link.id, result.amountCents);
    remaining = remaining.filter((t) => t !== target);
  }

  events.emit('arrangement.priced', { arrangementId: arrangement.id });
  return { state: 'agreed', links };
}

export type RepriceResult = { state: 'agreed'; amountCents: number } | { state: 'pending'; amountCents: number } | { state: 'failed'; reason: string };

// Re-runs one link of a priced arrangement with the others held fixed. `anchor` is the caller's target.
export async function repriceLink(
  arrangement: { id: string; slots: Slot[]; links: Link[] },
  linkId: string,
  anchor: { side: 'payer' | 'receiver'; cents?: number },
  attempt: string,
): Promise<RepriceResult> {
  const repo = getIntentRepository();
  const intents = new Map<string, StoredIntent>();
  for (const slot of arrangement.slots) {
    const intent = await repo.get(slot.intentId);
    if (!intent || intent.state !== 'open' || intent.version !== slot.intentVersion) {
      return { state: 'failed', reason: 'stale' };
    }
    intents.set(intent.id, intent);
  }

  const all: LinkTerms[] = [];
  const priced = new Map<string, number>();
  for (const link of arrangement.links) {
    if (!link.payer) continue;
    const receiverId = link.payer === link.a ? link.b : link.a;
    all.push(termsFor(link, intents.get(link.payer)!, intents.get(receiverId)!));
    if (link.id !== linkId && link.amountCents !== null) priced.set(link.id, link.amountCents);
  }
  const target = all.find((t) => t.link.id === linkId);
  if (!target) return { state: 'failed', reason: 'no_cash_link' };

  const payer = intents.get(target.payer)!;
  const receiver = intents.get(target.receiver)!;
  const payerBounds = deriveLinkBounds(partyOf(payer), target, all, priced);
  const receiverBounds = deriveLinkBounds(partyOf(receiver), target, all, priced);
  if (anchor.cents !== undefined && !withinBounds(anchor.side, anchor.cents, anchor.side === 'payer' ? payerBounds : receiverBounds)) {
    return { state: 'failed', reason: 'needs_bound_change' };
  }
  const bounds = linkBounds(target, payerBounds, receiverBounds, anchor.cents === undefined
    ? {}
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
