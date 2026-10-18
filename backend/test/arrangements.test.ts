import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryArrangementRepository,
  arrangementSettings,
  coordinator,
  setArrangementRepository,
  setContactLookup,
  startCoordinator,
} from '../src/arrangements/index.js';
import { stopCoordinator } from '../src/arrangements/coordinator.js';
import * as service from '../src/arrangements/service.js';
import { ArrangementError, type StoredArrangement } from '../src/arrangements/types.js';
import { termsView } from '../src/arrangements/terms.js';
import type { IntentPublic, Item } from '../src/contracts/index.js';
import { MemoryNoticeRepository } from '../src/discovery/notices.js';
import { refreshEdges, resetNearMissDeliveries, setNoticeRepository } from '../src/discovery/service.js';
import { events } from '../src/events.js';
import type { IntentRepository, StoredIntent } from '../src/intents/repository.js';
import { setIntentRepository } from '../src/intents/service.js';
import app from '../src/index.js';
import { MemoryNegotiationLogRepository, setNegotiationLogRepository } from '../src/negotiation/log.js';
import { installNegotiation, resetSessions } from '../src/negotiation/session.js';
import { setWordingProvider, templateWording } from '../src/negotiation/wording.js';
import { bus } from '../src/runtime/bus.js';
import { buildGuardContext } from '../src/runtime/guard-context.js';
import { resetHooks } from '../src/runtime/hooks.js';
import { ensureAgent, scheduler, startRuntime, stopRuntime } from '../src/runtime/registry.js';
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
  async remove(id: string, ownerId: string, state: string) { const i = this.intents.get(id); if (!i || i.ownerId !== ownerId || i.state !== state) return false; return this.intents.delete(id); }
  async listOpen() { return [...this.intents.values()].filter((i) => i.state === 'open'); }
}

let repo: MemoryRepo;
let arrs: MemoryArrangementRepository;
let sent: Array<{ userId: string; kind: string; payload?: Record<string, unknown> }>;
const onNotify = (n: { userId: string; kind: string; payload?: Record<string, unknown> }) => { sent.push(n); };

function add(id: string, give: Item[], want: Item[][], minNetCents: number | null) {
  const publicView: IntentPublic = {
    intentId: id, version: 1, ownerHandle: `h-${id}`, tier: 'new', give,
    want: want.map((anyOf) => ({ anyOf })), deadline: null, freeText: '',
  };
  repo.intents.set(id, {
    id, draftId: id, ownerId: `u${id}`, version: 1, state: 'open', public: publicView,
    private: { minNetCents, declaredNetCents: null }, sourceText: '', parsed: {}, createdAt: 0, updatedAt: 0,
  } as unknown as StoredIntent);
}

// alice pays bob, bob pays carol.
function chain() {
  add('alice', [cash(6000)], [[ticket('x1')]], -6000);
  add('bob', [ticket('x1')], [[ticket('x2')]], 0);
  add('carol', [ticket('x2')], [[cash(5000)]], 5000);
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('waitFor timed out');
}

const rows = (): StoredArrangement[] => [...arrs.rows.values()];
const byState = (state: string) => rows().filter((r) => r.state === state);
const kinds = (userId: string, kind: string) => sent.filter((n) => n.userId === userId && n.kind === kind);

async function start(...ids: string[]) {
  for (const id of ids) await refreshEdges(id);
  await startRuntime();
  await startCoordinator({ rehydrate: false });
}

beforeEach(() => {
  repo = new MemoryRepo();
  arrs = new MemoryArrangementRepository();
  sent = [];
  events.on('notify', onNotify);
  setIntentRepository(repo);
  setSignalRepository(new MemorySignalRepository());
  setNoticeRepository(new MemoryNoticeRepository());
  setNegotiationLogRepository(new MemoryNegotiationLogRepository());
  setArrangementRepository(arrs);
  setContactLookup(async (ids) => new Map(ids.map((id) => [id, `+1-${id}`] as const)));
  setWordingProvider(async (ctx) => templateWording(ctx));
  resetNearMissDeliveries();
  bus.reset();
  resetHooks();
  installNegotiation();
  bus.setGuardContext(buildGuardContext);
  scheduler.coalesceMs = 10;
  coordinator.coalesceMs = 10;
  arrangementSettings.approvalWindowMs = 60_000;
  arrangementSettings.replaceWindowMs = 60_000;
  arrangementSettings.pendingCap = 3;
});

afterEach(() => {
  events.off('notify', onNotify);
  stopCoordinator();
  stopRuntime();
  resetSessions();
  bus.reset();
  resetHooks();
  setWordingProvider();
  setNegotiationLogRepository();
  setArrangementRepository();
  setContactLookup();
  setIntentRepository();
  setSignalRepository();
  setNoticeRepository();
});

describe('end to end', () => {
  it('S1: proposes once, commits once, and releases contacts per counterparty pair only', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    expect(arr.slots).toHaveLength(3);
    expect(arr.links.every((l) => l.state === 'agreed' && l.amountCents !== null)).toBe(true);
    await waitFor(() => ['ualice', 'ubob', 'ucarol'].every((u) => kinds(u, 'approval_request').length === 1));

    await service.approve('ualice', arr.id);
    await service.approve('ubob', arr.id);
    expect(byState('committed')).toHaveLength(0);
    await service.approve('ucarol', arr.id);

    expect(byState('committed')).toHaveLength(1);
    expect(['alice', 'bob', 'carol'].every((id) => repo.intents.get(id)!.state === 'done')).toBe(true);
    const contacts = (u: string) => (kinds(u, 'committed')[0]!.payload!.contacts as Array<{ handle: string; phone: string }>)
      .map((c) => c.handle).sort();
    expect(contacts('ualice')).toEqual(['h-bob']);
    expect(contacts('ubob')).toEqual(['h-alice', 'h-carol']);
    expect(contacts('ucarol')).toEqual(['h-bob']);
    expect(JSON.stringify(kinds('ualice', 'committed')[0])).not.toContain('h-carol');

    await coordinator.idle();
    expect(rows()).toHaveLength(1);
  });

  it('S1 committed deals expose counterparties to contact', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    for (const u of ['ualice', 'ubob', 'ucarol']) await service.approve(u, id);
    const mine = await service.listMine('ubob');
    expect(mine[0]!.contacts!.length).toBeGreaterThan(0);
  });

  it('S2: a decline is replaced by a new participant at the old amounts; only they are asked', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    const amounts = arr.links.map((l) => l.amountCents);
    await service.approve('ualice', arr.id);
    await service.approve('ubob', arr.id);
    await service.decline('ucarol', arr.id);
    expect(arrs.rows.get(arr.id)!.slots.find((s) => s.intentId === 'carol')!.approval).toBe('declined');

    add('dave', [ticket('x2')], [[cash(5000)]], 5000);
    await refreshEdges('bob');
    await refreshEdges('dave');
    ensureAgent('dave');
    await waitFor(() => arrs.rows.get(arr.id)!.revision === 2);

    const next = arrs.rows.get(arr.id)!;
    expect(next.slots.map((s) => s.intentId).sort()).toEqual(['alice', 'bob', 'dave']);
    expect(next.links.map((l) => l.amountCents)).toEqual(amounts);
    expect(next.slots.find((s) => s.intentId === 'alice')!.approval).toBe('approved');
    expect(next.slots.find((s) => s.intentId === 'bob')!.approval).toBe('approved');
    expect(kinds('udave', 'approval_request')).toHaveLength(1);
    expect(kinds('ualice', 'approval_request')).toHaveLength(1);
    expect(kinds('ubob', 'approval_request')).toHaveLength(1);

    await service.approve('udave', arr.id);
    expect(arrs.rows.get(arr.id)!.state).toBe('committed');
    await coordinator.idle();
    expect(rows().filter((r) => r.slots.some((s) => s.intentId === 'carol' && r.state === 'proposed'))).toHaveLength(0);
  });

  it('S3: no replacement within the window dissolves the arrangement and tells approvers once', async () => {
    arrangementSettings.replaceWindowMs = 150;
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    await service.approve('ualice', id);
    await service.approve('ubob', id);
    await service.decline('ucarol', id);
    await waitFor(() => arrs.rows.get(id)!.state === 'dissolved');
    await coordinator.idle();
    expect(arrs.rows.get(id)!.reason).toBe('no_replacement');
    expect(kinds('ualice', 'dissolved')).toHaveLength(1);
    expect(kinds('ubob', 'dissolved')).toHaveLength(1);
    expect(kinds('ucarol', 'dissolved')).toHaveLength(0);
  });

  it('S4: committing one arrangement dissolves the others that share an intent', async () => {
    add('alice', [cash(6000)], [[ticket('x1')]], -6000);
    add('bob1', [ticket('x1')], [[cash(5000)]], 5000);
    add('bob2', [ticket('x1')], [[cash(5500)]], 5500);
    await start('alice', 'bob1', 'bob2');
    await waitFor(() => byState('proposed').length === 2);
    const first = byState('proposed').find((r) => r.slots.some((s) => s.intentId === 'bob1'))!;
    const second = byState('proposed').find((r) => r.slots.some((s) => s.intentId === 'bob2'))!;

    await service.approve('ualice', second.id);
    await service.approve('ualice', first.id);
    await service.approve('ubob1', first.id);

    expect(arrs.rows.get(first.id)!.state).toBe('committed');
    expect(arrs.rows.get(second.id)!.state).toBe('dissolved');
    expect(arrs.rows.get(second.id)!.reason).toBe('consumed');
    expect(kinds('ualice', 'dissolved')).toHaveLength(1);
    expect(repo.intents.get('bob2')!.state).toBe('open');
  });
});

describe('approvals', () => {
  it('does not re-propose an arrangement a participant declined', async () => {
    arrangementSettings.replaceWindowMs = 100;
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    await service.decline('ualice', id);
    await service.vacateSlot(id, 'bob', 'withdrawn');
    await waitFor(() => arrs.rows.get(id)!.state === 'dissolved');
    await new Promise((r) => setTimeout(r, 120));
    await coordinator.idle();
    expect(rows().filter((r) => r.state === 'proposed')).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });

  it('times out a request, treats it as a decline, and remembers it', async () => {
    arrangementSettings.approvalWindowMs = 80;
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => rows().some((r) => r.slots.some((s) => s.approval === 'timed_out')));
    const arr = rows()[0]!;
    expect(await arrs.isDeclined('ualice', arr.key)).toBe(true);
    expect(arr.excluded.length).toBeGreaterThan(0);
  });

  it('retract after approval vacates the slot', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    await service.approve('ualice', id);
    await service.retract('ualice', id);
    expect(arrs.rows.get(id)!.slots.find((s) => s.intentId === 'alice')!.approval).toBe('retracted');
    await expect(service.retract('ubob', id)).rejects.toMatchObject({ status: 409 });
  });

  it('voids a slot when its intent changes version', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    const bob = repo.intents.get('bob')!;
    repo.intents.set('bob', { ...bob, version: 2 });
    events.emit('intent.updated', { intentId: 'bob' });
    await waitFor(() => arrs.rows.get(id)!.slots.find((s) => s.intentId === 'bob')!.approval === 'void');
  });

  it('voids a slot when its intent is withdrawn', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    repo.intents.set('carol', { ...repo.intents.get('carol')!, state: 'withdrawn' });
    events.emit('intent.closed', { intentId: 'carol' });
    await waitFor(() => arrs.rows.get(id)!.slots.find((s) => s.intentId === 'carol')!.approval === 'void');
  });

  it('caps pending requests per user and promotes a queued one when a slot frees', async () => {
    add('alice', [cash(6000)], [[ticket('x1')]], -6000);
    for (const n of [1, 2, 3, 4]) add(`b${n}`, [ticket('x1')], [[cash(5000 + n * 10)]], 5000);
    await start('alice', 'b1', 'b2', 'b3', 'b4');
    await waitFor(() => byState('proposed').length === 4);
    const mineStates = () => rows().flatMap((r) => r.slots).filter((s) => s.userId === 'ualice').map((s) => s.approval);
    expect(mineStates().filter((s) => s === 'requested')).toHaveLength(3);
    expect(mineStates().filter((s) => s === 'queued')).toHaveLength(1);
    const queued = byState('proposed').find((r) => r.slots.some((s) => s.userId === 'ualice' && s.approval === 'queued'))!;
    await expect(service.approve('ualice', queued.id)).rejects.toMatchObject({ status: 409 });

    const requested = byState('proposed').find((r) => r.slots.some((s) => s.userId === 'ualice' && s.approval === 'requested'))!;
    await service.decline('ualice', requested.id);
    expect(mineStates().filter((s) => s === 'queued')).toHaveLength(0);
    expect(kinds('ualice', 'approval_request')).toHaveLength(4);
  });

  it('negotiate further re-prices one link and bumps the revision', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    await service.approve('ucarol', arr.id);
    const result = await service.negotiateFurther('ualice', arr.id, { targetCents: 5500, linkId: 'alice|bob' });
    expect(result.status).toBe('agreed');
    const next = arrs.rows.get(arr.id)!;
    expect(next.revision).toBe(2);
    expect(next.slots.find((s) => s.intentId === 'carol')!.approval).toBe('approved');
    const bad = await service.negotiateFurther('ualice', arr.id, { targetCents: 999999, linkId: 'alice|bob' });
    expect(bad).toMatchObject({ status: 'failed' });
  });

  it('lets a seller who already approved name a lower price than their listed ask', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    await service.approve('ucarol', arr.id);
    const result = await service.negotiateFurther('ucarol', arr.id, { targetCents: 4800, linkId: 'bob|carol' });
    expect(result.status).not.toBe('failed');
  });

  it('a standing proposal is settled by the other user saying yes, leaving nobody waiting', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    for (const l of arrs.rows.get(arr.id)!.links) if (l.id === 'alice|bob') l.amountCents = 6000;
    arrs.rows.get(arr.id)!.proposal = { linkId: 'bob|carol', amountCents: 5200, fromIntentId: 'carol' };
    await service.approve('ubob', arr.id);
    const next = arrs.rows.get(arr.id)!;
    expect(next.proposal).toBeNull();
    expect(next.links.find((l) => l.id === 'bob|carol')!.amountCents).toBe(5200);
    expect(next.slots.find((s) => s.intentId === 'carol')!.approval).toBe('approved');
    expect(next.slots.find((s) => s.intentId === 'bob')!.approval).toBe('approved');
  });

  it('saying no to a proposal drops only that price', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    arrs.rows.get(arr.id)!.proposal = { linkId: 'bob|carol', amountCents: 5200, fromIntentId: 'carol' };
    await service.decline('ubob', arr.id);
    const next = arrs.rows.get(arr.id)!;
    expect(next.proposal).toBeNull();
    expect(next.state).toBe('proposed');
    expect(next.slots.find((s) => s.intentId === 'bob')!.approval).not.toBe('declined');
  });

  it('hides arrangements from non-participants with a 404', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const id = byState('proposed')[0]!.id;
    await expect(service.approve('ustranger', id)).rejects.toBeInstanceOf(ArrangementError);
    await expect(service.approve('ustranger', id)).rejects.toMatchObject({ status: 404 });
    await expect(service.approve('ualice', 'missing')).rejects.toMatchObject({ status: 404 });
  });
});

describe('terms view', () => {
  it('only shows counterparties and never leaks other participants', async () => {
    chain();
    await start('alice', 'bob', 'carol');
    await waitFor(() => byState('proposed').length === 1);
    const arr = byState('proposed')[0]!;
    const intents = new Map([...repo.intents].map(([id, i]) => [id, i] as const));
    for (const slot of arr.slots) {
      const view = termsView(arr, slot, intents, null);
      const text = JSON.stringify(view);
      const counterparties = new Set(arr.links.filter((l) => l.a === slot.intentId || l.b === slot.intentId)
        .map((l) => (l.a === slot.intentId ? l.b : l.a)));
      for (const other of arr.slots.map((s) => s.intentId).filter((i) => i !== slot.intentId && !counterparties.has(i))) {
        expect(text).not.toContain(other);
        expect(text).not.toContain(`h-${other}`);
      }
      expect(text).not.toContain(slot.intentId === 'alice' ? 'carol' : '\u0000');
    }
    const aliceView = termsView(arr, arr.slots.find((s) => s.intentId === 'alice')!, intents, null);
    expect(aliceView.otherParticipants).toBe(1);
    expect(aliceView.cashOut).toHaveLength(1);
    expect(aliceView.cashOut[0]!.toHandle).toBe('h-bob');
  });
});

describe('routes', () => {
  it('requires authentication', async () => {
    expect((await app.request('/arrangements/mine')).status).toBe(401);
    expect((await app.request('/arrangements/abc/approve', { method: 'POST' })).status).toBe(401);
  });
});
