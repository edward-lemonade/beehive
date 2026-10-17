import { sql } from '../db/index.js';

export type NegotiationLogEntry = {
  linkId: string;
  arrangementId: string | null;
  round: number;
  from: string;
  to: string;
  kind: 'offer' | 'accept' | 'walk' | 'say';
  amountCents: number | null;
  text: string | null;
  at: number;
};

export interface NegotiationLogRepository {
  append(entry: NegotiationLogEntry): Promise<void>;
  forLink(linkId: string): Promise<NegotiationLogEntry[]>;
}

type Row = {
  link_id: string;
  arrangement_id: string | null;
  round: number;
  from_intent: string;
  to_intent: string;
  kind: NegotiationLogEntry['kind'];
  amount_cents: string | number | null;
  text: string | null;
  created_at: string | number;
};

export class PostgresNegotiationLogRepository implements NegotiationLogRepository {
  async append(e: NegotiationLogEntry): Promise<void> {
    await sql`
      INSERT INTO negotiation_log (link_id, arrangement_id, round, from_intent, to_intent, kind, amount_cents, text, created_at)
      VALUES (${e.linkId}, ${e.arrangementId}, ${e.round}, ${e.from}, ${e.to}, ${e.kind}, ${e.amountCents}, ${e.text}, ${e.at})
    `;
  }

  async forLink(linkId: string): Promise<NegotiationLogEntry[]> {
    const rows = await sql<Row[]>`SELECT * FROM negotiation_log WHERE link_id = ${linkId} ORDER BY id`;
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

export class MemoryNegotiationLogRepository implements NegotiationLogRepository {
  readonly entries: NegotiationLogEntry[] = [];
  async append(entry: NegotiationLogEntry): Promise<void> {
    this.entries.push({ ...entry });
  }
  async forLink(linkId: string): Promise<NegotiationLogEntry[]> {
    return this.entries.filter((e) => e.linkId === linkId);
  }
}

let active: NegotiationLogRepository = new PostgresNegotiationLogRepository();

export function negotiationLog(): NegotiationLogRepository {
  return active;
}

export function setNegotiationLogRepository(repository?: NegotiationLogRepository): void {
  active = repository ?? new PostgresNegotiationLogRepository();
}
