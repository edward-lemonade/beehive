import { sql } from '../db/index.js';
import { getIntentRepository } from '../intents/service.js';
import { ACTIVE_STATES, LIVE_STATES, } from './types.js';
const clone = (value) => structuredClone(value);
const num = (v) => (v === null ? null : Number(v));
export class PostgresArrangementRepository {
    async load(ids) {
        if (ids.length === 0)
            return [];
        const arrangements = await sql `SELECT * FROM arrangements WHERE id = ANY(${ids}::uuid[])`;
        const slots = await sql `
      SELECT * FROM arrangement_slots WHERE arrangement_id = ANY(${ids}::uuid[]) ORDER BY intent_id`;
        const links = await sql `
      SELECT * FROM arrangement_links WHERE arrangement_id = ANY(${ids}::uuid[]) ORDER BY link_id`;
        return arrangements.map((row) => ({
            id: row.id,
            key: row.key,
            state: row.state,
            revision: Number(row.revision),
            reason: row.reason,
            excluded: row.excluded,
            declaredNet: row.declared_net,
            proposal: row.proposal ?? null,
            replaceDeadline: num(row.replace_deadline),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
            slots: slots
                .filter((s) => s.arrangement_id === row.id)
                .map((s) => ({
                intentId: s.intent_id,
                userId: s.user_id,
                intentVersion: Number(s.intent_version),
                approval: s.approval,
                termsHash: s.terms_hash,
                approvedNetCents: num(s.approved_net_cents),
                requestedAt: num(s.requested_at),
                decidedAt: num(s.decided_at),
            })),
            links: links
                .filter((l) => l.arrangement_id === row.id)
                .map((l) => ({
                id: l.link_id,
                a: l.a,
                b: l.b,
                flows: l.flows,
                payer: l.payer,
                amountCents: num(l.amount_cents),
                state: l.state,
            })),
        }));
    }
    async save(a) {
        try {
            return await sql.begin(async (tx) => {
                const [existing] = await tx `
          SELECT state FROM arrangements WHERE id = ${a.id} FOR UPDATE`;
                if (existing && (existing.state === 'committed' || existing.state === 'dissolved') && existing.state !== a.state) {
                    return 'stale';
                }
                await tx `
          INSERT INTO arrangements (id, key, state, revision, reason, excluded, declared_net, replace_deadline, created_at, updated_at, proposal)
          VALUES (${a.id}, ${a.key}, ${a.state}, ${a.revision}, ${a.reason}, ${JSON.stringify(a.excluded)}::jsonb,
            ${JSON.stringify(a.declaredNet)}::jsonb, ${a.replaceDeadline}, ${a.createdAt}, ${a.updatedAt}, ${a.proposal ? JSON.stringify(a.proposal) : null}::jsonb)
          ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, state = EXCLUDED.state, revision = EXCLUDED.revision,
            reason = EXCLUDED.reason, excluded = EXCLUDED.excluded, declared_net = EXCLUDED.declared_net,
            replace_deadline = EXCLUDED.replace_deadline, updated_at = EXCLUDED.updated_at, proposal = EXCLUDED.proposal`;
                await tx `DELETE FROM arrangement_slots WHERE arrangement_id = ${a.id}`;
                await tx `DELETE FROM arrangement_links WHERE arrangement_id = ${a.id}`;
                for (const s of a.slots) {
                    await tx `
            INSERT INTO arrangement_slots (arrangement_id, intent_id, user_id, intent_version, approval, terms_hash,
              approved_net_cents, requested_at, decided_at)
            VALUES (${a.id}, ${s.intentId}, ${s.userId}, ${s.intentVersion}, ${s.approval}, ${s.termsHash},
              ${s.approvedNetCents}, ${s.requestedAt}, ${s.decidedAt})`;
                }
                for (const l of a.links) {
                    await tx `
            INSERT INTO arrangement_links (arrangement_id, link_id, a, b, payer, amount_cents, state, flows)
            VALUES (${a.id}, ${l.id}, ${l.a}, ${l.b}, ${l.payer}, ${l.amountCents}, ${l.state},
              ${JSON.stringify(l.flows)}::jsonb)`;
                }
                return 'ok';
            });
        }
        catch (error) {
            if (error.code === '23505')
                return 'key';
            throw error;
        }
    }
    async get(id) {
        return (await this.load([id]))[0];
    }
    async findByKey(key) {
        const rows = await sql `
      SELECT id FROM arrangements WHERE key = ${key} AND state = ANY(${LIVE_STATES}) LIMIT 1`;
        return rows[0] ? this.get(rows[0].id) : undefined;
    }
    async listActive() {
        const rows = await sql `SELECT id FROM arrangements WHERE state = ANY(${ACTIVE_STATES})`;
        return this.load(rows.map((r) => r.id));
    }
    async activeForIntent(intentId) {
        const rows = await sql `
      SELECT a.id FROM arrangements a JOIN arrangement_slots s ON s.arrangement_id = a.id
      WHERE s.intent_id = ${intentId} AND a.state = ANY(${ACTIVE_STATES})`;
        return this.load(rows.map((r) => r.id));
    }
    async listForUser(userId) {
        const rows = await sql `
      SELECT DISTINCT a.id FROM arrangements a JOIN arrangement_slots s ON s.arrangement_id = a.id
      WHERE s.user_id = ${userId} AND a.state IN ('proposed', 'committed')`;
        return this.load(rows.map((r) => r.id));
    }
    async removeForUsers(userIds) {
        if (userIds.length === 0)
            return [];
        return sql.begin(async (tx) => {
            const removed = await tx `
        DELETE FROM arrangements
        WHERE id IN (
          SELECT DISTINCT arrangement_id FROM arrangement_slots WHERE user_id = ANY(${userIds}::uuid[])
        )
        RETURNING id`;
            await tx `DELETE FROM declined WHERE user_id = ANY(${userIds}::uuid[])`;
            return removed.map((row) => row.id);
        });
    }
    async countRequested(userId) {
        const [row] = await sql `
      SELECT count(*) AS n FROM arrangement_slots s JOIN arrangements a ON a.id = s.arrangement_id
      WHERE s.user_id = ${userId} AND s.approval = 'requested' AND a.state = 'proposed'`;
        return Number(row?.n ?? 0);
    }
    async addDecline(userId, key, at) {
        await sql `INSERT INTO declined (user_id, arrangement_key, created_at) VALUES (${userId}, ${key}, ${at})
      ON CONFLICT DO NOTHING`;
    }
    async revive(intentId) {
        const pattern = `%${intentId}@%`;
        await sql `DELETE FROM declined WHERE arrangement_key LIKE ${pattern}`;
        await sql `UPDATE arrangements SET state = 'dissolved', reason = 'revived' WHERE state = 'dropped' AND key LIKE ${pattern}`;
    }
    async isDeclined(userId, key) {
        const rows = await sql `SELECT 1 FROM declined WHERE user_id = ${userId} AND arrangement_key = ${key}`;
        return rows.length > 0;
    }
    async commit({ arrangementId, expectedRevision, now }) {
        const [first] = await sql `
      SELECT array_agg(intent_id::text ORDER BY intent_id) AS ids FROM arrangement_slots
      WHERE arrangement_id = ${arrangementId}`;
        if (!first?.ids)
            return { ok: false, reason: 'not_found' };
        const result = await sql.begin(async (tx) => {
            const intents = await tx `
        SELECT id, version, state FROM intents WHERE id = ANY(${first.ids}::uuid[]) ORDER BY id FOR UPDATE`;
            const [arr] = await tx `SELECT * FROM arrangements WHERE id = ${arrangementId} FOR UPDATE`;
            if (!arr)
                return { ok: false, reason: 'not_found' };
            if (arr.state !== 'proposed')
                return { ok: false, reason: 'state' };
            if (Number(arr.revision) !== expectedRevision)
                return { ok: false, reason: 'revision' };
            const slots = await tx `SELECT * FROM arrangement_slots WHERE arrangement_id = ${arrangementId}`;
            const locked = new Set(intents.map((i) => i.id));
            if (slots.some((s) => !locked.has(s.intent_id)))
                return { ok: false, reason: 'revision' };
            if (slots.some((s) => s.approval !== 'approved'))
                return { ok: false, reason: 'approvals' };
            for (const slot of slots) {
                const intent = intents.find((i) => i.id === slot.intent_id);
                if (!intent || intent.state !== 'open' || Number(intent.version) !== Number(slot.intent_version)) {
                    return { ok: false, reason: 'intent', intentId: slot.intent_id };
                }
            }
            const ids = slots.map((s) => s.intent_id);
            await tx `UPDATE intents SET state = 'done', updated_at = ${now} WHERE id = ANY(${ids}::uuid[])`;
            await tx `UPDATE arrangements SET state = 'committed', updated_at = ${now} WHERE id = ${arrangementId}`;
            await tx `UPDATE arrangement_slots SET approval = 'fulfilled', decided_at = ${now}
        WHERE arrangement_id = ${arrangementId}`;
            const others = await tx `
        SELECT DISTINCT a.id FROM arrangements a JOIN arrangement_slots s ON s.arrangement_id = a.id
        WHERE s.intent_id = ANY(${ids}::uuid[]) AND a.id <> ${arrangementId} AND a.state = ANY(${ACTIVE_STATES})
        ORDER BY a.id`;
            const consumed = [];
            for (const other of others) {
                await tx `SELECT id FROM arrangements WHERE id = ${other.id} FOR UPDATE`;
                const approved = await tx `
          SELECT user_id FROM arrangement_slots WHERE arrangement_id = ${other.id} AND approval = 'approved'`;
                await tx `UPDATE arrangements SET state = 'dissolved', reason = 'consumed', updated_at = ${now}
          WHERE id = ${other.id}`;
                consumed.push({ arrangementId: other.id, approvedUserIds: approved.map((r) => r.user_id) });
            }
            return { ok: true, arrangement: undefined, consumed };
        });
        if (!result.ok)
            return result;
        const arrangement = await this.get(arrangementId);
        return arrangement ? { ...result, arrangement } : { ok: false, reason: 'not_found' };
    }
}
export class MemoryArrangementRepository {
    rows = new Map();
    declines = new Set();
    chain = Promise.resolve();
    serial(fn) {
        const next = this.chain.then(fn, fn);
        this.chain = next.catch(() => undefined);
        return next;
    }
    async save(a) {
        const existing = this.rows.get(a.id);
        if (existing && (existing.state === 'committed' || existing.state === 'dissolved') && existing.state !== a.state) {
            return 'stale';
        }
        for (const other of this.rows.values()) {
            if (other.id !== a.id && other.key === a.key && LIVE_STATES.includes(other.state) && LIVE_STATES.includes(a.state)) {
                return 'key';
            }
        }
        this.rows.set(a.id, clone(a));
        return 'ok';
    }
    async get(id) {
        const row = this.rows.get(id);
        return row ? clone(row) : undefined;
    }
    async findByKey(key) {
        const row = [...this.rows.values()].find((r) => r.key === key && LIVE_STATES.includes(r.state));
        return row ? clone(row) : undefined;
    }
    async listActive() {
        return [...this.rows.values()].filter((r) => ACTIVE_STATES.includes(r.state)).map(clone);
    }
    async activeForIntent(intentId) {
        return (await this.listActive()).filter((r) => r.slots.some((s) => s.intentId === intentId));
    }
    async listForUser(userId) {
        return [...this.rows.values()]
            .filter((r) => (r.state === 'proposed' || r.state === 'committed') && r.slots.some((s) => s.userId === userId))
            .map(clone);
    }
    async removeForUsers(userIds) {
        const users = new Set(userIds);
        const removed = [];
        for (const [id, row] of this.rows) {
            if (row.slots.some((slot) => users.has(slot.userId))) {
                this.rows.delete(id);
                removed.push(id);
            }
        }
        for (const decline of [...this.declines]) {
            if (users.has(decline.slice(0, decline.indexOf('|'))))
                this.declines.delete(decline);
        }
        return removed;
    }
    async countRequested(userId) {
        return [...this.rows.values()].filter((r) => r.state === 'proposed' && r.slots.some((s) => s.userId === userId && s.approval === 'requested')).length;
    }
    async addDecline(userId, key) {
        this.declines.add(`${userId}|${key}`);
    }
    async revive(intentId) {
        for (const entry of [...this.declines])
            if (entry.slice(entry.indexOf('|') + 1).includes(`${intentId}@`))
                this.declines.delete(entry);
        for (const row of this.rows.values()) {
            if (row.state === 'dropped' && row.key.includes(`${intentId}@`)) {
                row.state = 'dissolved';
                row.reason = 'revived';
            }
        }
    }
    async isDeclined(userId, key) {
        return this.declines.has(`${userId}|${key}`);
    }
    commit(args) {
        return this.serial(() => this.commitNow(args));
    }
    async commitNow({ arrangementId, expectedRevision, now }) {
        const arr = this.rows.get(arrangementId);
        if (!arr)
            return { ok: false, reason: 'not_found' };
        if (arr.state !== 'proposed')
            return { ok: false, reason: 'state' };
        if (arr.revision !== expectedRevision)
            return { ok: false, reason: 'revision' };
        if (arr.slots.some((s) => s.approval !== 'approved'))
            return { ok: false, reason: 'approvals' };
        const intents = getIntentRepository();
        const loaded = [];
        for (const slot of arr.slots) {
            const intent = await intents.get(slot.intentId);
            if (!intent || intent.state !== 'open' || intent.version !== slot.intentVersion) {
                return { ok: false, reason: 'intent', intentId: slot.intentId };
            }
            loaded.push(intent);
        }
        for (const intent of loaded)
            await intents.saveVersion({ ...intent, state: 'done', updatedAt: now }, intent.version);
        arr.state = 'committed';
        arr.updatedAt = now;
        for (const slot of arr.slots) {
            slot.approval = 'fulfilled';
            slot.decidedAt = now;
        }
        const ids = new Set(arr.slots.map((s) => s.intentId));
        const consumed = [];
        for (const other of this.rows.values()) {
            if (other.id === arr.id || !ACTIVE_STATES.includes(other.state))
                continue;
            if (!other.slots.some((s) => ids.has(s.intentId)))
                continue;
            consumed.push({
                arrangementId: other.id,
                approvedUserIds: other.slots.filter((s) => s.approval === 'approved').map((s) => s.userId),
            });
            other.state = 'dissolved';
            other.reason = 'consumed';
            other.updatedAt = now;
        }
        return { ok: true, arrangement: clone(arr), consumed };
    }
}
let active = new PostgresArrangementRepository();
export const arrangementRepo = () => active;
export function setArrangementRepository(repository) {
    active = repository ?? new PostgresArrangementRepository();
}
