import { sql } from '../db/index.js';

export type ContactLookup = (userIds: string[]) => Promise<Map<string, string | null>>;

const fromDatabase: ContactLookup = async (userIds) => {
  const rows = userIds.length === 0
    ? []
    : await sql<{ id: string; phone: string | null }[]>`SELECT id, phone FROM users WHERE id = ANY(${userIds}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.phone] as const));
};

let lookup: ContactLookup = fromDatabase;

export const contactsFor = (userIds: string[]): Promise<Map<string, string | null>> => lookup(userIds);

export function setContactLookup(next?: ContactLookup): void {
  lookup = next ?? fromDatabase;
}
