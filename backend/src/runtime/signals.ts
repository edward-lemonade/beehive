import { sql } from '../db/index.js';

export type StoredSignal = {
  from: string;
  to: string;
  fromVersion: number;
  toVersion: number;
  satisfiable: boolean;
  updatedAt: number;
};

export interface SignalRepository {
  from(intentId: string): Promise<StoredSignal[]>;
  to(intentId: string): Promise<StoredSignal[]>;
  all(): Promise<StoredSignal[]>;
  upsert(signal: StoredSignal): Promise<void>;
}

type SignalRow = {
  from_intent: string;
  to_intent: string;
  from_version: number;
  to_version: number;
  satisfiable: boolean;
  updated_at: string | number | bigint;
};

const toSignal = (row: SignalRow): StoredSignal => ({
  from: row.from_intent,
  to: row.to_intent,
  fromVersion: Number(row.from_version),
  toVersion: Number(row.to_version),
  satisfiable: row.satisfiable,
  updatedAt: Number(row.updated_at),
});

export class PostgresSignalRepository implements SignalRepository {
  async from(intentId: string): Promise<StoredSignal[]> {
    return (await sql<SignalRow[]>`SELECT * FROM signals WHERE from_intent = ${intentId}`).map(toSignal);
  }

  async to(intentId: string): Promise<StoredSignal[]> {
    return (await sql<SignalRow[]>`SELECT * FROM signals WHERE to_intent = ${intentId}`).map(toSignal);
  }

  async all(): Promise<StoredSignal[]> {
    return (await sql<SignalRow[]>`SELECT * FROM signals`).map(toSignal);
  }

  async upsert(s: StoredSignal): Promise<void> {
    await sql`
      INSERT INTO signals (from_intent, to_intent, from_version, to_version, satisfiable, updated_at)
      VALUES (${s.from}, ${s.to}, ${s.fromVersion}, ${s.toVersion}, ${s.satisfiable}, ${s.updatedAt})
      ON CONFLICT (from_intent, to_intent) DO UPDATE SET
        from_version = EXCLUDED.from_version, to_version = EXCLUDED.to_version,
        satisfiable = EXCLUDED.satisfiable, updated_at = EXCLUDED.updated_at
    `;
  }
}

export class MemorySignalRepository implements SignalRepository {
  private readonly rows = new Map<string, StoredSignal>();

  async from(intentId: string): Promise<StoredSignal[]> {
    return [...this.rows.values()].filter((r) => r.from === intentId);
  }

  async to(intentId: string): Promise<StoredSignal[]> {
    return [...this.rows.values()].filter((r) => r.to === intentId);
  }

  async all(): Promise<StoredSignal[]> {
    return [...this.rows.values()];
  }

  async upsert(signal: StoredSignal): Promise<void> {
    this.rows.set(`${signal.from}>${signal.to}`, { ...signal });
  }
}

let active: SignalRepository = new PostgresSignalRepository();

export function signalRepo(): SignalRepository {
  return active;
}

export function setSignalRepository(repository?: SignalRepository): void {
  active = repository ?? new PostgresSignalRepository();
}
