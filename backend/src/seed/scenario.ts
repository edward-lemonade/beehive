import { sql } from '../db/index.js';
import { confirmDraft, createDraft, deleteIntent, listMine } from '../intents/service.js';

/** Three people who only make a deal together: edward swaps his Saturday and Sunday tickets for dawg's 3-day ticket by selling them to acmm. */
export const SEED_USERS = [
  { handle: 'edward', text: "I'm getting rid of my Saturday and Sunday tickets in exchange for a 3-day one" },
  { handle: 'acmm', text: "I'm looking for Saturday and Sunday tickets!" },
  { handle: 'dawg', text: "I'm selling my 3-day ticket for $200" },
] as const;

export type Owner = { id: string; handle: string; tier: string; imageUrl?: string | null };

/** The seed listings belong to the real accounts with these handles, so they show up in each person's own intents. */
async function findOwner(handle: string): Promise<Owner> {
  const rows = await sql<{ id: string; clerk_id: string; handle: string; tier: string }[]>`
    SELECT id, clerk_id, handle, tier FROM users WHERE handle = ${handle} AND clerk_id NOT LIKE 'seed\_%'`;
  if (rows.length === 0) throw new Error(`No account with the handle "${handle}". Sign in once as ${handle} first so the seed can post as them.`);
  const row = rows[0]!;
  const { clerkProfile } = await import('../auth.js');
  const profile = await clerkProfile(row.clerk_id);
  return { id: row.id, handle: row.handle, tier: row.tier, imageUrl: profile.imageUrl };
}

/** Replaces these users' listings with the scenario, posted in order so the last one triggers the match. */
export async function loadSeed(): Promise<{ handles: string[] }> {
  const owners: Owner[] = [];
  for (const seed of SEED_USERS) owners.push(await findOwner(seed.handle));
  for (const owner of owners) {
    for (const intent of await listMine(owner.id)) await deleteIntent(intent.id, owner.id);
  }
  await postScenario(owners);
  return { handles: SEED_USERS.map((s) => s.handle) };
}

/** Posts each scenario listing as its owner, in order. Owners line up with SEED_USERS. */
export async function postScenario(owners: Owner[]): Promise<void> {
  for (const [index, seed] of SEED_USERS.entries()) {
    const owner = owners[index]!;
    const draft = await createDraft(owner.id, seed.text);
    if (draft.question) throw new Error(`Seed listing for ${seed.handle} was not understood`);
    await confirmDraft(draft.id, owner.id, { handle: owner.handle, tier: owner.tier, imageUrl: owner.imageUrl });
  }
}
