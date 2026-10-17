import postgres from 'postgres';
import { config } from '../config.js';
const sql = postgres(config.DATABASE_URL, { max: 10 });
export async function ensureUserForClerkId(clerkId, fallback) {
    const [row] = await sql `SELECT * FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
    if (row)
        return row;
    const [inserted] = await sql `
    INSERT INTO users (clerk_id, handle, tier, phone, phone_verified)
    VALUES (${clerkId}, ${fallback.handle}, ${fallback.tier}, ${fallback.phone}, ${fallback.phoneVerified})
    RETURNING *
  `;
    return inserted ?? null;
}
