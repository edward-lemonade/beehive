import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
function realDatabaseUrl() {
    const file = resolve(__dirname, '../.env');
    if (!existsSync(file))
        return undefined;
    const line = readFileSync(file, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('DATABASE_URL='));
    return line?.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
const url = realDatabaseUrl();
let reachable = false;
let sqlClient;
let repo;
beforeAll(async () => {
    if (!url)
        return;
    process.env.DATABASE_URL = url;
    try {
        ({ sql: sqlClient } = await import('../src/db/index.js'));
        await sqlClient `SELECT 1 FROM arrangements LIMIT 1`;
        const mod = await import('../src/arrangements/repository.js');
        repo = new mod.PostgresArrangementRepository();
        reachable = true;
    }
    catch {
        reachable = false;
    }
});
const userIds = [];
const intentIds = [];
const arrangementIds = [];
afterAll(async () => {
    if (!reachable)
        return;
    if (arrangementIds.length)
        await sqlClient `DELETE FROM arrangements WHERE id IN ${sqlClient(arrangementIds)}`;
    if (intentIds.length)
        await sqlClient `DELETE FROM intents WHERE id IN ${sqlClient(intentIds)}`;
    if (userIds.length)
        await sqlClient `DELETE FROM users WHERE id IN ${sqlClient(userIds)}`;
    await sqlClient.end();
});
describe('postgres commit concurrency', () => {
    it('commits only disjoint arrangements and never deadlocks', async (ctx) => {
        if (!reachable)
            return ctx.skip();
        const now = Date.now();
        const tag = randomUUID().slice(0, 8);
        const n = 8;
        const intents = [];
        for (let i = 0; i < n; i += 1) {
            const [user] = await sqlClient `
        INSERT INTO users (clerk_id, handle, tier) VALUES (${`pgtest_${tag}_${i}`}, ${`pgtest${i}`}, 'new') RETURNING id`;
            const id = randomUUID();
            userIds.push(user.id);
            intentIds.push(id);
            intents.push({ id, userId: user.id });
            await sqlClient `
        INSERT INTO intents (id, draft_id, user_id, version, state, "public", "private", source_text, parsed, created_at, updated_at)
        VALUES (${id}, ${randomUUID()}, ${user.id}, 0, 'open', ${sqlClient.json({})}, ${sqlClient.json({})}, 'x', ${sqlClient.json({})}, ${now}, ${now})`;
        }
        const arrangements = [];
        for (let i = 0; i < 20; i += 1) {
            const members = [intents[i % n], intents[(i + 1) % n], intents[(i * 3 + 2) % n]].filter((m, idx, all) => all.findIndex((o) => o.id === m.id) === idx);
            const id = randomUUID();
            arrangementIds.push(id);
            const a = {
                id,
                key: `pgtest-${tag}-${i}`,
                state: 'proposed',
                revision: 1,
                reason: null,
                excluded: [],
                declaredNet: {},
                replaceDeadline: null,
                createdAt: now,
                updatedAt: now,
                links: [],
                slots: members.map((m) => ({
                    intentId: m.id,
                    userId: m.userId,
                    intentVersion: 0,
                    approval: 'approved',
                    termsHash: 'h',
                    approvedNetCents: 0,
                    requestedAt: now,
                    decidedAt: now,
                })),
            };
            expect(await repo.save(a)).toBe('ok');
            arrangements.push(a);
        }
        const results = await Promise.all(arrangements.map((a) => repo.commit({ arrangementId: a.id, expectedRevision: 1, now: Date.now() })));
        const committed = arrangements.filter((_, i) => results[i].ok);
        expect(committed.length).toBeGreaterThan(0);
        const used = committed.flatMap((a) => a.slots.map((s) => s.intentId));
        expect(new Set(used).size).toBe(used.length);
        const rows = await sqlClient `
      SELECT id, state FROM arrangements WHERE id IN ${sqlClient(arrangements.map((a) => a.id))}`;
        const state = new Map(rows.map((r) => [r.id, r.state]));
        for (const a of arrangements) {
            const overlaps = a.slots.some((s) => used.includes(s.intentId));
            if (overlaps)
                expect(['committed', 'dissolved']).toContain(state.get(a.id));
        }
        const done = await sqlClient `
      SELECT id FROM intents WHERE id IN ${sqlClient(used)} AND state = 'done'`;
        expect(done.length).toBe(used.length);
    }, 30_000);
});
