import { sql } from '../db/index.js';
const toSignal = (row) => ({
    from: row.from_intent,
    to: row.to_intent,
    fromVersion: Number(row.from_version),
    toVersion: Number(row.to_version),
    satisfiable: row.satisfiable,
    updatedAt: Number(row.updated_at),
});
export class PostgresSignalRepository {
    async from(intentId) {
        return (await sql `SELECT * FROM signals WHERE from_intent = ${intentId}`).map(toSignal);
    }
    async to(intentId) {
        return (await sql `SELECT * FROM signals WHERE to_intent = ${intentId}`).map(toSignal);
    }
    async upsert(s) {
        await sql `
      INSERT INTO signals (from_intent, to_intent, from_version, to_version, satisfiable, updated_at)
      VALUES (${s.from}, ${s.to}, ${s.fromVersion}, ${s.toVersion}, ${s.satisfiable}, ${s.updatedAt})
      ON CONFLICT (from_intent, to_intent) DO UPDATE SET
        from_version = EXCLUDED.from_version, to_version = EXCLUDED.to_version,
        satisfiable = EXCLUDED.satisfiable, updated_at = EXCLUDED.updated_at
    `;
    }
}
export class MemorySignalRepository {
    rows = new Map();
    async from(intentId) {
        return [...this.rows.values()].filter((r) => r.from === intentId);
    }
    async to(intentId) {
        return [...this.rows.values()].filter((r) => r.to === intentId);
    }
    async upsert(signal) {
        this.rows.set(`${signal.from}>${signal.to}`, { ...signal });
    }
}
let active = new PostgresSignalRepository();
export function signalRepo() {
    return active;
}
export function setSignalRepository(repository) {
    active = repository ?? new PostgresSignalRepository();
}
