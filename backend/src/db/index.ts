import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to initialize the database');

// Call sites pass pre-stringified JSON with a ::jsonb cast. Without this, postgres.js stringifies again
// and stores a JSON string instead of an object.
export const sql = postgres(databaseUrl, {
  max: 10,
  types: {
    json: {
      to: 114,
      from: [114, 3802],
      serialize: (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value)),
      parse: (value: string) => JSON.parse(value) as unknown,
    },
  },
});

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

// Keeps the denormalized handle on the user's intents in step with the profile name.
export async function syncHandle(userId: string, handle: string): Promise<void> {
  await sql`UPDATE users SET handle = ${handle} WHERE id = ${userId}`;
  await sql`UPDATE intents SET "public" = jsonb_set("public", '{ownerHandle}', to_jsonb(${handle}::text)) WHERE user_id = ${userId}`;
}
