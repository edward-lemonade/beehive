import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getIntentRepository } from '../intents/service.js';
import { negotiationLog } from './log.js';
import { negotiateDirect } from './service.js';

const bodySchema = z.object({
  ownIntentId: z.string().min(1),
  targetIntentId: z.string().min(1),
  targetCents: z.number().int().nonnegative().optional(),
}).strict();

export const negotiationRouter = new Hono();
negotiationRouter.use('*', requireAuth);

negotiationRouter.post('/', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid request body' }, 400);
  const result = await negotiateDirect(c.get('user').id, parsed.data);
  switch (result.status) {
    case 'not_found': return c.json({ ok: false, error: 'Intent not found' }, 404);
    case 'forbidden': return c.json({ ok: false, error: 'Forbidden' }, 403);
    case 'not_relevant': return c.json({ ok: false, error: 'Target is not relevant to this intent' }, 403);
    default: return c.json({ ok: true, ...result });
  }
});

const HISTORY_LIMIT = 500;

// Past agent conversations for the caller, shaped like the live negotiation.round events.
negotiationRouter.get('/history', async (c) => {
  const userId = c.get('user').id;
  const repo = getIntentRepository();
  const mine = await repo.listMine(userId);
  const mineIds = new Set(mine.map((i) => i.id));
  const entries = await negotiationLog().forIntents([...mineIds], HISTORY_LIMIT);
  const known = new Map<string, { handle: string; text: string; gone?: boolean }>(mine.map((i) => [i.id, { handle: i.public.ownerHandle, text: i.public.freeText }]));
  const lookup = async (id: string): Promise<{ handle: string; text: string; gone?: boolean }> => {
    if (!known.has(id)) {
      const found = await repo.get(id);
      known.set(id, { handle: found?.public.ownerHandle ?? 'unknown', text: found?.public.freeText ?? '', gone: !found });
    }
    return known.get(id)!;
  };
  const rounds = [];
  for (const e of entries) {
    const [from, to] = [await lookup(e.from), await lookup(e.to)];
    if (from.gone || to.gone) continue;
    rounds.push({
      id: `${e.linkId}:${e.at}:${e.round}:${e.kind}:${e.from}`,
      at: e.at,
      round: e.round,
      kind: e.kind,
      amountCents: e.amountCents,
      text: e.text,
      fromIntentId: e.from,
      toIntentId: e.to,
      fromHandle: from.handle,
      toHandle: to.handle,
      fromText: from.text,
      toText: to.text,
      fromMine: mineIds.has(e.from),
      linkId: e.linkId,
    });
  }
  return c.json({ ok: true, rounds });
});
