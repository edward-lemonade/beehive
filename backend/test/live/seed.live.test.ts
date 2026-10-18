import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryArrangementRepository, arrangementSettings, coordinator, setArrangementRepository, setContactLookup, startCoordinator } from '../../src/arrangements/index.js';
import { stopCoordinator } from '../../src/arrangements/coordinator.js';
import * as service from '../../src/arrangements/service.js';
import { MemoryNoticeRepository } from '../../src/discovery/notices.js';
import { resetNearMissDeliveries, setNoticeRepository, startDiscovery, stopDiscovery } from '../../src/discovery/service.js';
import { resetSemanticCache } from '../../src/discovery/semantic.js';
import type { IntentRepository, StoredIntent } from '../../src/intents/repository.js';
import { setIntentRepository } from '../../src/intents/service.js';
import { MemoryNegotiationLogRepository, negotiationLog, setNegotiationLogRepository } from '../../src/negotiation/log.js';
import { installNegotiation, resetSessions } from '../../src/negotiation/session.js';
import { bus } from '../../src/runtime/bus.js';
import { buildGuardContext } from '../../src/runtime/guard-context.js';
import { resetHooks } from '../../src/runtime/hooks.js';
import { scheduler, startRuntime, stopRuntime } from '../../src/runtime/registry.js';
import { MemorySignalRepository, setSignalRepository } from '../../src/runtime/signals.js';
import { SEED_USERS, postScenario } from '../../src/seed/scenario.js';

class MemoryRepo implements IntentRepository {
  readonly intents = new Map<string, StoredIntent>();
  async createMany(records: StoredIntent[]) { records.forEach((r) => this.intents.set(r.id, r)); return records; }
  async get(id: string) { return this.intents.get(id); }
  async saveVersion(record: StoredIntent) { this.intents.set(record.id, record); return true; }
  async changeState() { return undefined; }
  async expireDue() { return []; }
  async listMine(ownerId: string) { return [...this.intents.values()].filter((i) => i.ownerId === ownerId); }
  async remove(id: string) { return this.intents.delete(id); }
  async listOpen() { return [...this.intents.values()].filter((i) => i.state === 'open'); }
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('waitFor timed out');
}

let repo: MemoryRepo;
let arrs: MemoryArrangementRepository;

beforeEach(() => {
  repo = new MemoryRepo();
  arrs = new MemoryArrangementRepository();
  setIntentRepository(repo);
  resetSemanticCache();
  setSignalRepository(new MemorySignalRepository());
  setNoticeRepository(new MemoryNoticeRepository());
  setNegotiationLogRepository(new MemoryNegotiationLogRepository());
  setArrangementRepository(arrs);
  setContactLookup(async (ids) => new Map(ids.map((id) => [id, `${id}@example.com`] as const)));
  resetNearMissDeliveries();
  bus.reset();
  resetHooks();
  installNegotiation();
  bus.setGuardContext(buildGuardContext);
  scheduler.coalesceMs = 10;
  coordinator.coalesceMs = 10;
  arrangementSettings.approvalWindowMs = 60_000;
});

afterEach(() => {
  stopDiscovery();
  stopCoordinator();
  stopRuntime();
  resetSessions();
  bus.reset();
  resetHooks();
  resetSemanticCache();
  setNegotiationLogRepository();
  setArrangementRepository();
  setContactLookup();
  setIntentRepository();
  setSignalRepository();
  setNoticeRepository();
});

describe('seed scenario: edward needs both deals', () => {
  it("edward's agent works with both kat and dawg in one all-or-nothing arrangement", async () => {
    startDiscovery();
    await startRuntime();
    await startCoordinator({ rehydrate: false });
    await postScenario(SEED_USERS.map((s) => ({ id: `u-${s.handle}`, handle: s.handle, tier: 'new' })));

    await waitFor(() => [...arrs.rows.values()].some((r) => r.state === 'proposed'));
    const proposed = [...arrs.rows.values()].filter((r) => r.state === 'proposed');
    expect(proposed).toHaveLength(1);
    const arr = proposed[0]!;
    expect(arr.slots).toHaveLength(3);

    const [edward, kat, dawg] = SEED_USERS.map((s) => [...repo.intents.values()].find((i) => i.public.ownerHandle === s.handle)!);
    const linkWith = (other: StoredIntent) => arr.links.find((l) => [l.a, l.b].includes(edward!.id) && [l.a, l.b].includes(other.id));
    expect(linkWith(dawg!)).toBeDefined();
    expect(linkWith(kat!)).toBeDefined();

    // Edward pays dawg's stated $200 for the 3-day ticket; kat's purchase is left for edward to price.
    await waitFor(() => linkWith(dawg!)?.amountCents === 20000);
    const dawgLink = linkWith(dawg!)!;
    expect(dawgLink.payer).toBe(edward!.id);
    expect(dawgLink.amountCents).toBe(20000);
    const katLink = linkWith(kat!)!;
    expect(katLink.payer).toBe(kat!.id);
    expect(katLink.amountCents).toBeNull();
    expect(katLink.flows).toHaveLength(2);

    // Edward's agent really negotiated with dawg's, and nobody invented a $0 deal.
    const log = await negotiationLog().forIntents([edward!.id], 50);
    expect(log.some((r) => r.from === dawg!.id || r.to === dawg!.id)).toBe(true);
    expect(log.some((r) => r.amountCents === 0)).toBe(false);

    const mine = await service.listMine('u-edward');
    expect(mine).toHaveLength(1);
    const terms = mine[0]!.terms;
    expect(terms.gives.map((g) => g.toHandle)).toEqual(['kat', 'kat']);
    expect(terms.gets.map((g) => g.fromHandle)).toEqual(['dawg']);
    expect(terms.unpriced?.map((u) => u.otherHandle)).toEqual(['kat']);

    // Approval is blocked while the Saturday/Sunday sale has no price, so the deal can't half-complete.
    await expect(service.approve('u-edward', arr.id)).rejects.toThrow(/price/i);
  });
});
