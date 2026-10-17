import { clock } from '../clock.js';
import { config } from '../config.js';
import type { Envelope, Item, Signal } from '../contracts/index.js';
import { detectNearMisses, getEdges } from '../discovery/service.js';
import { itemMatch } from '../discovery/match.js';
import { candidatesBySlot, localStatus } from '../engine/index.js';
import { events } from '../events.js';
import type { StoredIntent } from '../intents/repository.js';
import { getIntentRepository } from '../intents/service.js';
import { bus, makeEnvelope } from './bus.js';
import { hooks } from './hooks.js';
import { signalRepo, type StoredSignal } from './signals.js';

export type WakeReason = 'opened' | 'edges' | 'signal' | 'updated' | 'periodic' | 'keep' | 'boot' | 'closed';

export type PrecheckTerms = {
  intentVersion: number;
  netCents: number | null;
  give: Item[];
  receive: Item[];
  at?: number;
};

export type PrecheckResult = { ok: true } | { ok: false; reason: string };

export class Agent {
  dormant = false;
  private notifiedVersion = -1;

  constructor(
    readonly intentId: string,
    private readonly requestWake: (reason: WakeReason) => void,
  ) {}

  // Returns { closed: true } when the intent is no longer Open and the agent should be destroyed.
  async wake(reason: WakeReason): Promise<{ closed: boolean }> {
    this.dormant = false;
    const self = await getIntentRepository().get(this.intentId);
    if (!self || self.state !== 'open') {
      await this.retract();
      return { closed: true };
    }

    const edges = await getEdges(self.id);
    const store = signalRepo();
    const [incomingRows, sentRows] = await Promise.all([store.to(self.id), store.from(self.id)]);
    const rowsByFrom = new Map(incomingRows.map((row) => [row.from, row]));

    // Absent or stale signals are assumed true so chains and cycles settle on the greatest fixed point.
    const incoming: Signal[] = edges.map((edge) => {
      const row = rowsByFrom.get(edge.other);
      const current = row !== undefined && row.fromVersion === edge.otherVersion && row.toVersion === self.version;
      return {
        from: edge.other,
        to: self.id,
        fromVersion: edge.otherVersion,
        toVersion: self.version,
        satisfiable: current ? row.satisfiable : true,
      };
    });
    const status = localStatus(self.public, edges, incoming);

    const sentBy = new Map(sentRows.map((row) => [row.to, row]));
    const neighbors = new Set<string>();
    let changed = false;

    for (const edge of edges) {
      neighbors.add(edge.other);
      const last = sentBy.get(edge.other);
      if (
        last
        && last.fromVersion === self.version
        && last.toVersion === edge.otherVersion
        && last.satisfiable === status.satisfiable
      ) continue;
      changed = (await this.sendSignal(self, edge.other, edge.otherVersion, status.satisfiable)) || changed;
    }

    for (const last of sentRows) {
      if (neighbors.has(last.to)) continue;
      if (!last.satisfiable && last.fromVersion === self.version) continue;
      changed = (await this.retractTo(self, last)) || changed;
    }

    if (changed) events.emit('signal.changed', { intentId: self.id });

    const covered = [...candidatesBySlot(self.public, edges).values()].some((list) => list.length > 0);
    if ((edges.length === 0 || !covered) && !(await hooks.hasPendingArrangement(self.id))) {
      this.dormant = true;
      if (reason !== 'boot' && this.notifiedVersion !== self.version) {
        this.notifiedVersion = self.version;
        events.emit('notify', {
          userId: self.ownerId,
          kind: 'nothing_found',
          payload: { intentId: self.id, nearMisses: await detectNearMisses(self.id) },
        });
      }
    }
    return { closed: false };
  }

  async onMessage(env: Envelope): Promise<void> {
    const body = env.body;
    if (body.type === 'signal') {
      await signalRepo().upsert({
        from: env.from,
        to: env.to,
        fromVersion: body.fromVersion,
        toVersion: body.toVersion,
        satisfiable: body.satisfiable,
        updatedAt: clock.now(),
      });
      this.requestWake('signal');
      return;
    }
    hooks.negotiation(env);
  }

  async precheck(terms: PrecheckTerms): Promise<PrecheckResult> {
    const self = await getIntentRepository().get(this.intentId);
    if (!self || self.state !== 'open') return { ok: false, reason: 'Intent is no longer open' };
    if (self.version !== terms.intentVersion) return { ok: false, reason: 'Intent version changed' };

    const minNet = self.private.minNetCents;
    if (minNet !== null && (terms.netCents === null || terms.netCents < minNet)) {
      return { ok: false, reason: 'Net result is below the minimum' };
    }
    // Cash is covered by the net check; itemMatch never matches cash.
    for (const item of terms.give.filter((i) => i.kind !== 'cash')) {
      if (!self.public.give.some((offered) => itemMatch(offered, item))) {
        return { ok: false, reason: 'Item is not offered by this intent' };
      }
    }
    for (const item of terms.receive.filter((i) => i.kind !== 'cash')) {
      if (!self.public.want.some((slot) => itemMatch(item, slot))) {
        return { ok: false, reason: 'Item is not wanted by this intent' };
      }
    }
    if (isPastDeadline(self, terms.at ?? clock.now())) return { ok: false, reason: 'Deadline has passed' };
    return { ok: true };
  }

  // Tell every neighbor we signaled that we are no longer satisfiable.
  async retract(): Promise<void> {
    const self = await getIntentRepository().get(this.intentId);
    if (!self) return;
    for (const last of await signalRepo().from(self.id)) {
      if (!last.satisfiable) continue;
      await this.retractTo(self, last);
    }
  }

  private async retractTo(self: StoredIntent, last: StoredSignal): Promise<boolean> {
    const recipient = await getIntentRepository().get(last.to);
    if (recipient?.state === 'open') {
      return this.sendSignal(self, last.to, recipient.version, false);
    }
    await signalRepo().upsert({
      ...last,
      fromVersion: self.version,
      satisfiable: false,
      updatedAt: clock.now(),
    });
    return false;
  }

  private async sendSignal(
    self: StoredIntent,
    to: string,
    toVersion: number,
    satisfiable: boolean,
  ): Promise<boolean> {
    const result = await bus.send(makeEnvelope(self.id, to, {
      type: 'signal',
      fromVersion: self.version,
      toVersion,
      satisfiable,
    }));
    if (!result.delivered) return false;
    await signalRepo().upsert({
      from: self.id,
      to,
      fromVersion: self.version,
      toVersion,
      satisfiable,
      updatedAt: clock.now(),
    });
    return true;
  }
}

function isPastDeadline(intent: StoredIntent, now: number): boolean {
  const deadline = intent.public.deadline ? Date.parse(intent.public.deadline) : Number.NaN;
  return Number.isFinite(deadline) && deadline * Math.max(1, config.TIME_SCALE ?? 1) <= now;
}
