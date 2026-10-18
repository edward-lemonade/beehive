import { describe, expect, it } from 'vitest';
import { labelsMatch } from '../src/discovery/match.js';

describe('labelsMatch', () => {
  it('matches a short label to a descriptive one and tolerates a typo', () => {
    expect(labelsMatch('ticket', 'niteharts-saturday-ticket')).toBe(true);
    expect(labelsMatch('satuday-niteharts-ticket', 'niteharts-saturday-ticket')).toBe(true);
  });
  it('keeps different things apart', () => {
    expect(labelsMatch('sublet', 'niteharts-saturday-ticket')).toBe(false);
    expect(labelsMatch('niteharts-friday-ticket', 'niteharts-saturday-ticket')).toBe(false);
  });
});

import { deriveLinkBounds, type LinkTerms } from '../src/negotiation/pricing.js';

describe('seller price flags', () => {
  const terms = { link: { id: 'l' }, payer: 'B', receiver: 'S', payCents: null, askCents: 10000, payerFirm: false, receiverFirm: false } as unknown as LinkTerms;
  it('treats a stated-but-negotiable price as an ask, not a floor', () => {
    expect(deriveLinkBounds({ id: 'S', minNetCents: 10000, declaredNetCents: 10000 }, terms, [terms], new Map()).floorStated).toBe(false);
    expect(deriveLinkBounds({ id: 'S', minNetCents: null, declaredNetCents: 10000 }, terms, [terms], new Map()).floorStated).toBe(false);
  });
  it('counts a real floor or a firm price', () => {
    expect(deriveLinkBounds({ id: 'S', minNetCents: 9500, declaredNetCents: 10000 }, terms, [terms], new Map()).floorStated).toBe(true);
    expect(deriveLinkBounds({ id: 'S', minNetCents: 10000, declaredNetCents: 10000 }, { ...terms, receiverFirm: true }, [{ ...terms, receiverFirm: true }], new Map()).floorStated).toBe(true);
  });
});

import { directlyRelevant } from '../src/discovery/match.js';
import { primePairs, resetSemanticCache, setItemJudge } from '../src/discovery/semantic.js';

describe('semantic item judge', () => {
  const item = (label: string) => ({ kind: 'ticket' as const, label, attrs: {}, qty: 1 });
  const cash = { kind: 'cash' as const, label: 'cash', attrs: {}, qty: 1 };
  const sell = { intentId: 's', version: 1, ownerHandle: 's', freeText: 'selling a ticket to the show', give: [item('admission')], want: [{ anyOf: [cash] }] } as never;
  const buy = { intentId: 'b', version: 1, ownerHandle: 'b', freeText: 'looking for a show ticket', give: [cash], want: [{ anyOf: [item('pass')] }] } as never;

  it('lets the judge decide when labels share no words, and caches the verdict', async () => {
    resetSemanticCache();
    let calls = 0;
    setItemJudge(async () => { calls += 1; return true; });
    expect(directlyRelevant(buy, sell)).toBeNull();
    await primePairs(buy, [sell]);
    await primePairs(buy, [sell]);
    expect(calls).toBe(1);
    expect(directlyRelevant(buy, sell)).not.toBeNull();
    expect(directlyRelevant(sell, buy)).not.toBeNull();
  });

  it('honours a no verdict and throws when the judge fails', async () => {
    resetSemanticCache();
    setItemJudge(async () => false);
    await primePairs(buy, [sell]);
    expect(directlyRelevant(buy, sell)).toBeNull();
    resetSemanticCache();
    setItemJudge(async () => { throw new Error('down'); });
    await expect(primePairs(buy, [sell])).rejects.toThrow(/LLM_API_KEY/);
    setItemJudge();
    resetSemanticCache();
  });
});
