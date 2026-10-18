import { sql } from '../db/index.js';
import { clearForUsers } from '../arrangements/service.js';
import { clearChatsForUsers } from '../agent/messages.js';
import { confirmDraft, createDraft, deleteIntent, listMine } from '../intents/service.js';
import { events } from '../events.js';

/** Three people who only make a deal together: edward swaps his Saturday and Sunday tickets for dawg's 3-day ticket by selling them to kat. */
export const SEED_USERS = [
  { handle: 'edward', text: "I'm getting rid of my Saturday and Sunday tickets in exchange for a 3-day one" },
  { handle: 'kat', text: "I'm looking for Saturday and Sunday tickets!" },
  { handle: 'dawg', text: "I'm selling my 3-day ticket for $200" },
] as const;

export const SEED_SCENARIOS = [
  {
    id: 'ticket-swap',
    label: 'Original: three-way ticket swap',
    description: 'Edward swaps Saturday and Sunday tickets for a 3-day ticket through kat and dawg.',
    users: SEED_USERS,
  },
  {
    id: 'ticket-shopping',
    label: 'Ticket shopping: find a better deal',
    description: 'Edward needs a ticket. kat asks $100 firm; dawg asks $110 negotiable. Try dawg at $90.',
    users: [
      { handle: 'kat', text: "I'm selling a ticket for $100, non-negotiable." },
      { handle: 'dawg', text: "I'm selling a ticket for $110, negotiable." },
      { handle: 'edward', text: "I'm looking for a ticket." },
    ],
  },
] as const;

export const seedOptions = () => SEED_SCENARIOS.map(({ id, label, description }) => ({ id, label, description }));

function scenarioFor(id: string) {
  const scenario = SEED_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown seed dataset: ${id}`);
  return scenario;
}

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
export async function loadSeed(scenarioId = 'ticket-swap'): Promise<{ handles: string[] }> {
  const scenario = scenarioFor(scenarioId);
  const owners: Owner[] = [];
  for (const seed of scenario.users) owners.push(await findOwner(seed.handle));
  const ownerIds = owners.map((owner) => owner.id);
  await clearForUsers(ownerIds);
  await clearChatsForUsers(ownerIds);
  for (const userId of ownerIds) events.emit('chat.cleared', { userId });
  for (const owner of owners) {
    for (const intent of await listMine(owner.id)) await deleteIntent(intent.id, owner.id);
  }
  await postScenario(owners, scenarioId);
  return { handles: scenario.users.map((s) => s.handle) };
}

/** Owners line up with the selected scenario's users; the shopping scenario posts its buyer last. */
export async function postScenario(owners: Owner[], scenarioId = 'ticket-swap'): Promise<void> {
  const scenario = scenarioFor(scenarioId);
  if (owners.length !== scenario.users.length || scenario.users.some((seed, index) => owners[index]?.handle !== seed.handle)) {
    throw new Error('Seed owners must match the selected dataset in order');
  }
  for (const [index, seed] of scenario.users.entries()) {
    const owner = owners[index]!;
    const draft = await createDraft(owner.id, seed.text);
    if (draft.question) throw new Error(`Seed listing for ${seed.handle} was not understood`);
    await confirmDraft(draft.id, owner.id, { handle: owner.handle, tier: owner.tier, imageUrl: owner.imageUrl });
  }
}
