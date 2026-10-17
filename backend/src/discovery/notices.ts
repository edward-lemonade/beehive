import { sql } from '../db/index.js';
import type { RelevantEdge } from '../contracts/index.js';

export type Notice = {
  observer: string;
  intent: string;
  observerVersion: number;
  version: number;
  relevant: boolean;
  edge: RelevantEdge | null;
  updatedAt: number;
};

export interface NoticeRepository {
  forObserver(observer: string): Promise<Notice[]>;
  observersOf(intent: string): Promise<Notice[]>;
  upsertMany(notices: Notice[]): Promise<void>;
  deleteForIntent(intent: string): Promise<Notice[]>;
}

type NoticeRow = {
  observer_intent: string;
  intent: string;
  observer_version: number;
  version: number;
  relevant: boolean;
  edge: RelevantEdge | null;
  updated_at: string | number | bigint;
};

const toNotice = (row: NoticeRow): Notice => ({
  observer: row.observer_intent,
  intent: row.intent,
  observerVersion: Number(row.observer_version),
  version: Number(row.version),
  relevant: row.relevant,
  edge: row.edge,
  updatedAt: Number(row.updated_at),
});

export class PostgresNoticeRepository implements NoticeRepository {
  async forObserver(observer: string): Promise<Notice[]> {
    const rows = await sql<NoticeRow[]>`SELECT * FROM notices WHERE observer_intent = ${observer}`;
    return rows.map(toNotice);
  }

  async observersOf(intent: string): Promise<Notice[]> {
    const rows = await sql<NoticeRow[]>`SELECT * FROM notices WHERE intent = ${intent}`;
    return rows.map(toNotice);
  }

  async upsertMany(notices: Notice[]): Promise<void> {
    if (notices.length === 0) return;
    await sql.begin((tx) =>
      notices.map((n) => tx`
        INSERT INTO notices (observer_intent, intent, observer_version, version, relevant, edge, updated_at)
        VALUES (${n.observer}, ${n.intent}, ${n.observerVersion}, ${n.version}, ${n.relevant},
          ${n.edge ? JSON.stringify(n.edge) : null}::jsonb, ${n.updatedAt})
        ON CONFLICT (observer_intent, intent) DO UPDATE SET
          observer_version = EXCLUDED.observer_version, version = EXCLUDED.version,
          relevant = EXCLUDED.relevant, edge = EXCLUDED.edge, updated_at = EXCLUDED.updated_at
      `),
    );
  }

  async deleteForIntent(intent: string): Promise<Notice[]> {
    const rows = await sql<NoticeRow[]>`
      DELETE FROM notices WHERE intent = ${intent} OR observer_intent = ${intent} RETURNING *
    `;
    return rows.map(toNotice);
  }
}

export class MemoryNoticeRepository implements NoticeRepository {
  private readonly notices = new Map<string, Notice>();
  private key = (n: { observer: string; intent: string }) => `${n.observer}:${n.intent}`;

  async forObserver(observer: string): Promise<Notice[]> {
    return [...this.notices.values()].filter((n) => n.observer === observer);
  }

  async observersOf(intent: string): Promise<Notice[]> {
    return [...this.notices.values()].filter((n) => n.intent === intent);
  }

  async upsertMany(notices: Notice[]): Promise<void> {
    for (const n of notices) this.notices.set(this.key(n), n);
  }

  async deleteForIntent(intent: string): Promise<Notice[]> {
    const removed = [...this.notices.values()].filter((n) => n.intent === intent || n.observer === intent);
    for (const n of removed) this.notices.delete(this.key(n));
    return removed;
  }
}

export const noticeRepository: NoticeRepository = new PostgresNoticeRepository();
