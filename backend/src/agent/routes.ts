import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { runAgentChat } from './chat.js';

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000).optional(),
  event: z.record(z.string(), z.unknown()).optional(),
  history: z.array(z.object({ from: z.enum(['agent', 'me']), text: z.string().max(2000) })).max(40).default([]),
  draftId: z.string().nullish(),
}).refine((b) => b.message !== undefined || b.event !== undefined, 'message or event required');

export const agentRouter = new Hono();
agentRouter.use('*', requireAuth);

agentRouter.post('/chat', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid request body' }, 400);
  const user = c.get('user');
  try {
    const result = await runAgentChat({
      user: { id: user.id, handle: user.handle, tier: user.tier, imageUrl: user.imageUrl },
      ...(parsed.data.message !== undefined ? { message: parsed.data.message } : {}),
      ...(parsed.data.event !== undefined ? { event: parsed.data.event } : {}),
      history: parsed.data.history,
      draftId: parsed.data.draftId ?? null,
    });
    return c.json({ ok: true, ...result });
  } catch (error) {
    console.warn('Agent chat failed:', error instanceof Error ? error.message : error);
    return c.json({ ok: false, error: 'Your agent could not answer right now. Try again in a moment.' }, 502);
  }
});
