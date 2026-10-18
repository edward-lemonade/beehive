import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { sql } from '../db/index.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()\-.]{7,20}$/;

export function normalizeContact(raw: string): string | null {
  const value = raw.trim();
  if (value.length > 120) return null;
  return EMAIL.test(value) || (PHONE.test(value) && value.replace(/\D/g, '').length >= 7) ? value : null;
}

export const contactRouter = new Hono();
contactRouter.use('*', requireAuth);

const view = (contact: string | null) => ({ ok: true, hasContact: contact !== null, contact });

contactRouter.get('/contact', async (c) => {
  const [row] = await sql<{ contact: string | null }[]>`SELECT contact FROM users WHERE id = ${c.get('user').id}`;
  return c.json(view(row?.contact ?? null));
});

contactRouter.post('/contact', async (c) => {
  const parsed = z.object({ contact: z.string() }).safeParse(await c.req.json().catch(() => null));
  const contact = parsed.success ? normalizeContact(parsed.data.contact) : null;
  if (!contact) return c.json({ ok: false, error: 'Enter a valid email address or phone number' }, 400);
  await sql`UPDATE users SET contact = ${contact} WHERE id = ${c.get('user').id}`;
  return c.json(view(contact));
});
