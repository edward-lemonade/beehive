import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Envelope, IntentPublic, Item } from '../src/contracts/index.js';
import { MemoryNoticeRepository } from '../src/discovery/notices.js';
import { resetNearMissDeliveries, setNoticeRepository, startDiscovery, stopDiscovery } from '../src/discovery/service.js';
import { events } from '../src/events.js';
import type { IntentRepository, StoredIntent } from '../src/intents/repository.js';
import { setIntentRepository } from '../src/intents/service.js';
import app from '../src/index.js';
import { ensureAgent, scheduler, startRuntime, stopRuntime, rehydrate } from '../src/runtime/registry.js';
import { bus, makeEnvelope } from '../src/runtime/bus.js';
import { buildGuardContext } from '../src/runtime/guard-context.js';
import { guard, type GuardContext } from '../src/runtime/guard.js';
import { resetHooks } from '../src/runtime/hooks.js';
import { MemorySignalRepository, setSignalRepository } from '../src/runtime/signals.js';

const ticket = (label: string): Item => ({ kind: 'ticket', label, attrs: {}, qty: 1 });
const cash = (amountCents: number): Item => ({ kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents });

class MemoryRepo implements IntentRepository {
  readonly intents = new Map<string, StoredIntent>();
  async createMany(records: StoredIntent[]) { records.forEach((r) => this.intents.set(r.id, r)); return records; }
  async get(id: string) { return this.intents.get(id); }
  async saveVersion(record: StoredIntent) { this.intents.set(record.id, record); return true; }
  async changeState() { return undefined; }
  async expireDue() { return []; }
  async listMine(ownerId: string) { return [...this.intents.values()].filter((i) => i.ownerId === ownerId); }
  async listOpen() { return [...this.intents.values()].filter((i) => i.state === 'open'); }
}

let repo: MemoryRepo;
let signals: MemorySignalRepository;

function add(id: string, ownerId: string, give: Item[], want: Item[][], minNetCents: number | null = null): StoredIntent {
  const publicView: IntentPublic = {
    intentId: id, version: 1, ownerHandle: `h-${id}`, tier: 'new', give,
    want: want.map((anyOf) => ({ anyOf })), deadline: null, freeText: '',
  };
  const stored = {
    id, draftId: id, ownerId, version: 1, state: 'open', public: publicView,
    private: { minNetCents, declaredNetCents: null }, sourceText: '', parsed: {}, createdAt: 0, updatedAt: 0,
  } as unknown as StoredIntent;
  repo.intents.set(id, stored);
  return stored;
}

function s1() {
  add('A', 'ua', [cash(30000)], [[ticket('t1')]], 0);
  add('B', 'ub', [ticket('t1')], [[ticket('t2')]]);
  add('C', 'uc', [ticket('t2')], [[cash(30000)]]);
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('waitFor timed out');
}

const settle = async () => { await scheduler.idle(); await bus.drain(); await scheduler.idle(); await bus.drain(); };

beforeEach(() => {
  repo = new MemoryRepo();
  signals = new MemorySignalRepository();
  setIntentRepository(repo);
  setSignalRepository(signals);
  setNoticeRepository(new MemoryNoticeRepository());
  resetNearMissDeliveries();
  bus.reset();
  resetHooks();
  scheduler.coalesceMs = 10;
});

afterEach(() => {
  stopRuntime();
  stopDiscovery();
  bus.reset();
  resetHooks();
  setIntentRepository();
  setSignalRepository();
  setNoticeRepository();
});

const baseCtx: GuardContext = {
  senderVersion: 1, recipientVersion: 1, relevant: new Set(['B']), retractTargets: new Set(),
  coordinatorRecipients: new Set(), senderBounds: [-15000], forbidden: ['h-other', 'other-id'],
};
const signal = (from: string, to: string, extra: object = {}): Envelope => ({
  ...makeEnvelope(from, to, { type: 'signal', fromVersion: 1, toVersion: 1, satisfiable: true }),
  ...extra,
});

describe('guard', () => {
  it('passes a valid signal', () => {
    expect(guard(signal('A', 'B'), baseCtx).ok).toBe(true);
  });

  it('rejects non-relevant addressees', () => {
    const r = guard(signal('A', 'Z'), baseCtx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.rule).toBe('addressee');
  });

  it('allows retraction to a non-relevant former neighbor', () => {
    const env = makeEnvelope('A', 'Z', { type: 'signal', fromVersion: 1, toVersion: 1, satisfiable: false });
    expect(guard(env, { ...baseCtx, retractTargets: new Set(['Z']) }).ok).toBe(true);
  });

  it('rejects extra keys and bad schema', () => {
    const env = signal('A', 'B');
    (env.body as Record<string, unknown>).secret = 1;
    const r = guard(env, baseCtx);
    expect(!r.ok && r.violation.rule).toBe('schema');
  });

  it('rejects stale versions', () => {
    const r = guard(signal('A', 'B'), { ...baseCtx, recipientVersion: 2 });
    expect(!r.ok && r.violation.rule).toBe('version');
  });

  it.each(['$150', '150', '150.00', '15,000 cents', '-150', '150,'])('rejects bound leak in say: %s', (text) => {
    const env = makeEnvelope('A', 'B', { type: 'say', linkId: 'l1', text: `I could do ${text} maybe` });
    const r = guard(env, baseCtx);
    expect(!r.ok && r.violation.rule).toBe('content');
  });

  it('allows unrelated numbers and rejects other intents handle', () => {
    expect(guard(makeEnvelope('A', 'B', { type: 'say', linkId: 'l1', text: 'how about 120?' }), baseCtx).ok).toBe(true);
    const r = guard(makeEnvelope('A', 'B', { type: 'say', linkId: 'l1', text: 'ask H-Other' }), baseCtx);
    expect(!r.ok && r.violation.rule).toBe('content');
  });

  it('rejects coordinator envelopes without hook recipients', () => {
    const env = makeEnvelope('coordinator', 'B', { type: 'say', linkId: 'l', text: 'hi' });
    expect(guard(env, baseCtx).ok).toBe(false);
  });
});

describe('bus', () => {
  it('delivers in order and reports violations', async () => {
    startDiscovery();
    await startRuntime({ rehydrate: false });
    add('A', 'ua', [cash(1)], [[ticket('t1')]]);
    add('B', 'ub', [ticket('t1')], [[cash(1)]]);
    const { refreshEdges } = await import('../src/discovery/service.js');
    await refreshEdges('A');
    bus.setGuardContext(buildGuardContext);
    const seen: boolean[] = [];
    bus.subscribe('B', (e) => { if (e.body.type === 'signal') seen.push(e.body.satisfiable); });
    const violations: string[] = [];
    bus.onViolation((v) => violations.push(v.rule));
    await bus.send(makeEnvelope('A', 'B', { type: 'signal', fromVersion: 1, toVersion: 1, satisfiable: true }));
    await bus.send(makeEnvelope('A', 'B', { type: 'signal', fromVersion: 1, toVersion: 1, satisfiable: false }));
    await bus.send(makeEnvelope('A', 'ghost', { type: 'signal', fromVersion: 1, toVersion: 1, satisfiable: true }));
    await bus.drain();
    expect(seen).toEqual([true, false]);
    expect(violations).toEqual(['addressee']);
  });
});

describe('agents', () => {
  it('S1: signals flow along edges only, never A to C', async () => {
    startDiscovery();
    s1();
    await startRuntime();
    await waitFor(async () => (await signals.from('A')).length > 0 && (await signals.from('C')).length > 0);
    await settle();
    expect(bus.log.some((e) => (e.from === 'A' && e.to === 'C') || (e.from === 'C' && e.to === 'A'))).toBe(false);
    expect(bus.log.every((e) => e.delivered)).toBe(true);
    expect((await signals.from('B')).length).toBe(2);
  });

  it('removing C makes B retract to A and A signals false to B', async () => {
    startDiscovery();
    s1();
    await startRuntime();
    await waitFor(async () => (await signals.from('B')).length === 2);
    await settle();
    repo.intents.get('C')!.state = 'withdrawn' as never;
    events.emit('intent.closed', { intentId: 'C' });
    await waitFor(async () => (await signals.from('B')).some((s) => s.to === 'A' && !s.satisfiable));
    await settle();
    await waitFor(async () => (await signals.from('A')).some((s) => !s.satisfiable));
  });

  it('precheck enforces version, minimum and items', async () => {
    add('A', 'ua', [cash(30000)], [[ticket('t1')]], 20000);
    const agent = ensureAgent('A');
    expect((await agent.precheck({ intentVersion: 1, netCents: 25000, give: [cash(30000)], receive: [ticket('t1')] })).ok).toBe(true);
    expect((await agent.precheck({ intentVersion: 2, netCents: 25000, give: [], receive: [] })).ok).toBe(false);
    expect((await agent.precheck({ intentVersion: 1, netCents: 100, give: [], receive: [] })).ok).toBe(false);
    expect((await agent.precheck({ intentVersion: 1, netCents: 25000, give: [ticket('zz')], receive: [] })).ok).toBe(false);
  });

  it('dormant agent notifies nothing_found once, not on boot', async () => {
    startDiscovery();
    add('A', 'ua', [cash(1)], [[ticket('nobody-has')]]);
    const notes: unknown[] = [];
    events.on('notify', (n: unknown) => notes.push(n));
    await startRuntime();
    await settle();
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    expect(notes).toHaveLength(0);
    events.emit('intent.updated', { intentId: 'A' });
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    scheduler.wake('A', 'keep');
    await new Promise((r) => setTimeout(r, 100));
    await settle();
    expect(notes.filter((n) => (n as { kind: string }).kind === 'nothing_found')).toHaveLength(1);
  });

  it('restart rehydrates without resending unchanged signals', async () => {
    startDiscovery();
    s1();
    await startRuntime();
    await waitFor(async () => (await signals.from('B')).length === 2);
    await settle();
    stopRuntime();
    bus.reset();
    await startRuntime();
    await rehydrate();
    await settle();
    await new Promise((r) => setTimeout(r, 200));
    await settle();
    expect(bus.log.filter((e) => e.type === 'signal')).toHaveLength(0);
  });

  it('settles 200 seeded intents quickly', async () => {
    startDiscovery();
    for (let i = 0; i < 200; i += 1) {
      add(`P${i}`, `u${i}`, [ticket(`t${i}`)], [[ticket(`t${(i + 1) % 200}`)]]);
    }
    const t0 = Date.now();
    await startRuntime();
    await waitFor(async () => (await signals.from('P0')).length > 0, 3000);
    await settle();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('keep-looking route', () => {
  it('requires auth', async () => {
    const res = await app.request('/intents/00000000-0000-4000-8000-000000000000/keep-looking', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
