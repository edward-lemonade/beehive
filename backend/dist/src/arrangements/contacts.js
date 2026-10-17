import { sql } from '../db/index.js';
const fromDatabase = async (userIds) => {
    const rows = userIds.length === 0
        ? []
        : await sql `SELECT id, phone FROM users WHERE id = ANY(${userIds}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.phone]));
};
let lookup = fromDatabase;
export const contactsFor = (userIds) => lookup(userIds);
export function setContactLookup(next) {
    lookup = next ?? fromDatabase;
}
