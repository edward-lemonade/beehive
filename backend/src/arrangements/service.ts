import { randomUUID } from 'node:crypto';
import { clock } from '../clock.js';
import {
  APPROVAL_WINDOW_MS,
  type Arrangement,
  type RelevantEdge,
  type IntentPublic,
  type TermsView,
} from '../contracts/index.js';
import { getEdges } from '../discovery/service.js';
import { findReplacement, type ArrangementDraft } from '../engine/index.js';
import { events } from '../events.js';
import type { StoredIntent } from '../intents/repository.js';
import { getIntentRepository, withdrawIntent } from '../intents/service.js';
import { priceArrangement, repriceLink } from '../negotiation/arrangement.js';
import { ensureAgent } from '../runtime/registry.js';
import { contactsFor } from './contacts.js';
import { arrangementRepo } from './repository.js';
import { netFor, termsHash, termsView } from './terms.js';
import {
  ArrangementError,
  isVacated,
  type StoredArrangement,
  type StoredSlot,
} from './types.js';

export const arrangementSettings = {
  approvalWindowMs: APPROVAL_WINDOW_MS,
  replaceWindowMs: APPROVAL_WINDOW_MS,
  pendingCap: 3,
};

export type VacateReason =
  | 'declined'
  | 'timed_out'
  | 'retracted'
  | 'withdrawn'
  | 'expired'
  | 'version_changed'
  | 'consumed';

const APPROVAL_FOR: Record<VacateReason, StoredSlot['approval']> = {
  declined: 'declined',
  timed_out: 'timed_out',
  retracted: 'retracted',
  withdrawn: 'void',
  expired: 'void',
  version_changed: 'void',
  consumed: 'void',
};

// Declines, timeouts and retractions bar the intent from refilling its own slot.
const BARRED = new Set<VacateReason>(['declined', 'timed_out', 'retracted']);

const log = (error: unknown): void => {
  console.error('[arrangements]', error);
};

// ---- serialization and timers -------------------------------------------------------------

const locks = new Map<string, Promise<unknown>>();
const promoteQueue = new Set<string>();

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return run;
}

async function locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withLock(id, fn);
  } finally {
    await flushPromotions();
  }
}

const timers = new Map<string, ReturnType<typeof clock.after>>();

function setTimer(key: string, simMs: number, fn: () => Promise<void>): void {
  clearTimer(key);
  timers.set(key, clock.after(Math.max(0, simMs), () => {
    timers.delete(key);
    fn().catch(log);
  }));
}

function clearTimer(key: string): void {
  const timer = timers.get(key);
  if (timer !== undefined) clock.cancel(timer);
  timers.delete(key);
}

function clearArrangementTimers(arrangementId: string): void {
  for (const key of [...timers.keys()]) if (key.startsWith(`${arrangementId}|`)) clearTimer(key);
}

export function stopArrangementTimers(): void {
  for (const key of [...timers.keys()]) clearTimer(key);
}

// ---- helpers ---------------------------------------------------------------------------------

const toContract = (arr: StoredArrangement): Arrangement => ({
  id: arr.id,
  key: arr.key,
  state: arr.state,
  revision: arr.revision,
  slots: arr.slots.map((s) => ({ intentId: s.intentId, intentVersion: s.intentVersion, approval: s.approval })),
  links: arr.links,
});

async function loadIntents(arr: StoredArrangement): Promise<Map<string, StoredIntent>> {
  const repo = getIntentRepository();
  const out = new Map<string, StoredIntent>();
  for (const slot of arr.slots) {
    const intent = await repo.get(slot.intentId);
    if (intent) out.set(intent.id, intent);
  }
  return out;
}

const expiresAt = (slot: StoredSlot): number | null =>
  slot.approval === 'requested' && slot.requestedAt !== null ? slot.requestedAt + arrangementSettings.approvalWindowMs : null;

async function viewFor(arr: StoredArrangement, slot: StoredSlot, intents?: Map<string, StoredIntent>): Promise<TermsView> {
  return termsView(arr, slot, intents ?? (await loadIntents(arr)), expiresAt(slot));
}

const notify = (userId: string, kind: string, payload: Record<string, unknown>): void => {
  events.emit('notify', { userId, kind, payload });
};

async function persist(arr: StoredArrangement): Promise<boolean> {
  arr.updatedAt = clock.now();
  return (await arrangementRepo().save(arr)) === 'ok';
}

// ---- approval requests ---------------------------------------------------------------------

// Moves `queued` slots to `requested` while the user is under the pending cap.
async function assignRequests(arr: StoredArrangement): Promise<StoredSlot[]> {
  const repo = arrangementRepo();
  const counts = new Map<string, number>();
  const opened: StoredSlot[] = [];
  for (const slot of arr.slots) {
    if (slot.approval !== 'queued') continue;
    const count = counts.get(slot.userId) ?? (await repo.countRequested(slot.userId));
    counts.set(slot.userId, count);
    if (count >= arrangementSettings.pendingCap) continue;
    counts.set(slot.userId, count + 1);
    slot.approval = 'requested';
    slot.requestedAt = clock.now();
    opened.push(slot);
  }
  return opened;
}

function armApprovalTimer(arrangementId: string, slot: StoredSlot): void {
  const requestedAt = slot.requestedAt ?? clock.now();
  const remaining = requestedAt + arrangementSettings.approvalWindowMs - clock.now();
  setTimer(`${arrangementId}|${slot.intentId}`, remaining, () =>
    locked(arrangementId, () => timeoutLocked(arrangementId, slot.intentId, requestedAt)));
}

async function dispatchRequests(arr: StoredArrangement, opened: StoredSlot[]): Promise<void> {
  if (opened.length === 0) return;
  const intents = await loadIntents(arr);
  for (const slot of opened) {
    armApprovalTimer(arr.id, slot);
    if (!intents.has(slot.intentId)) continue;
    notify(slot.userId, 'approval_request', {
      arrangementId: arr.id,
      revision: arr.revision,
      terms: await viewFor(arr, slot, intents),
    });
  }
}

async function promoteFor(userIds: string[]): Promise<void> {
  const repo = arrangementRepo();
  for (const userId of new Set(userIds)) {
    for (;;) {
      if ((await repo.countRequested(userId)) >= arrangementSettings.pendingCap) break;
      const waiting = (await repo.listForUser(userId))
        .filter((a) => a.state === 'proposed' && a.slots.some((s) => s.userId === userId && s.approval === 'queued'))
        .sort((x, y) => x.createdAt - y.createdAt)[0];
      if (!waiting) break;
      const promoted = await withLock(waiting.id, async () => {
        const arr = await repo.get(waiting.id);
        if (!arr || arr.state !== 'proposed') return false;
        const slot = arr.slots.find((s) => s.userId === userId && s.approval === 'queued');
        if (!slot) return false;
        const opened = await assignRequests(arr);
        if (opened.length === 0 || !(await persist(arr))) return false;
        await dispatchRequests(arr, opened);
        return true;
      });
      if (!promoted) break;
    }
  }
}

async function flushPromotions(): Promise<void> {
  if (promoteQueue.size === 0) return;
  const users = [...promoteQueue];
  promoteQueue.clear();
  await promoteFor(users);
}

// ---- propose (called by the coordinator) ---------------------------------------------------

async function dropLocked(arr: StoredArrangement, reason: string): Promise<void> {
  clearArrangementTimers(arr.id);
  arr.state = 'dropped';
  arr.reason = reason;
  await persist(arr);
}

export async function proposeDraft(
  draft: ArrangementDraft,
  stored: Map<string, StoredIntent>,
): Promise<StoredArrangement | null> {
  const repo = arrangementRepo();
  if (await repo.findByKey(draft.key)) return null;
  const owners = draft.slots.map((s) => stored.get(s.intentId)?.ownerId);
  if (owners.some((o) => !o)) return null;
  for (const owner of new Set(owners as string[])) if (await repo.isDeclined(owner, draft.key)) return null;

  const now = clock.now();
  const arr: StoredArrangement = {
    id: randomUUID(),
    key: draft.key,
    state: 'candidate',
    revision: 0,
    reason: null,
    excluded: [],
    declaredNet: draft.declaredNet,
    replaceDeadline: null,
    createdAt: now,
    updatedAt: now,
    slots: draft.slots.map((s) => ({
      intentId: s.intentId,
      userId: stored.get(s.intentId)!.ownerId,
      intentVersion: s.intentVersion,
      approval: 'queued' as const,
      termsHash: null,
      approvedNetCents: null,
      requestedAt: null,
      decidedAt: null,
    })),
    links: draft.links,
  };

  return locked(arr.id, async () => {
    if ((await repo.save(arr)) !== 'ok') return null;
    events.emit('arrangement.candidate', { arrangementId: arr.id });

    const priced = await priceArrangement({ id: arr.id, slots: toContract(arr).slots, links: arr.links });
    if (priced.state !== 'agreed') {
      await dropLocked(arr, priced.reason ?? 'pricing_failed');
      return null;
    }
    arr.links = priced.links;

    for (const slot of arr.slots) {
      const mine = arr.links.filter((l) => l.a === slot.intentId || l.b === slot.intentId);
      const check = await ensureAgent(slot.intentId).precheck({
        intentVersion: slot.intentVersion,
        netCents: netFor(arr, slot.intentId),
        give: mine.flatMap((l) => l.flows.filter((f) => f.from === slot.intentId).map((f) => f.item)),
        receive: mine.flatMap((l) => l.flows.filter((f) => f.to === slot.intentId).map((f) => f.item)),
      });
      if (!check.ok) {
        await dropLocked(arr, `precheck: ${check.reason}`);
        return null;
      }
    }

    arr.state = 'proposed';
    arr.revision = 1;
    const opened = await assignRequests(arr);
    if (!(await persist(arr))) return null;
    events.emit('arrangement.proposed', { arrangementId: arr.id });
    await dispatchRequests(arr, opened);
    return arr;
  });
}

// ---- vacate, replace, dissolve --------------------------------------------------------------

async function vacateLocked(arr: StoredArrangement, intentId: string, reason: VacateReason): Promise<void> {
  if (arr.state !== 'proposed') return;
  const slot = arr.slots.find((s) => s.intentId === intentId);
  if (!slot || isVacated(slot)) return;

  slot.approval = APPROVAL_FOR[reason];
  arr.proposal = null;
  slot.decidedAt = clock.now();
  clearTimer(`${arr.id}|${intentId}`);
  if (BARRED.has(reason) && !arr.excluded.includes(intentId)) arr.excluded.push(intentId);
  if (!(await persist(arr))) return;
  events.emit('slot.vacated', { arrangementId: arr.id, intentId });
  promoteQueue.add(slot.userId);
  await tryReplaceLocked(arr);
}

export function vacateSlot(arrangementId: string, intentId: string, reason: VacateReason): Promise<void> {
  return locked(arrangementId, async () => {
    const arr = await arrangementRepo().get(arrangementId);
    if (arr) await vacateLocked(arr, intentId, reason);
  });
}

async function dissolveLocked(arr: StoredArrangement, reason: string): Promise<void> {
  if (arr.state === 'dissolved' || arr.state === 'committed') return;
  clearArrangementTimers(arr.id);
  arr.state = 'dissolved';
  arr.reason = reason;
  if (!(await persist(arr))) return;
  for (const slot of arr.slots) {
    promoteQueue.add(slot.userId);
    if (slot.approval === 'approved') notify(slot.userId, 'dissolved', { arrangementId: arr.id, reason });
  }
  events.emit('arrangement.dissolved', { arrangementId: arr.id, reason });
}

async function armVacancy(arr: StoredArrangement): Promise<void> {
  const now = clock.now();
  if (arr.replaceDeadline === null) {
    arr.replaceDeadline = now + arrangementSettings.replaceWindowMs;
    if (!(await persist(arr))) return;
  }
  if (arr.replaceDeadline <= now) {
    await dissolveLocked(arr, 'no_replacement');
    return;
  }
  setTimer(`${arr.id}|dissolve`, arr.replaceDeadline - now, () =>
    locked(arr.id, async () => {
      const current = await arrangementRepo().get(arr.id);
      if (!current || current.state !== 'proposed' || !current.slots.some(isVacated)) return;
      if (current.replaceDeadline !== null && current.replaceDeadline <= clock.now()) {
        await dissolveLocked(current, 'no_replacement');
      }
    }));
}

async function tryReplaceLocked(arr: StoredArrangement): Promise<void> {
  if (arr.state !== 'proposed') return;
  const vacated = arr.slots.filter(isVacated);
  if (vacated.length === 0) return;
  if (vacated.length === 1 && (await applyReplacement(arr, vacated[0]!))) return;
  await armVacancy(arr);
}

async function applyReplacement(arr: StoredArrangement, vacated: StoredSlot): Promise<boolean> {
  const repo = getIntentRepository();
  const memberIds = new Set(arr.slots.map((s) => s.intentId));
  const stored = await loadIntents(arr);
  const exclude = new Set(arr.excluded);
  const neighbors = new Set(
    arr.links.filter((l) => l.a === vacated.intentId || l.b === vacated.intentId)
      .map((l) => (l.a === vacated.intentId ? l.b : l.a)),
  );

  const edges = new Map<string, RelevantEdge[]>();
  const candidates = new Set<string>();
  for (const neighbor of neighbors) {
    for (const edge of await getEdges(neighbor)) {
      if (edge.self === neighbor && !memberIds.has(edge.other) && !exclude.has(edge.other)) candidates.add(edge.other);
    }
  }
  for (const id of candidates) {
    const intent = await repo.get(id);
    if (!intent || intent.state !== 'open') {
      candidates.delete(id);
      continue;
    }
    stored.set(id, intent);
    edges.set(id, await getEdges(id));
  }
  const publics = new Map<string, IntentPublic>([...stored].map(([id, i]) => [id, i.public] as const));

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const draft = findReplacement(toContract(arr), vacated.intentId, [...candidates], publics, edges, exclude);
    if (!draft) return false;
    const candidateId = draft.slots.map((s) => s.intentId).find((id) => !memberIds.has(id))!;
    const candidate = stored.get(candidateId)!;

    // Neighbors keep the old amounts; the replacement must accept them.
    const links = draft.links.map((link, i) => ({
      ...link,
      amountCents: arr.links[i]!.amountCents,
      state: arr.links[i]!.state,
    }));
    const next: StoredArrangement = {
      ...arr,
      key: draft.key,
      revision: arr.revision + 1,
      replaceDeadline: null,
      declaredNet: draft.declaredNet,
      links,
      slots: draft.slots.map((ds) => {
        const existing = arr.slots.find((s) => s.intentId === ds.intentId);
        return existing
          ? { ...existing }
          : {
              intentId: ds.intentId,
              userId: candidate.ownerId,
              intentVersion: ds.intentVersion,
              approval: 'queued' as const,
              termsHash: null,
              approvedNetCents: null,
              requestedAt: null,
              decidedAt: null,
                    };
      }),
    };

    const mine = links.filter((l) => l.a === candidateId || l.b === candidateId);
    const check = await ensureAgent(candidateId).precheck({
      intentVersion: candidate.version,
      netCents: netFor(next, candidateId),
      give: mine.flatMap((l) => l.flows.filter((f) => f.from === candidateId).map((f) => f.item)),
      receive: mine.flatMap((l) => l.flows.filter((f) => f.to === candidateId).map((f) => f.item)),
    });
    if (!check.ok || (await arrangementRepo().isDeclined(candidate.ownerId, draft.key))) {
      exclude.add(candidateId);
      continue;
    }

    carryApprovals(next);
    const opened = await assignRequests(next);
    const saved = await arrangementRepo().save({ ...next, updatedAt: clock.now() });
    if (saved === 'key') {
      await dissolveLocked(arr, 'duplicate');
      return true;
    }
    if (saved === 'stale') return true;
    Object.assign(arr, next);
    clearTimer(`${arr.id}|dissolve`);
    await dispatchRequests(arr, opened);
    return true;
  }
  return false;
}

// An approval survives a revision only if the items match and the net is not worse.
function carryApprovals(arr: StoredArrangement): void {
  for (const slot of arr.slots) {
    if (slot.approval !== 'approved') continue;
    const same = slot.termsHash === termsHash(arr, slot.intentId);
    const notWorse = (slot.approvedNetCents ?? 0) <= netFor(arr, slot.intentId);
    if (!same || !notWorse) {
      slot.approval = 'queued';
      slot.termsHash = null;
      slot.approvedNetCents = null;
    }
  }
}

export async function retryVacancies(): Promise<void> {
  const repo = arrangementRepo();
  for (const arr of await repo.listActive()) {
    if (arr.state !== 'proposed' || !arr.slots.some(isVacated)) continue;
    await locked(arr.id, async () => {
      const fresh = await repo.get(arr.id);
      if (fresh) await tryReplaceLocked(fresh);
    });
  }
}

// ---- approvals ----------------------------------------------------------------------------

async function timeoutLocked(arrangementId: string, intentId: string, requestedAt: number): Promise<void> {
  const arr = await arrangementRepo().get(arrangementId);
  const slot = arr?.slots.find((s) => s.intentId === intentId);
  if (!arr || !slot || arr.state !== 'proposed') return;
  if (slot.approval !== 'requested' || slot.requestedAt !== requestedAt) return;
  await arrangementRepo().addDecline(slot.userId, arr.key, clock.now());
  await vacateLocked(arr, intentId, 'timed_out');
}

async function participantContext(userId: string, arrangementId: string): Promise<{ arr: StoredArrangement; slot: StoredSlot }> {
  const arr = await arrangementRepo().get(arrangementId);
  const slot = arr?.slots.find((s) => s.userId === userId);
  // Unknown ids and non-participants look the same so existence is not leaked.
  if (!arr || !slot) throw new ArrangementError('Arrangement not found', 404);
  return { arr, slot };
}

const notProposed = (): ArrangementError => new ArrangementError('Arrangement is no longer open for approval', 409);

export function approve(userId: string, arrangementId: string): Promise<void> {
  return locked(arrangementId, async () => {
    const { arr, slot } = await participantContext(userId, arrangementId);
    if (arr.state !== 'proposed') throw notProposed();
    // A standing proposal from the other side is what a yes refers to: accepting it changes the price.
    if (arr.proposal && arr.proposal.fromIntentId !== slot.intentId) return acceptProposalLocked(arr, slot);
    await approveSlotLocked(arr, slot);
  });
}

async function approveSlotLocked(arr: StoredArrangement, slot: StoredSlot): Promise<void> {
  {
    const userId = slot.userId;
    if (slot.approval === 'approved') return;
    if (slot.approval === 'queued') throw new ArrangementError('This arrangement is waiting for your other pending approvals', 409);
    if (slot.approval !== 'requested') throw notProposed();

    const mine = arr.links.filter((l) => l.a === slot.intentId || l.b === slot.intentId);
    const check = await ensureAgent(slot.intentId).precheck({
      intentVersion: slot.intentVersion,
      netCents: netFor(arr, slot.intentId),
      give: mine.flatMap((l) => l.flows.filter((f) => f.from === slot.intentId).map((f) => f.item)),
      receive: mine.flatMap((l) => l.flows.filter((f) => f.to === slot.intentId).map((f) => f.item)),
    });
    if (!check.ok) {
      const intent = await getIntentRepository().get(slot.intentId);
      await vacateLocked(arr, slot.intentId, intent?.state === 'open' ? 'version_changed' : 'withdrawn');
      throw new ArrangementError(check.reason, 409);
    }

    slot.approval = 'approved';
    slot.termsHash = termsHash(arr, slot.intentId);
    slot.approvedNetCents = netFor(arr, slot.intentId);
    slot.decidedAt = clock.now();
    clearTimer(`${arr.id}|${slot.intentId}`);
    if (!(await persist(arr))) throw notProposed();
    promoteQueue.add(userId);
    if (arr.slots.every((s) => s.approval === 'approved')) await commitLocked(arr);
  }
}

// The proposer implicitly approves their own price; the accepter's yes completes it. Nobody is left waiting.
async function acceptProposalLocked(arr: StoredArrangement, accepter: StoredSlot): Promise<void> {
  const proposal = arr.proposal!;
  const link = arr.links.find((l) => l.id === proposal.linkId);
  arr.proposal = null;
  if (!link) {
    await persist(arr);
    return;
  }
  arr.links = arr.links.map((l) => (l.id === link.id ? { ...l, amountCents: proposal.amountCents, state: 'agreed' as const } : l));
  arr.revision += 1;
  carryApprovals(arr);
  const proposer = arr.slots.find((s) => s.intentId === proposal.fromIntentId);
  const opened = await assignRequests(arr);
  for (const s of [proposer, accepter]) if (s && (s.approval === 'queued' || s.approval === 'approved')) s.approval = 'requested';
  if (!(await persist(arr))) throw notProposed();
  await dispatchRequests(arr, opened.filter((s) => s.intentId !== accepter.intentId && s.intentId !== proposal.fromIntentId));
  if (proposer) await approveSlotLocked(arr, proposer).catch(() => undefined);
  const fresh = (await arrangementRepo().get(arr.id)) ?? arr;
  const again = fresh.slots.find((s) => s.intentId === accepter.intentId);
  if (fresh.state === 'proposed' && again) await approveSlotLocked(fresh, again);
}

export function decline(userId: string, arrangementId: string, opts: { dropDeal?: boolean } = {}): Promise<void> {
  return locked(arrangementId, async () => {
    const { arr, slot } = await participantContext(userId, arrangementId);
    if (arr.state !== 'proposed') throw notProposed();
    // Saying no to someone's counter-price turns down that price only; the deal at its current price stays.
    if (arr.proposal && arr.proposal.fromIntentId !== slot.intentId && !opts.dropDeal) {
      arr.proposal = null;
      if (!(await persist(arr))) throw notProposed();
      return;
    }
    if (slot.approval !== 'requested' && slot.approval !== 'queued') throw notProposed();
    await arrangementRepo().addDecline(userId, arr.key, clock.now());
    await vacateLocked(arr, slot.intentId, 'declined');
  });
}

export function retract(userId: string, arrangementId: string): Promise<void> {
  return locked(arrangementId, async () => {
    const { arr, slot } = await participantContext(userId, arrangementId);
    if (arr.state !== 'proposed') throw notProposed();
    if (slot.approval !== 'approved') throw new ArrangementError('Only an approved arrangement can be retracted', 409);
    await arrangementRepo().addDecline(userId, arr.key, clock.now());
    await vacateLocked(arr, slot.intentId, 'retracted');
  });
}

export async function declineAndWithdraw(userId: string, arrangementId: string): Promise<void> {
  let intentId = '';
  await locked(arrangementId, async () => {
    const { arr, slot } = await participantContext(userId, arrangementId);
    if (arr.state !== 'proposed') throw notProposed();
    if (slot.approval !== 'requested' && slot.approval !== 'queued') throw notProposed();
    intentId = slot.intentId;
    await arrangementRepo().addDecline(userId, arr.key, clock.now());
    await vacateLocked(arr, slot.intentId, 'declined');
  });
  await withdrawIntent(intentId, userId);
}

export type FurtherResult =
  | { status: 'agreed'; terms: TermsView }
  | { status: 'pending'; amountCents: number }
  | { status: 'failed'; reason: string };

export function negotiateFurther(
  userId: string,
  arrangementId: string,
  input: { targetCents?: number; linkId?: string },
): Promise<FurtherResult> {
  return locked(arrangementId, async (): Promise<FurtherResult> => {
    const { arr, slot } = await participantContext(userId, arrangementId);
    if (arr.state !== 'proposed') throw notProposed();
    // A user who already approved may still counter: a changed price clears their approval so they re-approve the new terms.
    if (slot.approval !== 'requested' && slot.approval !== 'approved') throw new ArrangementError('Only an open request can be renegotiated', 409);

    const cashLinks = arr.links.filter((l) => l.payer && (l.a === slot.intentId || l.b === slot.intentId));
    const link = input.linkId ? cashLinks.find((l) => l.id === input.linkId) : cashLinks.length === 1 ? cashLinks[0] : undefined;
    if (!link) throw new ArrangementError('Choose which cash link to renegotiate', 400);

    const side = link.payer === slot.intentId ? 'payer' : 'receiver';
    const open = arr.proposal;
    if (open && open.linkId === link.id && input.targetCents !== undefined) {
      // Naming the price already on the table is a yes (theirs) or a repeat (mine); neither starts a new round.
      if (open.amountCents === input.targetCents) {
        if (open.fromIntentId !== slot.intentId) {
          await acceptProposalLocked(arr, slot);
          const done = (await arrangementRepo().get(arr.id)) ?? arr;
          return { status: 'agreed', terms: await viewFor(done, done.slots.find((s) => s.intentId === slot.intentId) ?? slot) };
        }
        return { status: 'pending', amountCents: open.amountCents };
      }
    }
    const result = await repriceLink(toContract(arr), link.id, { side, ...(input.targetCents !== undefined ? { cents: input.targetCents } : {}) }, `r${arr.revision}`);
    if (result.state === 'pending') {
      // Remember the price on the table so the other user's yes, no or counter has something concrete to answer.
      arr.proposal = { linkId: link.id, amountCents: result.amountCents, fromIntentId: slot.intentId };
      if (!(await persist(arr))) throw notProposed();
      return { status: 'pending', amountCents: result.amountCents };
    }
    arr.proposal = null;
    if (result.state !== 'agreed') return { status: 'failed', reason: result.reason };

    arr.links = arr.links.map((l) => (l.id === link.id ? { ...l, amountCents: result.amountCents, state: 'agreed' as const } : l));
    arr.revision += 1;
    carryApprovals(arr);
    const opened = await assignRequests(arr);
    if (!(await persist(arr))) throw notProposed();
    await dispatchRequests(arr, opened.filter((s) => s.intentId !== slot.intentId));
    return { status: 'agreed', terms: await viewFor(arr, slot) };
  });
}

// ---- commit -------------------------------------------------------------------------------

async function commitLocked(arr: StoredArrangement): Promise<void> {
  const repo = arrangementRepo();
  const result = await repo.commit({ arrangementId: arr.id, expectedRevision: arr.revision, now: clock.now() });
  if (!result.ok) {
    if (result.reason === 'intent' && result.intentId) {
      const intent = await getIntentRepository().get(result.intentId);
      const fresh = await repo.get(arr.id);
      if (fresh) await vacateLocked(fresh, result.intentId, intent?.state === 'open' ? 'version_changed' : 'withdrawn');
    }
    return;
  }

  const committed = result.arrangement;
  clearArrangementTimers(committed.id);
  const intents = await loadIntents(committed);
  const contacts = await contactsFor(committed.slots.map((s) => s.userId));
  const contactOf = (userId: string): string | null => contacts.get(userId) ?? null;

  for (const slot of committed.slots) {
    const counterparties = new Map<string, { handle: string; phone: string | null }>();
    for (const link of committed.links) {
      if (link.a !== slot.intentId && link.b !== slot.intentId) continue;
      const other = committed.slots.find((s) => s.intentId === (link.a === slot.intentId ? link.b : link.a));
      if (!other) continue;
      counterparties.set(other.intentId, {
        handle: intents.get(other.intentId)?.public.ownerHandle ?? 'unknown',
        phone: contactOf(other.userId),
      });
    }
    notify(slot.userId, 'committed', {
      arrangementId: committed.id,
      contacts: [...counterparties.values()],
    });
  }
  events.emit('arrangement.committed', { arrangementId: committed.id });
  for (const slot of committed.slots) events.emit('intent.closed', { intentId: slot.intentId });

  for (const gone of result.consumed) {
    clearArrangementTimers(gone.arrangementId);
    for (const userId of new Set(gone.approvedUserIds)) {
      notify(userId, 'dissolved', { arrangementId: gone.arrangementId, reason: 'consumed' });
    }
    events.emit('arrangement.dissolved', { arrangementId: gone.arrangementId, reason: 'consumed' });
  }
  for (const slot of committed.slots) promoteQueue.add(slot.userId);
}

// ---- reads --------------------------------------------------------------------------------

export type Counterparty = { handle: string; phone: string | null };
export type MineEntry = { terms: TermsView; contacts: Counterparty[] | null };

async function counterpartiesOf(arr: StoredArrangement, slot: StoredSlot, intents: Map<string, StoredIntent>): Promise<Counterparty[]> {
  const others = new Map<string, StoredSlot>();
  for (const link of arr.links) {
    if (link.a !== slot.intentId && link.b !== slot.intentId) continue;
    const other = arr.slots.find((s) => s.intentId === (link.a === slot.intentId ? link.b : link.a));
    if (other) others.set(other.intentId, other);
  }
  const phones = await contactsFor([...others.values()].map((s) => s.userId));
  return [...others.values()].map((s) => ({
    handle: intents.get(s.intentId)?.public.ownerHandle ?? 'unknown',
    phone: phones.get(s.userId) ?? null,
  }));
}

export async function listMine(userId: string): Promise<MineEntry[]> {
  const out: MineEntry[] = [];
  for (const arr of await arrangementRepo().listForUser(userId)) {
    const intents = await loadIntents(arr);
    for (const slot of arr.slots.filter((s) => s.userId === userId && intents.has(s.intentId))) {
      const terms = await viewFor(arr, slot, intents);
      out.push({ terms, contacts: arr.state === 'committed' ? await counterpartiesOf(arr, slot, intents) : null });
    }
  }
  return out;
}

// ---- lifecycle events ---------------------------------------------------------------------

export async function onIntentClosed(intentId: string): Promise<void> {
  for (const arr of await arrangementRepo().activeForIntent(intentId)) {
    await vacateSlot(arr.id, intentId, 'withdrawn');
  }
}

export async function onIntentUpdated(intentId: string): Promise<void> {
  const intent = await getIntentRepository().get(intentId);
  if (!intent) return;
  for (const arr of await arrangementRepo().activeForIntent(intentId)) {
    const slot = arr.slots.find((s) => s.intentId === intentId);
    if (slot && slot.intentVersion !== intent.version) await vacateSlot(arr.id, intentId, 'version_changed');
  }
}

export async function rehydrateArrangements(): Promise<number> {
  const active = await arrangementRepo().listActive();
  for (const arr of active) {
    await locked(arr.id, async () => {
      const fresh = await arrangementRepo().get(arr.id);
      if (!fresh) return;
      if (fresh.state === 'candidate') {
        await dissolveLocked(fresh, 'restart');
        return;
      }
      for (const slot of fresh.slots) if (slot.approval === 'requested') armApprovalTimer(fresh.id, slot);
      await tryReplaceLocked(fresh);
    });
  }
  return active.length;
}

export const isActiveIntentInArrangement = async (intentId: string): Promise<boolean> =>
  (await arrangementRepo().activeForIntent(intentId)).length > 0;
