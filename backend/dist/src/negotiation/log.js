import { sql } from '../db/index.js';
export class PostgresNegotiationLogRepository {
    async append(e) {
        await sql `
      INSERT INTO negotiation_log (link_id, arrangement_id, round, from_intent, to_intent, kind, amount_cents, text, created_at)
      VALUES (${e.linkId}, ${e.arrangementId}, ${e.round}, ${e.from}, ${e.to}, ${e.kind}, ${e.amountCents}, ${e.text}, ${e.at})
    `;
    }
    async forLink(linkId) {
        const rows = await sql `SELECT * FROM negotiation_log WHERE link_id = ${linkId} ORDER BY id`;
        return rows.map((r) => ({
            linkId: r.link_id,
            arrangementId: r.arrangement_id,
            round: r.round,
            from: r.from_intent,
            to: r.to_intent,
            kind: r.kind,
            amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
            text: r.text,
            at: Number(r.created_at),
        }));
    }
}
export class MemoryNegotiationLogRepository {
    entries = [];
    async append(entry) {
        this.entries.push({ ...entry });
    }
    async forLink(linkId) {
        return this.entries.filter((e) => e.linkId === linkId);
    }
}
let active = new PostgresNegotiationLogRepository();
export function negotiationLog() {
    return active;
}
export function setNegotiationLogRepository(repository) {
    active = repository ?? new PostgresNegotiationLogRepository();
}
