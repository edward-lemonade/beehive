import { sql } from '../db/index.js';
import { config } from '../config.js';
export class OpenIntentLimitError extends Error {
    constructor() {
        super('Confirming this draft would exceed the limit of 10 open intents');
        this.name = 'OpenIntentLimitError';
    }
}
function toStoredIntent(row) {
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
export class PostgresIntentRepository {
    async createMany(records, maxOpen, draftId) {
        return sql.begin(async (tx) => {
            const ownerId = records[0]?.ownerId;
            if (!ownerId || records.some((record) => record.ownerId !== ownerId)) {
                throw new Error('A confirmation batch must have one owner');
            }
            if (records.some((record) => record.draftId !== draftId)) {
                throw new Error('A confirmation batch must match its draft');
            }
            const [owner] = await tx `
        SELECT id FROM users WHERE id = ${ownerId} FOR UPDATE
      `;
            if (!owner)
                throw new Error(`Cannot persist intents for missing user ${ownerId}`);
            const existing = await tx `
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
            const [count] = await tx `
        SELECT count(*)::int AS count FROM intents
        WHERE user_id = ${ownerId} AND state = 'open'
      `;
            if ((count?.count ?? 0) + records.length > maxOpen)
                throw new OpenIntentLimitError();
            for (const record of records) {
                await tx `
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
                await tx `
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
    async get(intentId) {
        const [row] = await sql `SELECT * FROM intents WHERE id = ${intentId} LIMIT 1`;
        return row ? toStoredIntent(row) : undefined;
    }
    async saveVersion(record, expectedVersion) {
        return sql.begin(async (tx) => {
            const [updated] = await tx `
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
            if (!updated)
                return false;
            await tx `
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
    async changeState(intentId, ownerId, expectedState, nextState, updatedAt) {
        const [row] = await sql `
      UPDATE intents SET state = ${nextState}, updated_at = ${updatedAt}
      WHERE id = ${intentId} AND user_id = ${ownerId} AND state = ${expectedState}
      RETURNING *
    `;
        return row ? toStoredIntent(row) : undefined;
    }
    async expireDue(now) {
        const actualNow = now / Math.max(1, config.TIME_SCALE ?? 1);
        const rows = await sql `
      UPDATE intents SET state = 'expired', updated_at = ${now}
      WHERE state = 'open' AND deadline IS NOT NULL
        AND deadline::date <= (to_timestamp(${actualNow / 1000}) AT TIME ZONE 'UTC')::date
      RETURNING *
    `;
        return rows.map(toStoredIntent);
    }
    async listMine(ownerId) {
        const rows = await sql `
      SELECT * FROM intents WHERE user_id = ${ownerId} ORDER BY created_at DESC
    `;
        return rows.map(toStoredIntent);
    }
    async listOpen() {
        const rows = await sql `SELECT * FROM intents WHERE state = 'open'`;
        return rows.map(toStoredIntent);
    }
}
export const intentRepository = new PostgresIntentRepository();
