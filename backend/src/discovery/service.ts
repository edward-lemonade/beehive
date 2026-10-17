import { clock } from '../clock.js';
import type { IntentPublic, NearMiss, RelevantEdge } from '../contracts/index.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import type { StoredIntent } from '../intents/repository.js';
import { nearMissBetween, directlyRelevant } from './match.js';
import { noticeRepository, type Notice, type NoticeRepository } from './notices.js';

const COALESCE_MS = 250;
const RECHECK_SIM_MS = 5 * 60 * 1000;
const NEAR_MISS_INTERVAL_SIM_MS = 24 * 60 * 60 * 1000;

let notices: NoticeRepository = noticeRepository;

export function setNoticeRepository(repository?: NoticeRepository): void {
  notices = repository ?? noticeRepository;
}

async function openIntents(): Promise<StoredIntent[]> {
  return getIntentRepository().listOpen();
}

async function neighborsOf(self: StoredIntent): Promise<StoredIntent[]> {
  return (await openIntents()).filter((other) => other.id !== self.id && other.ownerId !== self.ownerId);
}

export async function getNeighborhood(intentId: string): Promise<IntentPublic[]> {
  const self = await getIntentRepository().get(intentId);
  if (!self || self.state !== 'open') return [];
  return (await neighborsOf(self)).map((other) => other.public);
}

export async function refreshEdges(intentId: string): Promise<RelevantEdge[]> {
  const self = await getIntentRepository().get(intentId);
  if (!self || self.state !== 'open') return [];

  const [neighbors, existing] = await Promise.all([neighborsOf(self), notices.forObserver(intentId)]);
  const known = new Map(existing.map((n) => [n.intent, n]));
  const now = clock.now();
  const writes: Notice[] = [];
  let changed = false;

  for (const other of neighbors) {
    const prior = known.get(other.id);
    if (prior && prior.version === other.version && prior.observerVersion === self.version) continue;
    const edge = directlyRelevant(self.public, other.public);
    writes.push({
      observer: self.id,
      intent: other.id,
      observerVersion: self.version,
      version: other.version,
      relevant: edge !== null,
      edge,
      updatedAt: now,
    });
    if (edge !== null || prior?.relevant) changed = true;
  }

  await notices.upsertMany(writes);
  if (changed) events.emit('edges.changed', { intentId });
  return getEdges(intentId);
}

export async function getEdges(intentId: string): Promise<RelevantEdge[]> {
  const repo = getIntentRepository();
  const self = await repo.get(intentId);
  if (!self || self.state !== 'open') return [];
  const edges: RelevantEdge[] = [];
  for (const notice of await notices.forObserver(intentId)) {
    if (!notice.relevant || !notice.edge || notice.observerVersion !== self.version) continue;
    const other = await repo.get(notice.intent);
    if (other?.state === 'open' && other.version === notice.edge.otherVersion) edges.push(notice.edge);
  }
  return edges;
}

export async function detectNearMisses(intentId: string): Promise<NearMiss[]> {
  const self = await getIntentRepository().get(intentId);
  if (!self || self.state !== 'open') return [];
  const nearest = new Map<NearMiss['kind'], NearMiss>();
  for (const other of await neighborsOf(self)) {
    for (const miss of nearMissBetween(self.public, other.public)) {
      const best = nearest.get(miss.kind);
      if (!best || miss.gapCents < best.gapCents) nearest.set(miss.kind, miss);
    }
  }
  return [...nearest.values()];
}

const delivered = new Map<string, { at: number; gapCents: number }>();

// For outbound messaging: at most one per kind per 24 simulated hours unless the gap changed.
export async function deliverableNearMisses(intentId: string): Promise<NearMiss[]> {
  const now = clock.now();
  const out: NearMiss[] = [];
  for (const miss of await detectNearMisses(intentId)) {
    const key = `${intentId}:${miss.kind}`;
    const prior = delivered.get(key);
    if (prior && prior.gapCents === miss.gapCents && now - prior.at < NEAR_MISS_INTERVAL_SIM_MS) continue;
    delivered.set(key, { at: now, gapCents: miss.gapCents });
    out.push(miss);
  }
  return out;
}

export function resetNearMissDeliveries(): void {
  delivered.clear();
}

export async function relevantTo(callerId: string, publicIntentId: string): Promise<string | null> {
  const repo = getIntentRepository();
  const target = await repo.get(publicIntentId);
  if (!target || target.state !== 'open' || target.ownerId === callerId) return null;
  const mine = (await repo.listMine(callerId)).filter((intent) => intent.state === 'open');
  const hit = mine.find((intent) => directlyRelevant(intent.public, target.public) !== null);
  return hit?.id ?? null;
}

const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function schedule(intentId: string): void {
  pending.add(intentId);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    const batch = [...pending];
    pending.clear();
    for (const id of batch) {
      refreshEdges(id).catch((error) => console.error('refreshEdges failed', id, error));
    }
  }, COALESCE_MS);
}

async function onOpened(intentId: string): Promise<void> {
  schedule(intentId);
  for (const neighbor of await getNeighborhood(intentId)) schedule(neighbor.intentId);
}

async function onUpdated(intentId: string): Promise<void> {
  schedule(intentId);
  for (const notice of await notices.observersOf(intentId)) schedule(notice.observer);
}

async function onClosed(intentId: string): Promise<void> {
  pending.delete(intentId);
  const removed = await notices.deleteForIntent(intentId);
  const affected = new Set(
    removed.filter((n) => n.relevant && n.intent === intentId).map((n) => n.observer),
  );
  for (const observer of affected) events.emit('edges.changed', { intentId: observer });
}

function safe(task: Promise<void>): void {
  task.catch((error) => console.error('discovery handler failed', error));
}

const handleOpened = ({ intentId }: { intentId: string }): void => safe(onOpened(intentId));
// Private-only edits still bump the version, so existing edges and signals must be re-stamped.
const handleUpdated = ({ intentId }: { intentId: string }): void => safe(onUpdated(intentId));
const handleClosed = ({ intentId }: { intentId: string }): void => safe(onClosed(intentId));

let started = false;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;

export function startDiscovery(): void {
  if (started) return;
  started = true;
  events.on('intent.opened', handleOpened);
  events.on('intent.updated', handleUpdated);
  events.on('intent.closed', handleClosed);

  const recheck = (): void => {
    openIntents()
      .then((all) => all.forEach((intent) => schedule(intent.id)))
      .catch((error) => console.error('discovery recheck failed', error))
      .finally(() => {
        recheckTimer = clock.after(RECHECK_SIM_MS, recheck);
        recheckTimer.unref?.();
      });
  };
  recheckTimer = clock.after(RECHECK_SIM_MS, recheck);
  recheckTimer.unref?.();
}

export function stopDiscovery(): void {
  started = false;
  events.off('intent.opened', handleOpened);
  events.off('intent.updated', handleUpdated);
  events.off('intent.closed', handleClosed);
  if (recheckTimer) clock.cancel(recheckTimer);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  pending.clear();
}
