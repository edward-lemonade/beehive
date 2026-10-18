import postgres from 'postgres';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
    throw new Error('DATABASE_URL is required to initialize the database');
// Call sites pass pre-stringified JSON with a ::jsonb cast. Without this, postgres.js stringifies again
// and stores a JSON string instead of an object.
export const sql = postgres(databaseUrl, {
    max: 10,
    types: {
        json: {
            to: 114,
            from: [114, 3802],
            serialize: (value) => (typeof value === 'string' ? value : JSON.stringify(value)),
            parse: (value) => JSON.parse(value),
        },
    },
});
export async function ensureUserForClerkId(clerkId, fallback) {
    const [row] = await sql `
    INSERT INTO users (clerk_id, handle, tier, phone, phone_verified)
    VALUES (${clerkId}, ${fallback.handle}, ${fallback.tier}, ${fallback.phone}, ${fallback.phoneVerified})
    ON CONFLICT (clerk_id) DO UPDATE SET clerk_id = EXCLUDED.clerk_id
    RETURNING *
  `;
    return row ?? null;
}
// Keeps the denormalized handle on the user's intents in step with the profile name.
export async function syncHandle(userId, handle) {
    await sql `UPDATE users SET handle = ${handle} WHERE id = ${userId}`;
    await sql `UPDATE intents SET "public" = jsonb_set("public", '{ownerHandle}', to_jsonb(${handle}::text)) WHERE user_id = ${userId}`;
}
