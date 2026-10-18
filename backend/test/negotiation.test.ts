import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IntentPublic, Item, Link } from '../src/contracts/index.js';
import { MemoryNoticeRepository } from '../src/discovery/notices.js';
import { refreshEdges, resetNearMissDeliveries, setNoticeRepository } from '../src/discovery/service.js';
import { events } from '../src/events.js';
import type { IntentRepository, StoredIntent } from '../src/intents/repository.js';
import { setIntentRepository } from '../src/intents/service.js';
import app from '../src/index.js';
import { priceArrangement } from '../src/negotiation/arrangement.js';
import { MemoryNegotiationLogRepository, setNegotiationLogRepository } from '../src/negotiation/log.js';
import {
  deriveLinkBounds, linkBounds, nextOffer, pricingOrder, withinBounds, UNBOUNDED, type LinkTerms,
} from '../src/negotiation/pricing.js';
import { negotiateDirect } from '../src/negotiation/service.js';
import { installNegotiation, resetSessions, runSession } from '../src/negotiation/session.js';
import { setWordingProvider, templateWording } from '../src/negotiation/wording.js';
import { bus } from '../src/runtime/bus.js';
import { buildGuardContext } from '../src/runtime/guard-context.js';
import { resetHooks } from '../src/runtime/hooks.js';
import { MemorySignalRepository, setSignalRepository } from '../src/runtime/signals.js';
import { ensureAgent, stopRuntime } from '../src/runtime/registry.js';

const ticket = (label: string): Item => ({ kind: 'ticket', label, attrs: {}, qty: 1 });
const cash = (amountCents: number, flex?: 'firm' | 'flexible'): Item => ({
  kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents, ...(flex ? { flex } : {}),
});

class MemoryRepo implements IntentRepository {
  readonly intents = new Map<string, StoredIntent>();
  async createMany(records: StoredIntent[]) { records.forEach((r) => this.intents.set(r.id, r)); return records; }
  async get(id: string) { return this.intents.get(id); }
  async saveVersion(record: StoredIntent) { this.intents.set(record.id, record); return true; }
  async changeState() { return undefined; }
  async expireDue() { return []; }
  async listMine(ownerId: string) { return [...this.intents.values()].filter((i) => i.ownerId === ownerId); }
  async remove(id: string, ownerId: string, state: string) { const i = this.intents.get(id); if (!i || i.ownerId !== ownerId || i.state !== state) return false; return this.intents.delete(id); }
  async listOpen() { return [...this.intents.values()].filter((i) => i.state === 'open'); }
}

let repo: MemoryRepo;
let log: MemoryNegotiationLogRepository;

function add(id: string, give: Item[], want: Item[][], minNetCents: number | null, declaredNetCents: number | null = null) {
  const publicView: IntentPublic = {
    intentId: id, version: 1, ownerHandle: `h-${id}`, tier: 'new', give,
    want: want.map((anyOf) => ({ anyOf })), deadline: null, freeText: '',
  };
  repo.intents.set(id, {
    id, draftId: id, ownerId: `u${id}`, version: 1, state: 'open', public: publicView,
    private: { minNetCents, declaredNetCents }, sourceText: '', parsed: {}, createdAt: 0, updatedAt: 0,
  } as unknown as StoredIntent);
}

// A pays B, B pays C. A max $60, C min $50, B net >= 0.
function s1(cMin = 5000, cAsk: Item = cash(5000)) {
  add('A', [cash(6000)], [[ticket('x1')]], -6000);
  add('B', [ticket('x1')], [[ticket('x2')]], 0);
  add('C', [ticket('x2')], [[cAsk]], cMin);
}

const link = (id: string, a: string, b: string, payer: string | null): Link => ({
  id, a, b, flows: [], payer, amountCents: null, state: 'unpriced',
});
const arrangement = (id = 'arr1') => ({
  id,
  slots: ['A', 'B', 'C'].map((intentId) => ({ intentId, intentVersion: 1, approval: 'queued' as const })),
  links: [link('A|B', 'A', 'B', 'A'), link('B|C', 'B', 'C', 'B')],
});

async function connect(...ids: string[]) {
  for (const id of ids) await refreshEdges(id);
  for (const id of ids) ensureAgent(id);
}

beforeEach(() => {
  repo = new MemoryRepo();
  log = new MemoryNegotiationLogRepository();
  setIntentRepository(repo);
  setSignalRepository(new MemorySignalRepository());
  setNoticeRepository(new MemoryNoticeRepository());
  setNegotiationLogRepository(log);
  setWordingProvider(async (ctx) => templateWording(ctx));
  resetNearMissDeliveries();
  bus.reset();
  resetHooks();
  installNegotiation();
  bus.setGuardContext(buildGuardContext);
});

afterEach(() => {
  resetSessions();
  stopRuntime();
  bus.reset();
  resetHooks();
  setWordingProvider();
  setNegotiationLogRepository();
  setIntentRepository();
  setSignalRepository();
  setNoticeRepository();
});

describe('pricing (pure)', () => {
  const state = { round: 1, rounds: 3, payerOpenCents: 4000, payerMaxCents: 7000, receiverAskCents: 9000, receiverMinCents: 6000 };

  it('concedes linearly toward each bound and is deterministic', () => {
    expect([1, 2, 3, 4].map((round) => nextOffer({ ...state, round }, 'payer'))).toEqual([4000, 5000, 6000, 7000]);
    expect([1, 2, 3, 4].map((round) => nextOffer({ ...state, round }, 'receiver'))).toEqual([9000, 8000, 7000, 6000]);
    expect(nextOffer({ ...state, round: 9 }, 'payer')).toBe(7000);
  });

  it('checks bounds per side', () => {
    expect(withinBounds('payer', 6000, { minCents: 0, maxCents: 6000 })).toBe(true);
    expect(withinBounds('payer', 6001, { minCents: 0, maxCents: 6000 })).toBe(false);
    expect(withinBounds('receiver', 4999, { minCents: 5000, maxCents: UNBOUNDED })).toBe(false);
    expect(withinBounds('receiver', 50.5, { minCents: 0, maxCents: UNBOUNDED })).toBe(false);
  });

  it('derives S1 bounds with best-case assumptions, then real amounts', () => {
    s1();
    const t = (id: string, a: string, b: string, payer: string, receiver: string, pay: number | null, ask: number | null): LinkTerms => ({
      link: link(id, a, b, payer), payer, receiver, payCents: pay, askCents: ask, payerFirm: false, receiverFirm: false,
    });
    const ab = t('A|B', 'A', 'B', 'A', 'B', 6000, null);
    const bc = t('B|C', 'B', 'C', 'B', 'C', null, 5000);
    const all = [ab, bc];
    const b = { id: 'B', minNetCents: 0, declaredNetCents: null };
    expect(deriveLinkBounds(b, bc, all, new Map()).maxCents).toBe(6000);
    expect(deriveLinkBounds(b, ab, all, new Map()).minCents).toBe(5000);
    expect(deriveLinkBounds(b, ab, all, new Map([['B|C', 5500]])).minCents).toBe(5500);
    expect(pricingOrder(all).map((l) => l.link.id)).toEqual(['A|B', 'B|C']);
  });

  it('keeps firm amounts fixed', () => {
    const terms: LinkTerms = {
      link: link('A|C', 'A', 'C', 'A'), payer: 'A', receiver: 'C', payCents: 30000, askCents: 31500, payerFirm: false, receiverFirm: true,
    };
    const receiver = deriveLinkBounds({ id: 'C', minNetCents: 1000, declaredNetCents: null }, terms, [terms], new Map());
    expect(receiver.minCents).toBe(31500);
    const lb = linkBounds(terms, { minCents: 0, maxCents: 30000 }, receiver);
    expect(lb.receiverAskCents).toBe(31500);
    expect(nextOffer({ round: 4, rounds: 3, payerOpenCents: lb.payerOpenCents, payerMaxCents: 30000, receiverAskCents: 31500, receiverMinCents: 31500 }, 'receiver')).toBe(31500);
  });
});

describe('negotiable payer', () => {
  it('opens at the ask instead of $0 and never pays above it', () => {
    const terms: LinkTerms = {
      link: link('A|B', 'A', 'B', 'A'), payer: 'A', receiver: 'B', payCents: null, askCents: 30000, payerFirm: false, receiverFirm: false,
    };
    const lb = linkBounds(terms, { minCents: 0, maxCents: UNBOUNDED }, { minCents: 20000, maxCents: UNBOUNDED });
    expect(lb.payerOpenCents).toBe(30000);
    expect(lb.payer.maxCents).toBe(30000);
  });
});

describe('priceArrangement', () => {
  it('S1 prices B-C at $50 and A-B between $50 and $60 within 3 rounds', async () => {
    s1();
    await connect('A', 'B', 'C');
    const result = await priceArrangement(arrangement());
    expect(result.state).toBe('agreed');
    const byId = Object.fromEntries(result.links.map((l) => [l.id, l]));
    expect(byId['B|C']!.amountCents).toBe(5000);
    expect(byId['A|B']!.amountCents).toBeGreaterThanOrEqual(5000);
    expect(byId['A|B']!.amountCents).toBeLessThanOrEqual(6000);
    expect(result.links.every((l) => l.state === 'agreed')).toBe(true);
    const rounds = Math.max(...log.entries.map((e) => e.round));
    expect(rounds).toBeLessThanOrEqual(3);
  });

  it('emits negotiation.round and arrangement.priced', async () => {
    s1();
    await connect('A', 'B', 'C');
    const rounds: number[] = [];
    const priced: string[] = [];
    events.on('negotiation.round', (e) => rounds.push(e.round));
    events.on('arrangement.priced', (e) => priced.push(e.arrangementId));
    await priceArrangement(arrangement('arr-events'));
    expect(rounds.length).toBeGreaterThan(0);
    expect(priced).toEqual(['arr-events']);
  });

  it('is deterministic across runs', async () => {
    s1();
    await connect('A', 'B', 'C');
    const first = await priceArrangement(arrangement('r1'));
    const second = await priceArrangement(arrangement('r2'));
    expect(first.links.map((l) => l.amountCents)).toEqual(second.links.map((l) => l.amountCents));
  });

  it('a firm $315 seller and a $300-capped buyer fail and report a near miss', async () => {
    add('A', [cash(30000)], [[ticket('x1')]], -30000);
    add('C', [ticket('x1')], [[cash(31500, 'firm')]], 31500);
    await connect('A', 'C');
    const notes: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
    events.on('notify', (n) => notes.push(n));
    const result = await priceArrangement({
      id: 'firm',
      slots: ['A', 'C'].map((intentId) => ({ intentId, intentVersion: 1, approval: 'queued' as const })),
      links: [link('A|C', 'A', 'C', 'A')],
    });
    expect(result.state).toBe('failed');
    expect(result.failedLinkId).toBe('A|C');
    expect(result.links.every((l) => l.amountCents === null)).toBe(true);
    expect(notes.some((n) => n.kind === 'near_miss' && n.payload?.gapCents === 1500)).toBe(true);
  });

  it('fails when a participant version is stale', async () => {
    s1();
    await connect('A', 'B', 'C');
    repo.intents.get('B')!.version = 2;
    expect((await priceArrangement(arrangement())).reason).toBe('stale');
  });

  it('gives every offer and accept a spoken line', async () => {
    s1();
    await connect('A', 'B', 'C');
    setWordingProvider(async () => 'ok');
    const result = await priceArrangement(arrangement());
    expect(result.state).toBe('agreed');
    const money = log.entries.filter((e) => e.kind === 'offer' || e.kind === 'accept');
    expect(log.entries.filter((e) => e.kind === 'say')).toHaveLength(money.length);
  });
});

describe('sessions', () => {
  it('property: 500 random bound pairs agree within both bounds, and fail only without overlap', async () => {
    add('A', [cash(1)], [[ticket('x1')]], null);
    add('B', [ticket('x1')], [[cash(1)]], null);
    await connect('A', 'B');
    let seed = 12345;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 500; i += 1) {
      const payerMax = rand(20000);
      const receiverMin = rand(20000);
      const payerOpen = rand(payerMax + 1);
      const receiverAsk = receiverMin + rand(5000);
      const result = await runSession({
        key: `prop/${i}`, payerId: 'A', receiverId: 'B',
        bounds: {
          payer: { minCents: 0, maxCents: payerMax },
          receiver: { minCents: receiverMin, maxCents: UNBOUNDED },
          payerOpenCents: payerOpen, receiverAskCents: receiverAsk,
        },
      });
      if (result.state === 'agreed') {
        expect(result.amountCents!).toBeLessThanOrEqual(payerMax);
        expect(result.amountCents!).toBeGreaterThanOrEqual(receiverMin);
        expect(result.rounds).toBeLessThanOrEqual(3);
      } else {
        expect(receiverMin).toBeGreaterThan(payerMax);
      }
    }
  }, 30000);

  it('lets the receiver answer a user-named price: ask its user when above its minimum, decline below', async () => {
    add('A', [cash(1)], [[ticket('x1')]], null);
    add('B', [ticket('x1')], [[cash(1)]], null);
    await connect('A', 'B');
    const asked: Array<[string, number]> = [];
    events.on('negotiation.awaiting_user', (e) => asked.push([e.side ?? '', e.amountCents]));
    const bounds = (min: number) => ({
      payer: { minCents: 0, maxCents: 10000 },
      receiver: { minCents: min, maxCents: UNBOUNDED },
      payerOpenCents: 9000, receiverAskCents: 10000, directed: true,
    });
    const ok = await runSession({ key: 'dir/1', payerId: 'A', receiverId: 'B', bounds: bounds(5000) });
    expect(ok).toMatchObject({ state: 'agreed', amountCents: 9000, pendingUser: true });
    expect(asked).toEqual([['receiver', 9000]]);
    const no = await runSession({ key: 'dir/2', payerId: 'A', receiverId: 'B', bounds: bounds(9500) });
    expect(no.state).toBe('failed');
  });

  it('hands a negotiable payer\'s counter-price to its user instead of accepting', async () => {
    add('A', [cash(1)], [[ticket('x1')]], null);
    add('B', [ticket('x1')], [[cash(1)]], null);
    await connect('A', 'B');
    const asked: number[] = [];
    events.on('negotiation.awaiting_user', (e) => asked.push(e.amountCents));
    const result = await runSession({
      key: 'defer/1', payerId: 'A', receiverId: 'B',
      bounds: {
        payer: { minCents: 0, maxCents: 30000 },
        receiver: { minCents: 0, maxCents: UNBOUNDED },
        payerOpenCents: 18000, receiverAskCents: 30000, payerNegotiable: true,
      },
    });
    expect(result).toMatchObject({ state: 'agreed', amountCents: 20000, pendingUser: true });
    expect(asked).toEqual([20000]);
  });
});

describe('direct negotiation', () => {
  it('asks the negotiable $110 seller for $90 when a comparable $100 firm ticket is available', async () => {
    add('edward', [{ kind: 'cash', label: 'cash', attrs: {}, qty: 1 }], [[ticket('ticket')]], null);
    add('kat', [ticket('ticket')], [[cash(10000, 'firm')]], 10000, 10000);
    add('dawg', [ticket('ticket')], [[cash(11000, 'flexible')]], null, 11000);
    await connect('edward', 'kat', 'dawg');
    const pending: Array<{ intentId: string; amountCents: number }> = [];
    const onPending = (event: { intentId: string; amountCents: number }) => { pending.push(event); };
    events.on('negotiation.awaiting_user', onPending);
    try {
      const result = await negotiateDirect('uedward', { ownIntentId: 'edward', targetIntentId: 'dawg' });
      expect(result).toMatchObject({ status: 'pending', amountCents: 9000 });
      expect(log.entries.find((entry) => entry.kind === 'offer')).toMatchObject({
        from: 'edward', to: 'dawg', amountCents: 9000,
      });
      expect(log.entries.some((entry) => entry.from === 'edward' && entry.text === 'Could you do $90?')).toBe(true);
      expect(pending).toEqual([{ intentId: 'dawg', amountCents: 9000, side: 'receiver', counterpartIntentId: 'edward', linkId: expect.any(String) }]);
      expect(log.entries.some((entry) => entry.kind === 'accept')).toBe(false);
    } finally {
      events.off('negotiation.awaiting_user', onPending);
    }
  });

  it('does not discount the firm seller or an unrelated alternative', async () => {
    add('edward', [{ kind: 'cash', label: 'cash', attrs: {}, qty: 1 }], [[ticket('concert')]], null);
    add('kat', [ticket('concert')], [[cash(10000, 'firm')]], 10000, 10000);
    add('dawg', [ticket('concert')], [[cash(11000, 'flexible')]], null, 11000);
    await connect('edward', 'kat', 'dawg');
    await negotiateDirect('uedward', { ownIntentId: 'edward', targetIntentId: 'kat' });
    expect(log.entries.find((entry) => entry.kind === 'offer')?.amountCents).toBe(10000);
    repo.intents.get('kat')!.public.give = [ticket('unrelated')];
    repo.intents.get('kat')!.version += 1;
    log.entries.length = 0;
    await negotiateDirect('uedward', { ownIntentId: 'edward', targetIntentId: 'dawg' });
    expect(log.entries.find((entry) => entry.kind === 'offer')?.amountCents).toBe(11000);
  });

  it('preserves an explicit buyer offer instead of replacing it with a competitive opening', async () => {
    add('edward', [cash(9500)], [[ticket('ticket')]], -10000, -9500);
    add('kat', [ticket('ticket')], [[cash(10000, 'firm')]], 10000, 10000);
    add('dawg', [ticket('ticket')], [[cash(11000, 'flexible')]], null, 11000);
    await connect('edward', 'kat', 'dawg');
    await negotiateDirect('uedward', { ownIntentId: 'edward', targetIntentId: 'dawg' });
    expect(log.entries.find((entry) => entry.kind === 'offer')?.amountCents).toBe(9500);
  });

  it('negotiates the shared link for relevant intents', async () => {
    s1();
    await connect('A', 'B', 'C');
    const result = await negotiateDirect('uB', { ownIntentId: 'B', targetIntentId: 'C' });
    expect(result).toMatchObject({ status: 'agreed', amountCents: 5000 });
  });

  it('rejects non-relevant targets and out-of-bounds anchors', async () => {
    s1();
    await connect('A', 'B', 'C');
    expect((await negotiateDirect('uA', { ownIntentId: 'A', targetIntentId: 'C' })).status).toBe('not_relevant');
    expect((await negotiateDirect('uX', { ownIntentId: 'A', targetIntentId: 'B' })).status).toBe('forbidden');
    expect((await negotiateDirect('uA', { ownIntentId: 'A', targetIntentId: 'B', targetCents: 9999 })).status).toBe('needs_bound_change');
  });

  it('requires auth on POST /negotiate', async () => {
    const res = await app.request('/negotiate', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });
});
