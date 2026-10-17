import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to initialize the database');

export const sql = postgres(databaseUrl, { max: 10 });

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
  const [row] = await sql<UserRow[]>`
    INSERT INTO users (clerk_id, handle, tier, phone, phone_verified)
    VALUES (${clerkId}, ${fallback.handle}, ${fallback.tier}, ${fallback.phone}, ${fallback.phoneVerified})
    ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
    RETURNING *
  `;

  return row ?? null;
}
