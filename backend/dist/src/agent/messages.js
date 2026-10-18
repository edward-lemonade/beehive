import { sql } from '../db/index.js';
import { logChatMessage } from '../observability/conversation.js';
const CAP = 300;
export async function listChat(userId) {
    const rows = await sql `
    SELECT * FROM (SELECT * FROM chat_messages WHERE user_id = ${userId} ORDER BY id DESC LIMIT ${CAP}) recent ORDER BY id`;
    return rows.map((r) => ({
        from: r.from_role,
        text: r.text,
        ...(r.key ? { key: r.key } : {}),
        ...(r.arrangement_id ? { arrangementId: r.arrangement_id } : {}),
        ...(r.suggest ? { suggest: r.suggest } : {}),
        at: Number(r.created_at),
    }));
}
export async function saveChat(userId, m) {
    const suggest = m.suggest ? JSON.stringify(m.suggest) : null;
    const inserted = await sql `
    WITH ins AS (
      INSERT INTO chat_messages (user_id, from_role, text, key, arrangement_id, suggest, created_at)
      VALUES (${userId}, ${m.from}, ${m.text}, ${m.key ?? null}, ${m.arrangementId ?? null}, ${suggest}::jsonb, ${Date.now()})
      ON CONFLICT DO NOTHING
      RETURNING user_id)
    SELECT u.handle FROM ins LEFT JOIN users u ON u.id = ins.user_id`;
    // Only a newly stored line goes to the transcript; replays of a keyed message are dropped by the conflict.
    if (inserted.length > 0)
        logChatMessage({ handle: inserted[0].handle, userId, from: m.from, text: m.text, key: m.key, arrangementId: m.arrangementId });
}
export async function clearChat(userId) {
    await sql `DELETE FROM chat_messages WHERE user_id = ${userId}`;
}
export async function clearChatsForUsers(userIds) {
    if (userIds.length === 0)
        return;
    await sql `DELETE FROM chat_messages WHERE user_id = ANY(${userIds}::uuid[])`;
}
