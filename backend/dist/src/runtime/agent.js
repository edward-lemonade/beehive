import { clock } from '../clock.js';
import { config } from '../config.js';
import { detectNearMisses, getEdges } from '../discovery/service.js';
import { itemMatch } from '../discovery/match.js';
import { candidatesBySlot, localStatus } from '../engine/index.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { Sentry } from '../observability/telemetry.js';
import { bus, makeEnvelope } from './bus.js';
import { hooks } from './hooks.js';
import { signalRepo } from './signals.js';
export class Agent {
    intentId;
    requestWake;
    dormant = false;
    notifiedVersion = -1;
    edgeKey = null;
    constructor(intentId, requestWake) {
        this.intentId = intentId;
        this.requestWake = requestWake;
    }
    // Returns { closed: true } when the intent is no longer Open and the agent should be destroyed.
    async wake(reason) {
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
        // A new neighbor invalidates earlier verdicts: two agents that each saw only part of the picture can lock each other at false, so start over optimistically.
        const edgeKey = edges.map((e) => `${e.other}@${e.otherVersion}`).sort().join('|');
        const edgesChanged = edgeKey !== this.edgeKey;
        this.edgeKey = edgeKey;
        const incoming = edges.map((edge) => {
            const row = rowsByFrom.get(edge.other);
            const current = !edgesChanged && row !== undefined && row.fromVersion === edge.otherVersion && row.toVersion === self.version;
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
        const neighbors = new Set();
        let changed = false;
        for (const edge of edges) {
            neighbors.add(edge.other);
            const last = sentBy.get(edge.other);
            if (last
                && last.fromVersion === self.version
                && last.toVersion === edge.otherVersion
                && last.satisfiable === status.satisfiable)
                continue;
            changed = (await this.sendSignal(self, edge.other, edge.otherVersion, status.satisfiable)) || changed;
        }
        for (const last of sentRows) {
            if (neighbors.has(last.to))
                continue;
            if (!last.satisfiable && last.fromVersion === self.version)
                continue;
            changed = (await this.retractTo(self, last)) || changed;
        }
        if (changed)
            events.emit('signal.changed', { intentId: self.id });
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
    async onMessage(env) {
        const body = env.body;
        if (body.type === 'signal') {
            const repository = getIntentRepository();
            const [sender, recipient] = await Promise.all([
                repository.get(env.from),
                repository.get(env.to),
            ]);
            Sentry.getActiveSpan()?.setAttributes({
                'bus.sender.version_expected': body.fromVersion,
                'bus.sender.version_observed': sender?.version ?? -1,
                'bus.sender.version_matches': sender?.version === body.fromVersion,
                'bus.receiver.version_expected': body.toVersion,
                'bus.receiver.version_observed': recipient?.version ?? -1,
                'bus.receiver.version_matches': recipient?.version === body.toVersion,
            });
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
    async precheck(terms) {
        const self = await getIntentRepository().get(this.intentId);
        if (!self || self.state !== 'open')
            return { ok: false, reason: 'Intent is no longer open' };
        if (self.version !== terms.intentVersion)
            return { ok: false, reason: 'Intent version changed' };
        const minNet = self.private.minNetCents;
        if (minNet !== null && (terms.netCents === null || terms.netCents < minNet)) {
            return { ok: false, reason: 'Net result is below the minimum' };
        }
        // Cash is covered by the net check; itemMatch never matches cash.
        // The matcher's vetted edges count too: an LLM verdict can accept items whose labels differ.
        const edges = await getEdges(self.id);
        const same = (a, b) => a.kind === b.kind && a.label === b.label;
        for (const item of terms.give.filter((i) => i.kind !== 'cash')) {
            if (!self.public.give.some((offered) => itemMatch(offered, item)) && !edges.some((e) => e.selfGives.some((g) => same(g.item, item)))) {
                return { ok: false, reason: 'Item is not offered by this intent' };
            }
        }
        for (const item of terms.receive.filter((i) => i.kind !== 'cash')) {
            if (!self.public.want.some((slot) => itemMatch(item, slot)) && !edges.some((e) => e.selfWants.some((w) => same(w.item, item)))) {
                return { ok: false, reason: 'Item is not wanted by this intent' };
            }
        }
        if (isPastDeadline(self, terms.at ?? clock.now()))
            return { ok: false, reason: 'Deadline has passed' };
        return { ok: true };
    }
    // Tell every neighbor we signaled that we are no longer satisfiable.
    async retract() {
        const self = await getIntentRepository().get(this.intentId);
        if (!self)
            return;
        for (const last of await signalRepo().from(self.id)) {
            if (!last.satisfiable)
                continue;
            await this.retractTo(self, last);
        }
    }
    async retractTo(self, last) {
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
    async sendSignal(self, to, toVersion, satisfiable) {
        const result = await bus.send(makeEnvelope(self.id, to, {
            type: 'signal',
            fromVersion: self.version,
            toVersion,
            satisfiable,
        }));
        if (!result.delivered)
            return false;
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
function isPastDeadline(intent, now) {
    const deadline = intent.public.deadline ? Date.parse(intent.public.deadline) : Number.NaN;
    return Number.isFinite(deadline) && deadline * Math.max(1, config.TIME_SCALE ?? 1) <= now;
}
