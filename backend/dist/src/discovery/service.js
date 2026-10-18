import { clock } from '../clock.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { nearMissBetween, directlyRelevant } from './match.js';
import { primePairs } from './semantic.js';
import { noticeRepository } from './notices.js';
const COALESCE_MS = 250;
const RECHECK_SIM_MS = 5 * 60 * 1000;
const NEAR_MISS_INTERVAL_SIM_MS = 24 * 60 * 60 * 1000;
let notices = noticeRepository;
export function setNoticeRepository(repository) {
    notices = repository ?? noticeRepository;
}
async function openIntents() {
    return getIntentRepository().listOpen();
}
async function neighborsOf(self) {
    return (await openIntents()).filter((other) => other.id !== self.id && other.ownerId !== self.ownerId);
}
export async function getNeighborhood(intentId) {
    const self = await getIntentRepository().get(intentId);
    if (!self || self.state !== 'open')
        return [];
    return (await neighborsOf(self)).map((other) => other.public);
}
export async function refreshEdges(intentId) {
    const self = await getIntentRepository().get(intentId);
    if (!self || self.state !== 'open')
        return [];
    const [neighbors, existing] = await Promise.all([neighborsOf(self), notices.forObserver(intentId)]);
    const known = new Map(existing.map((n) => [n.intent, n]));
    await primePairs(self.public, neighbors.map((o) => o.public));
    const now = clock.now();
    const writes = [];
    let changed = false;
    for (const other of neighbors) {
        const prior = known.get(other.id);
        if (prior && prior.relevant && prior.version === other.version && prior.observerVersion === self.version)
            continue;
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
        if (edge !== null || prior?.relevant)
            changed = true;
    }
    await notices.upsertMany(writes);
    if (changed)
        events.emit('edges.changed', { intentId });
    return getEdges(intentId);
}
export async function getEdges(intentId) {
    const repo = getIntentRepository();
    const self = await repo.get(intentId);
    if (!self || self.state !== 'open')
        return [];
    const edges = [];
    for (const notice of await notices.forObserver(intentId)) {
        if (!notice.relevant || !notice.edge || notice.observerVersion !== self.version)
            continue;
        const other = await repo.get(notice.intent);
        if (other?.state === 'open' && other.version === notice.edge.otherVersion)
            edges.push(notice.edge);
    }
    return edges;
}
export async function detectNearMisses(intentId) {
    const self = await getIntentRepository().get(intentId);
    if (!self || self.state !== 'open')
        return [];
    const nearest = new Map();
    for (const other of await neighborsOf(self)) {
        for (const miss of nearMissBetween(self.public, other.public)) {
            const best = nearest.get(miss.kind);
            if (!best || miss.gapCents < best.gapCents)
                nearest.set(miss.kind, miss);
        }
    }
    return [...nearest.values()];
}
const delivered = new Map();
// For outbound messaging: at most one per kind per 24 simulated hours unless the gap changed.
export async function deliverableNearMisses(intentId) {
    const now = clock.now();
    const out = [];
    for (const miss of await detectNearMisses(intentId)) {
        const key = `${intentId}:${miss.kind}`;
        const prior = delivered.get(key);
        if (prior && prior.gapCents === miss.gapCents && now - prior.at < NEAR_MISS_INTERVAL_SIM_MS)
            continue;
        delivered.set(key, { at: now, gapCents: miss.gapCents });
        out.push(miss);
    }
    return out;
}
export function resetNearMissDeliveries() {
    delivered.clear();
}
export async function relevantTo(callerId, publicIntentId) {
    const repo = getIntentRepository();
    const target = await repo.get(publicIntentId);
    if (!target || target.state !== 'open' || target.ownerId === callerId)
        return null;
    const mine = (await repo.listMine(callerId)).filter((intent) => intent.state === 'open');
    for (const intent of mine)
        await primePairs(intent.public, [target.public]);
    const hit = mine.find((intent) => directlyRelevant(intent.public, target.public) !== null);
    return hit?.id ?? null;
}
const pending = new Set();
const fanout = new Set();
let flushTimer;
function schedule(intentId) {
    pending.add(intentId);
    if (flushTimer)
        return;
    flushTimer = setTimeout(() => {
        flushTimer = undefined;
        // Neighbors of a newly opened intent are looked up now, not when the event fired, because the intent may not have been readable yet then.
        const opened = [...fanout];
        fanout.clear();
        Promise.all(opened.map((id) => getNeighborhood(id).catch(() => [])))
            .then((lists) => {
            for (const list of lists)
                for (const neighbor of list)
                    pending.add(neighbor.intentId);
        })
            .finally(() => {
            const batch = [...pending];
            pending.clear();
            for (const id of batch) {
                refreshEdges(id).catch((error) => console.error('refreshEdges failed', id, error));
            }
        });
    }, COALESCE_MS);
}
async function onOpened(intentId) {
    fanout.add(intentId);
    schedule(intentId);
}
async function onUpdated(intentId) {
    schedule(intentId);
    for (const notice of await notices.observersOf(intentId))
        schedule(notice.observer);
}
async function onClosed(intentId) {
    pending.delete(intentId);
    const removed = await notices.deleteForIntent(intentId);
    const affected = new Set(removed.filter((n) => n.relevant && n.intent === intentId).map((n) => n.observer));
    for (const observer of affected)
        events.emit('edges.changed', { intentId: observer });
}
function safe(task) {
    task.catch((error) => console.error('discovery handler failed', error));
}
const handleOpened = ({ intentId }) => safe(onOpened(intentId));
// Private-only edits still bump the version, so existing edges and signals must be re-stamped.
const handleUpdated = ({ intentId }) => safe(onUpdated(intentId));
const handleClosed = ({ intentId }) => safe(onClosed(intentId));
let started = false;
let recheckTimer;
export function startDiscovery() {
    if (started)
        return;
    started = true;
    events.on('intent.opened', handleOpened);
    events.on('intent.updated', handleUpdated);
    events.on('intent.closed', handleClosed);
    const recheck = () => {
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
export function stopDiscovery() {
    started = false;
    events.off('intent.opened', handleOpened);
    events.off('intent.updated', handleUpdated);
    events.off('intent.closed', handleClosed);
    if (recheckTimer)
        clock.cancel(recheckTimer);
    if (flushTimer)
        clearTimeout(flushTimer);
    flushTimer = undefined;
    pending.clear();
}
