import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { ChannelError, getSettings, savePhone, switchChannel } from './service.js';

export const channelRouter = new Hono();
channelRouter.use('*', requireAuth);

const view = (s: { channel: string; phone: string | null }) => ({ ok: true, channel: s.channel, phoneLinked: s.phone !== null, phoneTail: s.phone ? s.phone.slice(-4) : null });

channelRouter.get('/channel', async (c) => c.json(view(await getSettings(c.get('user').id))));

channelRouter.post('/channel', async (c) => {
  const parsed = z.object({ channel: z.enum(['app', 'sms']) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid request body' }, 400);
  try {
    return c.json(view(await switchChannel(c.get('user').id, parsed.data.channel)));
  } catch (error) {
    if (error instanceof ChannelError) return c.json({ ok: false, error: error.message }, error.status);
    throw error;
  }
});

channelRouter.post('/phone', async (c) => {
  const parsed = z.object({ phone: z.string() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ ok: false, error: 'Invalid request body' }, 400);
  try {
    const userId = c.get('user').id;
    await savePhone(userId, parsed.data.phone);
    return c.json(view(await getSettings(userId)));
  } catch (error) {
    if (error instanceof ChannelError) return c.json({ ok: false, error: error.message }, error.status);
    throw error;
  }
});
