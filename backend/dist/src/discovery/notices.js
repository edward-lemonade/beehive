import { sql } from '../db/index.js';
const toNotice = (row) => ({
    observer: row.observer_intent,
    intent: row.intent,
    observerVersion: Number(row.observer_version),
    version: Number(row.version),
    relevant: row.relevant,
    edge: row.edge,
    updatedAt: Number(row.updated_at),
});
export class PostgresNoticeRepository {
    async forObserver(observer) {
        const rows = await sql `SELECT * FROM notices WHERE observer_intent = ${observer}`;
        return rows.map(toNotice);
    }
    async observersOf(intent) {
        const rows = await sql `SELECT * FROM notices WHERE intent = ${intent}`;
        return rows.map(toNotice);
    }
    async upsertMany(notices) {
        if (notices.length === 0)
            return;
        await sql.begin((tx) => notices.map((n) => tx `
        INSERT INTO notices (observer_intent, intent, observer_version, version, relevant, edge, updated_at)
        VALUES (${n.observer}, ${n.intent}, ${n.observerVersion}, ${n.version}, ${n.relevant},
          ${n.edge ? JSON.stringify(n.edge) : null}::jsonb, ${n.updatedAt})
        ON CONFLICT (observer_intent, intent) DO UPDATE SET
          observer_version = EXCLUDED.observer_version, version = EXCLUDED.version,
          relevant = EXCLUDED.relevant, edge = EXCLUDED.edge, updated_at = EXCLUDED.updated_at
      `));
    }
    async deleteForIntent(intent) {
        const rows = await sql `
      DELETE FROM notices WHERE intent = ${intent} OR observer_intent = ${intent} RETURNING *
    `;
        return rows.map(toNotice);
    }
}
export class MemoryNoticeRepository {
    notices = new Map();
    key = (n) => `${n.observer}:${n.intent}`;
    async forObserver(observer) {
        return [...this.notices.values()].filter((n) => n.observer === observer);
    }
    async observersOf(intent) {
        return [...this.notices.values()].filter((n) => n.intent === intent);
    }
    async upsertMany(notices) {
        for (const n of notices)
            this.notices.set(this.key(n), n);
    }
    async deleteForIntent(intent) {
        const removed = [...this.notices.values()].filter((n) => n.intent === intent || n.observer === intent);
        for (const n of removed)
            this.notices.delete(this.key(n));
        return removed;
    }
}
export const noticeRepository = new PostgresNoticeRepository();
