import postgres from 'postgres';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
    throw new Error('DATABASE_URL is required to initialize the database');
export const sql = postgres(databaseUrl, { max: 10 });
export async function ensureUserForClerkId(clerkId, fallback) {
    const [row] = await sql `
    INSERT INTO users (clerk_id, handle, tier, phone, phone_verified)
    VALUES (${clerkId}, ${fallback.handle}, ${fallback.tier}, ${fallback.phone}, ${fallback.phoneVerified})
    ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
    RETURNING *
  `;
    return row ?? null;
}
