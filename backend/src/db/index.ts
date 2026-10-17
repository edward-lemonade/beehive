import postgres from 'postgres';
import { config } from '../config.js';

const sql = postgres(config.DATABASE_URL, { max: 10 });

export type UserRow = {
  id: string;
  clerk_id: string;
  handle: string;
  tier: string;
  phone: string | null;
  phone_verified: boolean;
};

export async function ensureUserForClerkId(
  clerkId: string,
  fallback: { handle: string; tier: string; phone: string | null; phoneVerified: boolean },
): Promise<UserRow | null> {
  const [row] = await sql<UserRow[]>`SELECT * FROM users WHERE clerk_id = ${clerkId} LIMIT 1`;
  if (row) return row;

  const [inserted] = await sql<UserRow[]>`
    INSERT INTO users (clerk_id, handle, tier, phone, phone_verified)
    VALUES (${clerkId}, ${fallback.handle}, ${fallback.tier}, ${fallback.phone}, ${fallback.phoneVerified})
    RETURNING *
  `;

  return inserted ?? null;
}
