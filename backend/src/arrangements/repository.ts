import { sql } from '../db/index.js';
import type { Link } from '../contracts/index.js';
import { getIntentRepository } from '../intents/service.js';
import {
  ACTIVE_STATES,
  LIVE_STATES,
  type ArrangementState,
  type CommitResult,
  type PriceProposal,
  type SaveResult,
  type StoredArrangement,
  type StoredSlot,
} from './types.js';

export type CommitArgs = { arrangementId: string; expectedRevision: number; now: number };

export interface ArrangementRepository {
  save(arrangement: StoredArrangement): Promise<SaveResult>;
  get(id: string): Promise<StoredArrangement | undefined>;
  findByKey(key: string): Promise<StoredArrangement | undefined>;
  listActive(): Promise<StoredArrangement[]>;
  activeForIntent(intentId: string): Promise<StoredArrangement[]>;
  listForUser(userId: string): Promise<StoredArrangement[]>;
  countRequested(userId: string): Promise<number>;
  addDecline(userId: string, key: string, at: number): Promise<void>;
  isDeclined(userId: string, key: string): Promise<boolean>;
  /** Forgets declines and dropped candidates that involve this intent so they can be proposed again. */
  revive(intentId: string): Promise<void>;
  commit(args: CommitArgs): Promise<CommitResult>;
}

const clone = <T>(value: T): T => structuredClone(value);

type ArrangementRow = {
  id: string;
  key: string;
  state: ArrangementState;
  revision: number;
  reason: string | null;
  excluded: string[];
  declared_net: Record<string, number>;
  proposal: PriceProposal | null;
  replace_deadline: string | number | bigint | null;
  created_at: string | number | bigint;
  updated_at: string | number | bigint;
};

type SlotRow = {
  arrangement_id: string;
  intent_id: string;
  user_id: string;
  intent_version: number;
  approval: StoredSlot['approval'];
  terms_hash: string | null;
  approved_net_cents: string | number | bigint | null;
  requested_at: string | number | bigint | null;
  decided_at: string | number | bigint | null;
};

type LinkRow = {
  arrangement_id: string;
  link_id: string;
  a: string;
  b: string;
  payer: string | null;
  amount_cents: string | number | bigint | null;
  state: Link['state'];
  flows: Link['flows'];
};

const num = (v: string | number | bigint | null): number | null => (v === null ? null : Number(v));

export class PostgresArrangementRepository implements ArrangementRepository {
  private async load(ids: string[]): Promise<StoredArrangement[]> {
    if (ids.length === 0) return [];
    const arrangements = await sql<ArrangementRow[]>`SELECT * FROM arrangements WHERE id = ANY(${ids}::uuid[])`;
    const slots = await sql<SlotRow[]>`
      SELECT * FROM arrangement_slots WHERE arrangement_id = ANY(${ids}::uuid[]) ORDER BY intent_id`;
    const links = await sql<LinkRow[]>`
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

  async save(a: StoredArrangement): Promise<SaveResult> {
    try {
      return await sql.begin(async (tx) => {
        const [existing] = await tx<{ state: ArrangementState }[]>`
          SELECT state FROM arrangements WHERE id = ${a.id} FOR UPDATE`;
        if (existing && (existing.state === 'committed' || existing.state === 'dissolved') && existing.state !== a.state) {
          return 'stale' as const;
        }
        await tx`
          INSERT INTO arrangements (id, key, state, revision, reason, excluded, declared_net, replace_deadline, created_at, updated_at, proposal)
          VALUES (${a.id}, ${a.key}, ${a.state}, ${a.revision}, ${a.reason}, ${JSON.stringify(a.excluded)}::jsonb,
            ${JSON.stringify(a.declaredNet)}::jsonb, ${a.replaceDeadline}, ${a.createdAt}, ${a.updatedAt}, ${a.proposal ? JSON.stringify(a.proposal) : null}::jsonb)
          ON CONFLICT (id) DO UPDATE SET key = EXCLUDED.key, state = EXCLUDED.state, revision = EXCLUDED.revision,
            reason = EXCLUDED.reason, excluded = EXCLUDED.excluded, declared_net = EXCLUDED.declared_net,
            replace_deadline = EXCLUDED.replace_deadline, updated_at = EXCLUDED.updated_at, proposal = EXCLUDED.proposal`;
        await tx`DELETE FROM arrangement_slots WHERE arrangement_id = ${a.id}`;
        await tx`DELETE FROM arrangement_links WHERE arrangement_id = ${a.id}`;
        for (const s of a.slots) {
          await tx`
            INSERT INTO arrangement_slots (arrangement_id, intent_id, user_id, intent_version, approval, terms_hash,
              approved_net_cents, requested_at, decided_at)
            VALUES (${a.id}, ${s.intentId}, ${s.userId}, ${s.intentVersion}, ${s.approval}, ${s.termsHash},
              ${s.approvedNetCents}, ${s.requestedAt}, ${s.decidedAt})`;
        }
        for (const l of a.links) {
          await tx`
            INSERT INTO arrangement_links (arrangement_id, link_id, a, b, payer, amount_cents, state, flows)
            VALUES (${a.id}, ${l.id}, ${l.a}, ${l.b}, ${l.payer}, ${l.amountCents}, ${l.state},
              ${JSON.stringify(l.flows)}::jsonb)`;
        }
        return 'ok' as const;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'key';
      throw error;
    }
  }

  async get(id: string): Promise<StoredArrangement | undefined> {
    return (await this.load([id]))[0];
  }

  async findByKey(key: string): Promise<StoredArrangement | undefined> {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM arrangements WHERE key = ${key} AND state = ANY(${LIVE_STATES}) LIMIT 1`;
    return rows[0] ? this.get(rows[0].id) : undefined;
  }

  async listActive(): Promise<StoredArrangement[]> {
    const rows = await sql<{ id: string }[]>`SELECT id FROM arrangements WHERE state = ANY(${ACTIVE_STATES})`;
    return this.load(rows.map((r) => r.id));
  }

  async activeForIntent(intentId: string): Promise<StoredArrangement[]> {
    const rows = await sql<{ id: string }[]>`
      SELECT a.id FROM arrangements a JOIN arrangement_slots s ON s.arrangement_id = a.id
      WHERE s.intent_id = ${intentId} AND a.state = ANY(${ACTIVE_STATES})`;
    return this.load(rows.map((r) => r.id));
  }

  async listForUser(userId: string): Promise<StoredArrangement[]> {
    const rows = await sql<{ id: string }[]>`
      SELECT DISTINCT a.id FROM arrangements a JOIN arrangement_slots s ON s.arrangement_id = a.id
      WHERE s.user_id = ${userId} AND a.state IN ('proposed', 'committed')`;
    return this.load(rows.map((r) => r.id));
  }

  async countRequested(userId: string): Promise<number> {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*) AS n FROM arrangement_slots s JOIN arrangements a ON a.id = s.arrangement_id
      WHERE s.user_id = ${userId} AND s.approval = 'requested' AND a.state = 'proposed'`;
    return Number(row?.n ?? 0);
  }

  async addDecline(userId: string, key: string, at: number): Promise<void> {
    await sql`INSERT INTO declined (user_id, arrangement_key, created_at) VALUES (${userId}, ${key}, ${at})
      ON CONFLICT DO NOTHING`;
  }

  async revive(intentId: string): Promise<void> {
    const pattern = `%${intentId}@%`;
    await sql`DELETE FROM declined WHERE arrangement_key LIKE ${pattern}`;
    await sql`UPDATE arrangements SET state = 'dissolved', reason = 'revived' WHERE state = 'dropped' AND key LIKE ${pattern}`;
  }

  async isDeclined(userId: string, key: string): Promise<boolean> {
    const rows = await sql`SELECT 1 FROM declined WHERE user_id = ${userId} AND arrangement_key = ${key}`;
    return rows.length > 0;
  }

  async commit({ arrangementId, expectedRevision, now }: CommitArgs): Promise<CommitResult> {
    const [first] = await sql<{ ids: string[] | null }[]>`
      SELECT array_agg(intent_id::text ORDER BY intent_id) AS ids FROM arrangement_slots
      WHERE arrangement_id = ${arrangementId}`;
    if (!first?.ids) return { ok: false, reason: 'not_found' };

    const result = await sql.begin(async (tx): Promise<CommitResult> => {
      const intents = await tx<{ id: string; version: number; state: string }[]>`
        SELECT id, version, state FROM intents WHERE id = ANY(${first.ids}::uuid[]) ORDER BY id FOR UPDATE`;
      const [arr] = await tx<ArrangementRow[]>`SELECT * FROM arrangements WHERE id = ${arrangementId} FOR UPDATE`;
      if (!arr) return { ok: false, reason: 'not_found' };
      if (arr.state !== 'proposed') return { ok: false, reason: 'state' };
      if (Number(arr.revision) !== expectedRevision) return { ok: false, reason: 'revision' };

      const slots = await tx<SlotRow[]>`SELECT * FROM arrangement_slots WHERE arrangement_id = ${arrangementId}`;
      const locked = new Set(intents.map((i) => i.id));
      if (slots.some((s) => !locked.has(s.intent_id))) return { ok: false, reason: 'revision' };
      if (slots.some((s) => s.approval !== 'approved')) return { ok: false, reason: 'approvals' };
      for (const slot of slots) {
        const intent = intents.find((i) => i.id === slot.intent_id);
        if (!intent || intent.state !== 'open' || Number(intent.version) !== Number(slot.intent_version)) {
          return { ok: false, reason: 'intent', intentId: slot.intent_id };
        }
      }

      const ids = slots.map((s) => s.intent_id);
      await tx`UPDATE intents SET state = 'done', updated_at = ${now} WHERE id = ANY(${ids}::uuid[])`;
      await tx`UPDATE arrangements SET state = 'committed', updated_at = ${now} WHERE id = ${arrangementId}`;
      await tx`UPDATE arrangement_slots SET approval = 'fulfilled', decided_at = ${now}
        WHERE arrangement_id = ${arrangementId}`;

      const others = await tx<{ id: string }[]>`
        SELECT DISTINCT a.id FROM arrangements a JOIN arrangement_slots s ON s.arrangement_id = a.id
        WHERE s.intent_id = ANY(${ids}::uuid[]) AND a.id <> ${arrangementId} AND a.state = ANY(${ACTIVE_STATES})
        ORDER BY a.id`;
      const consumed: Array<{ arrangementId: string; approvedUserIds: string[] }> = [];
      for (const other of others) {
        await tx`SELECT id FROM arrangements WHERE id = ${other.id} FOR UPDATE`;
        const approved = await tx<{ user_id: string }[]>`
          SELECT user_id FROM arrangement_slots WHERE arrangement_id = ${other.id} AND approval = 'approved'`;
        await tx`UPDATE arrangements SET state = 'dissolved', reason = 'consumed', updated_at = ${now}
          WHERE id = ${other.id}`;
        consumed.push({ arrangementId: other.id, approvedUserIds: approved.map((r) => r.user_id) });
      }
      return { ok: true, arrangement: undefined as unknown as StoredArrangement, consumed };
    });
    if (!result.ok) return result;
    const arrangement = await this.get(arrangementId);
    return arrangement ? { ...result, arrangement } : { ok: false, reason: 'not_found' };
  }
}

export class MemoryArrangementRepository implements ArrangementRepository {
  readonly rows = new Map<string, StoredArrangement>();
  readonly declines = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async save(a: StoredArrangement): Promise<SaveResult> {
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

  async get(id: string): Promise<StoredArrangement | undefined> {
    const row = this.rows.get(id);
    return row ? clone(row) : undefined;
  }

  async findByKey(key: string): Promise<StoredArrangement | undefined> {
    const row = [...this.rows.values()].find((r) => r.key === key && LIVE_STATES.includes(r.state));
    return row ? clone(row) : undefined;
  }

  async listActive(): Promise<StoredArrangement[]> {
    return [...this.rows.values()].filter((r) => ACTIVE_STATES.includes(r.state)).map(clone);
  }

  async activeForIntent(intentId: string): Promise<StoredArrangement[]> {
    return (await this.listActive()).filter((r) => r.slots.some((s) => s.intentId === intentId));
  }

  async listForUser(userId: string): Promise<StoredArrangement[]> {
    return [...this.rows.values()]
      .filter((r) => (r.state === 'proposed' || r.state === 'committed') && r.slots.some((s) => s.userId === userId))
      .map(clone);
  }

  async countRequested(userId: string): Promise<number> {
    return [...this.rows.values()].filter(
      (r) => r.state === 'proposed' && r.slots.some((s) => s.userId === userId && s.approval === 'requested'),
    ).length;
  }

  async addDecline(userId: string, key: string): Promise<void> {
    this.declines.add(`${userId}|${key}`);
  }

  async revive(intentId: string): Promise<void> {
    for (const entry of [...this.declines]) if (entry.slice(entry.indexOf('|') + 1).includes(`${intentId}@`)) this.declines.delete(entry);
    for (const row of this.rows.values()) {
      if (row.state === 'dropped' && row.key.includes(`${intentId}@`)) {
        row.state = 'dissolved';
        row.reason = 'revived';
      }
    }
  }

  async isDeclined(userId: string, key: string): Promise<boolean> {
    return this.declines.has(`${userId}|${key}`);
  }

  commit(args: CommitArgs): Promise<CommitResult> {
    return this.serial(() => this.commitNow(args));
  }

  private async commitNow({ arrangementId, expectedRevision, now }: CommitArgs): Promise<CommitResult> {
    const arr = this.rows.get(arrangementId);
    if (!arr) return { ok: false, reason: 'not_found' };
    if (arr.state !== 'proposed') return { ok: false, reason: 'state' };
    if (arr.revision !== expectedRevision) return { ok: false, reason: 'revision' };
    if (arr.slots.some((s) => s.approval !== 'approved')) return { ok: false, reason: 'approvals' };
    const intents = getIntentRepository();
    const loaded = [];
    for (const slot of arr.slots) {
      const intent = await intents.get(slot.intentId);
      if (!intent || intent.state !== 'open' || intent.version !== slot.intentVersion) {
        return { ok: false, reason: 'intent', intentId: slot.intentId };
      }
      loaded.push(intent);
    }
    for (const intent of loaded) await intents.saveVersion({ ...intent, state: 'done', updatedAt: now }, intent.version);

    arr.state = 'committed';
    arr.updatedAt = now;
    for (const slot of arr.slots) {
      slot.approval = 'fulfilled';
      slot.decidedAt = now;
    }
    const ids = new Set(arr.slots.map((s) => s.intentId));
    const consumed: Array<{ arrangementId: string; approvedUserIds: string[] }> = [];
    for (const other of this.rows.values()) {
      if (other.id === arr.id || !ACTIVE_STATES.includes(other.state)) continue;
      if (!other.slots.some((s) => ids.has(s.intentId))) continue;
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

let active: ArrangementRepository = new PostgresArrangementRepository();

export const arrangementRepo = (): ArrangementRepository => active;

export function setArrangementRepository(repository?: ArrangementRepository): void {
  active = repository ?? new PostgresArrangementRepository();
}
