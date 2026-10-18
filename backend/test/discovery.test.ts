import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntentPublic, Item } from '../src/contracts/index.js';
import { directlyRelevant, itemMatch, nearMissBetween } from '../src/discovery/match.js';
import { MemoryNoticeRepository } from '../src/discovery/notices.js';
import {
  deliverableNearMisses,
  detectNearMisses,
  getEdges,
  getNeighborhood,
  refreshEdges,
  relevantTo,
  resetNearMissDeliveries,
  setNoticeRepository,
  startDiscovery,
  stopDiscovery,
} from '../src/discovery/service.js';
import { events } from '../src/events.js';
import type { IntentRepository, StoredIntent } from '../src/intents/repository.js';
import { setIntentRepository } from '../src/intents/service.js';

const ticket = (label: string, qty = 1, attrs: Item['attrs'] = {}): Item => ({ kind: 'ticket', label, attrs, qty });
const cash = (amountCents: number): Item => ({ kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents });
const sublet = (start: string, end: string): Item => ({
  kind: 'sublet', label: 'room', attrs: { dateStart: start, dateEnd: end }, qty: 1,
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

function add(id: string, ownerId: string, give: Item[], want: Item[][], version = 1): StoredIntent {
  const publicView: IntentPublic = {
    intentId: id, version, ownerHandle: `h-${ownerId}`, tier: 'new', give,
    want: want.map((anyOf) => ({ anyOf })), deadline: null, freeText: '',
  };
  const stored = {
    id, draftId: id, ownerId, version, state: 'open', public: publicView,
    private: { minNetCents: null, declaredNetCents: null }, sourceText: '', parsed: {}, createdAt: 0, updatedAt: 0,
  } as unknown as StoredIntent;
  repo.intents.set(id, stored);
  return stored;
}

function s1() {
  add('A', 'ua', [cash(30000)], [[ticket('t1')]]);
  add('B', 'ub', [ticket('t1')], [[ticket('t2')]]);
  add('C', 'uc', [ticket('t2')], [[cash(30000)]]);
}

beforeEach(() => {
  repo = new MemoryRepo();
  setIntentRepository(repo);
  setNoticeRepository(new MemoryNoticeRepository());
  resetNearMissDeliveries();
});

afterEach(() => {
  stopDiscovery();
  setIntentRepository();
  setNoticeRepository();
  vi.useRealTimers();
});

describe('itemMatch', () => {
  it('matches kind, normalized label and attrs', () => {
    expect(itemMatch(ticket(' T1 ', 1, { day: 'Fri', extra: 1 }), ticket('t1', 1, { day: 'fri' }))).toBe(true);
    expect(itemMatch(ticket('t1', 1, { day: 'sat' }), ticket('t1', 1, { day: 'fri' }))).toBe(false);
    expect(itemMatch(ticket('t1'), ticket('t1', 1, { day: 'fri' }))).toBe(false);
  });

  it('requires enough quantity and never matches cash', () => {
    expect(itemMatch(ticket('t1', 1), ticket('t1', 2))).toBe(false);
    expect(itemMatch(ticket('t1', 3), ticket('t1', 2))).toBe(true);
    expect(itemMatch(cash(100), cash(100))).toBe(false);
  });

  it('uses containment for sublet dates and supports anyOf', () => {
    const offered = sublet('2026-06-01', '2026-08-31');
    expect(itemMatch(offered, sublet('2026-06-10', '2026-07-01'))).toBe(true);
    expect(itemMatch(offered, sublet('2026-05-20', '2026-07-01'))).toBe(false);
    expect(itemMatch(offered, { anyOf: [ticket('x'), sublet('2026-07-01', '2026-07-31')] })).toBe(true);
  });
});

describe('directlyRelevant', () => {
  it('follows the S1 fixture', () => {
    s1();
    const [a, b, c] = ['A', 'B', 'C'].map((id) => repo.intents.get(id)!.public);
    expect(directlyRelevant(a!, c!)).toBeNull();
    expect(directlyRelevant(c!, a!)).toBeNull();
    expect(directlyRelevant(a!, b!)?.selfWants).toHaveLength(1);
    expect(directlyRelevant(b!, c!)?.selfWants[0]?.provider).toBe('C');
    expect(directlyRelevant(b!, a!)?.selfGives).toHaveLength(1);
  });

  it('is relevant for cash buyer and seller but not two sellers', () => {
    add('buyer', 'u1', [cash(100)], [[ticket('t1')]]);
    add('s1', 'u2', [ticket('t1')], [[cash(100)]]);
    add('s2', 'u3', [ticket('t1')], [[cash(100)]]);
    expect(directlyRelevant(repo.intents.get('buyer')!.public, repo.intents.get('s1')!.public)).not.toBeNull();
    expect(directlyRelevant(repo.intents.get('s1')!.public, repo.intents.get('s2')!.public)).toBeNull();
  });
});

describe('edges', () => {
  it('excludes own user and non-open intents from the neighborhood', async () => {
    s1();
    add('A2', 'ua', [], [[ticket('t1')]]);
    repo.intents.get('C')!.state = 'withdrawn';
    expect((await getNeighborhood('A')).map((i) => i.intentId)).toEqual(['B']);
  });

  it('refreshes edges and drops stale ones after a label edit', async () => {
    s1();
    const changed = vi.fn();
    events.on('edges.changed', changed);
    expect((await refreshEdges('B')).map((e) => e.other).sort()).toEqual(['A', 'C']);
    expect(changed).toHaveBeenCalledWith({ intentId: 'B' });

    const c = repo.intents.get('C')!;
    c.version = 2;
    c.public = { ...c.public, version: 2, give: [ticket('other-ticket')] };
    expect((await getEdges('B')).map((e) => e.other)).toEqual(['A']);
    expect((await refreshEdges('B')).map((e) => e.other)).toEqual(['A']);
    events.off('edges.changed', changed);
  });

  it('keeps A and C from ever seeing each other', async () => {
    s1();
    expect(await refreshEdges('A')).toHaveLength(1);
    expect((await refreshEdges('C')).map((e) => e.other)).toEqual(['B']);
  });

  it('refreshes 200 intents in under 500 ms', async () => {
    for (let i = 0; i < 200; i += 1) add(`i${i}`, `u${i}`, [ticket(`t${i % 20}`)], [[ticket(`t${(i + 1) % 20}`)]]);
    const start = performance.now();
    await refreshEdges('i0');
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('wake triggers', () => {
  it('coalesces opened events and clears edges when an intent closes', async () => {
    vi.useFakeTimers();
    startDiscovery();
    s1();
    const changed = vi.fn();
    events.on('edges.changed', changed);

    events.emit('intent.opened', { intentId: 'B' });
    events.emit('intent.opened', { intentId: 'B' });
    await vi.advanceTimersByTimeAsync(300);
    expect((await getEdges('B')).map((e) => e.other).sort()).toEqual(['A', 'C']);

    repo.intents.get('C')!.state = 'withdrawn';
    changed.mockClear();
    events.emit('intent.closed', { intentId: 'C' });
    await vi.advanceTimersByTimeAsync(10);
    expect(changed).toHaveBeenCalledWith({ intentId: 'B' });
    expect((await getEdges('B')).map((e) => e.other)).toEqual(['A']);
    events.off('edges.changed', changed);
  });

  it('refreshes observers on private-only and public updates', async () => {
    vi.useFakeTimers();
    startDiscovery();
    s1();
    await refreshEdges('B');
    const changed = vi.fn();
    events.on('edges.changed', changed);

    const c = repo.intents.get('C')!;
    c.version = 2;
    c.public = { ...c.public, version: 2 };
    events.emit('intent.updated', { intentId: 'C', privateOnly: true });
    await vi.advanceTimersByTimeAsync(300);
    expect(changed).toHaveBeenCalledWith({ intentId: 'B' });

    changed.mockClear();
    c.version = 3;
    c.public = { ...c.public, version: 3, give: [] };
    events.emit('intent.updated', { intentId: 'C' });
    await vi.advanceTimersByTimeAsync(300);
    expect(changed).toHaveBeenCalledWith({ intentId: 'B' });
    events.off('edges.changed', changed);
  });

  it('re-checks all open intents every 5 simulated minutes', async () => {
    vi.useFakeTimers();
    startDiscovery();
    s1();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 400);
    expect(await getEdges('B')).toHaveLength(2);
  });
});

describe('near misses', () => {
  it('detects a price near miss without handles in the text', async () => {
    add('buyer', 'u1', [cash(30000)], [[ticket('t1')]]);
    add('seller', 'u2', [ticket('t1')], [[cash(31500)]]);
    const misses = await detectNearMisses('buyer');
    expect(misses).toEqual([
      { otherHandle: 'h-u2', kind: 'price', gapCents: 1500, text: "Closest t1 I found is $315, you're at $300." },
    ]);
    expect(misses[0]!.text).not.toContain('h-u2');
  });

  it('detects partial date overlap and keeps the nearest per kind', async () => {
    add('want', 'u1', [], [[sublet('2026-06-01', '2026-07-31')]]);
    add('s1', 'u2', [sublet('2026-06-15', '2026-09-01')], []);
    add('s2', 'u3', [sublet('2026-07-01', '2026-09-01')], []);
    const misses = await detectNearMisses('want');
    expect(misses.map((m) => m.kind)).toEqual(['dates']);
  });

  it('returns nothing when the price is met', () => {
    const buyer = add('buyer', 'u1', [cash(32000)], [[ticket('t1')]]).public;
    const seller = add('seller', 'u2', [ticket('t1')], [[cash(31500)]]).public;
    expect(nearMissBetween(buyer, seller)).toEqual([]);
  });

  it('rate limits delivery unless the gap changes', async () => {
    add('buyer', 'u1', [cash(30000)], [[ticket('t1')]]);
    const seller = add('seller', 'u2', [ticket('t1')], [[cash(31500)]]);
    expect(await deliverableNearMisses('buyer')).toHaveLength(1);
    expect(await deliverableNearMisses('buyer')).toHaveLength(0);
    seller.public = { ...seller.public, want: [{ anyOf: [cash(31000)] }] };
    expect(await deliverableNearMisses('buyer')).toHaveLength(1);
  });
});

describe('relevantTo', () => {
  it('returns the caller own intent id only for directly relevant open intents', async () => {
    s1();
    expect(await relevantTo('ua', 'B')).toBe('A');
    expect(await relevantTo('ua', 'C')).toBeNull();
    expect(await relevantTo('ub', 'B')).toBeNull();
    expect(await relevantTo('ua', 'missing')).toBeNull();
  });
});
