import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { Sentry } from '../observability/telemetry.js';
import { runAgentChat } from './chat.js';
import { clearChat, listChat, saveChat } from './messages.js';
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
    if (!parsed.success)
        return c.json({ ok: false, error: 'Invalid request body' }, 400);
    const user = c.get('user');
    // Groups every chat turn of this user into one conversation in Sentry's AI Agents view.
    Sentry.setConversationId(user.id);
    try {
        const result = await runAgentChat({
            user: { id: user.id, handle: user.handle, tier: user.tier, imageUrl: user.imageUrl },
            ...(parsed.data.message !== undefined ? { message: parsed.data.message } : {}),
            ...(parsed.data.event !== undefined ? { event: parsed.data.event } : {}),
            history: parsed.data.history,
            draftId: parsed.data.draftId ?? null,
        });
        return c.json({ ok: true, ...result });
    }
    catch (error) {
        console.warn('Agent chat failed:', error instanceof Error ? error.message : error);
        Sentry.captureException(error, { tags: { 'gen_ai.agent.name': 'trade-agent-chat' } });
        return c.json({ ok: false, error: 'Your agent could not answer right now. Try again in a moment.' }, 502);
    }
});
const messageSchema = z.object({
    from: z.enum(['agent', 'me']),
    text: z.string().min(1).max(4000),
    key: z.string().max(200).optional(),
    arrangementId: z.string().max(100).optional(),
    suggest: z.object({ arrangementId: z.string(), cents: z.number().int() }).optional(),
});
agentRouter.get('/messages', async (c) => c.json({ ok: true, messages: await listChat(c.get('user').id) }));
agentRouter.post('/messages', async (c) => {
    const parsed = messageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
        return c.json({ ok: false, error: 'Invalid request body' }, 400);
    const { suggest, ...rest } = parsed.data;
    await saveChat(c.get('user').id, { ...rest, ...(suggest ? { suggest } : {}) });
    return c.json({ ok: true });
});
agentRouter.delete('/messages', async (c) => {
    await clearChat(c.get('user').id);
    return c.json({ ok: true });
});
