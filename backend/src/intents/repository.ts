import { sql } from '../db/index.js';
import { config } from '../config.js';
import type { IntentPrivate, IntentPublic, IntentState } from '../contracts/index.js';
import type { ParsedIntent } from './types.js';

export type StoredIntent = {
  id: string;
  draftId: string;
  ownerId: string;
  version: number;
  state: IntentState;
  public: IntentPublic;
  private: IntentPrivate;
  sourceText: string;
  parsed: ParsedIntent;
  createdAt: number;
  updatedAt: number;
};

export class OpenIntentLimitError extends Error {
  constructor() {
    super('Confirming this draft would exceed the limit of 10 open intents');
    this.name = 'OpenIntentLimitError';
  }
}

export interface IntentRepository {
  createMany(intents: StoredIntent[], maxOpen: number, draftId: string): Promise<StoredIntent[]>;
  get(intentId: string): Promise<StoredIntent | undefined>;
  saveVersion(intent: StoredIntent, expectedVersion: number): Promise<boolean>;
  changeState(
    intentId: string,
    ownerId: string,
    expectedState: IntentState,
    nextState: IntentState,
    updatedAt: number,
  ): Promise<StoredIntent | undefined>;
  expireDue(now: number): Promise<StoredIntent[]>;
  listMine(ownerId: string): Promise<StoredIntent[]>;
  listOpen(): Promise<StoredIntent[]>;
}

type IntentRow = {
  id: string;
  draft_id: string;
  user_id: string;
  version: number;
  state: IntentState;
  public: IntentPublic;
  private: IntentPrivate;
  source_text: string;
  parsed: ParsedIntent;
  created_at: string | number | bigint;
  updated_at: string | number | bigint;
};

function toStoredIntent(row: IntentRow): StoredIntent {
  return {
    id: row.id,
    draftId: row.draft_id,
    ownerId: row.user_id,
    version: Number(row.version),
    state: row.state,
    public: row.public,
    private: row.private,
    sourceText: row.source_text,
    parsed: row.parsed,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class PostgresIntentRepository implements IntentRepository {
  async createMany(records: StoredIntent[], maxOpen: number, draftId: string): Promise<StoredIntent[]> {
    return sql.begin(async (tx) => {
      const ownerId = records[0]?.ownerId;
      if (!ownerId || records.some((record) => record.ownerId !== ownerId)) {
        throw new Error('A confirmation batch must have one owner');
      }
      if (records.some((record) => record.draftId !== draftId)) {
        throw new Error('A confirmation batch must match its draft');
      }

      const [owner] = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE
      `;
      if (!owner) throw new Error(`Cannot persist intents for missing user ${ownerId}`);

      const existing = await tx<IntentRow[]>`
        SELECT * FROM intents
        WHERE draft_id = ${draftId} AND user_id = ${ownerId}
        ORDER BY id
      `;
      if (existing.length > 0) {
        if (existing.length !== records.length) {
          throw new Error(`Incomplete persisted confirmation for draft ${draftId}`);
        }
        return existing.map(toStoredIntent);
      }

      const [count] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM intents
        WHERE user_id = ${ownerId} AND state = 'open'
      `;
      if ((count?.count ?? 0) + records.length > maxOpen) throw new OpenIntentLimitError();

      for (const record of records) {
        await tx`
          INSERT INTO intents (
            id, draft_id, user_id, version, state, "public", "private", source_text, parsed,
            deadline, created_at, updated_at
          ) VALUES (
            ${record.id}, ${draftId}, ${record.ownerId}, ${record.version}, ${record.state},
            ${JSON.stringify(record.public)}::jsonb, ${JSON.stringify(record.private)}::jsonb,
            ${record.sourceText}, ${JSON.stringify(record.parsed)}::jsonb,
            ${record.public.deadline},
            ${record.createdAt}, ${record.updatedAt}
          )
        `;
        await tx`
          INSERT INTO intent_versions (
            intent_id, version, "public", "private", source_text, parsed, created_at
          ) VALUES (
            ${record.id}, ${record.version},
            ${JSON.stringify(record.public)}::jsonb, ${JSON.stringify(record.private)}::jsonb,
            ${record.sourceText}, ${JSON.stringify(record.parsed)}::jsonb, ${record.createdAt}
          )
        `;
      }
      return records;
    });
  }

  async get(intentId: string): Promise<StoredIntent | undefined> {
    const [row] = await sql<IntentRow[]>`SELECT * FROM intents WHERE id = ${intentId} LIMIT 1`;
    return row ? toStoredIntent(row) : undefined;
  }

  async saveVersion(record: StoredIntent, expectedVersion: number): Promise<boolean> {
    return sql.begin(async (tx) => {
      const [updated] = await tx<{ id: string }[]>`
        UPDATE intents SET
          version = ${record.version},
          "public" = ${JSON.stringify(record.public)}::jsonb,
          "private" = ${JSON.stringify(record.private)}::jsonb,
          source_text = ${record.sourceText},
          parsed = ${JSON.stringify(record.parsed)}::jsonb,
          deadline = ${record.public.deadline},
          updated_at = ${record.updatedAt}
        WHERE id = ${record.id}
          AND user_id = ${record.ownerId}
          AND version = ${expectedVersion}
          AND state = 'open'
        RETURNING id
      `;
      if (!updated) return false;

      await tx`
        INSERT INTO intent_versions (
          intent_id, version, "public", "private", source_text, parsed, created_at
        ) VALUES (
          ${record.id}, ${record.version},
          ${JSON.stringify(record.public)}::jsonb, ${JSON.stringify(record.private)}::jsonb,
          ${record.sourceText}, ${JSON.stringify(record.parsed)}::jsonb, ${record.updatedAt}
        )
      `;
      return true;
    });
  }

  async changeState(
    intentId: string,
    ownerId: string,
    expectedState: IntentState,
    nextState: IntentState,
    updatedAt: number,
  ): Promise<StoredIntent | undefined> {
    const [row] = await sql<IntentRow[]>`
      UPDATE intents SET state = ${nextState}, updated_at = ${updatedAt}
      WHERE id = ${intentId} AND user_id = ${ownerId} AND state = ${expectedState}
      RETURNING *
    `;
    return row ? toStoredIntent(row) : undefined;
  }

  async expireDue(now: number): Promise<StoredIntent[]> {
    const actualNow = now / Math.max(1, config.TIME_SCALE ?? 1);
    const rows = await sql<IntentRow[]>`
      UPDATE intents SET state = 'expired', updated_at = ${now}
      WHERE state = 'open' AND deadline IS NOT NULL
        AND deadline::date <= (to_timestamp(${actualNow / 1000}) AT TIME ZONE 'UTC')::date
      RETURNING *
    `;
    return rows.map(toStoredIntent);
  }

  async listMine(ownerId: string): Promise<StoredIntent[]> {
    const rows = await sql<IntentRow[]>`
      SELECT * FROM intents WHERE user_id = ${ownerId} ORDER BY created_at DESC
    `;
    return rows.map(toStoredIntent);
  }

  async listOpen(): Promise<StoredIntent[]> {
    const rows = await sql<IntentRow[]>`SELECT * FROM intents WHERE state = 'open'`;
    return rows.map(toStoredIntent);
  }
}

export const intentRepository: IntentRepository = new PostgresIntentRepository();
