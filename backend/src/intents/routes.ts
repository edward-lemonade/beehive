import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import {
  answerDraft,
  confirmDraft,
  createDraft,
  editIntent,
  getOwnedDraft,
  IntentServiceError,
  listMine,
  listPublicIntents,
  reopenIntent,
  deleteIntent,
  withdrawIntent,
} from './service.js';

const draftInputSchema = z.object({ text: z.string().trim().min(1) });
const answerInputSchema = z.object({ text: z.string().trim().min(1) });
const editInputSchema = z.object({ text: z.string().trim().min(1) });

function failure(error: unknown, c: Context) {
  if (error instanceof IntentServiceError) {
    return c.json({ ok: false, error: error.message }, error.status);
  }
  throw error;
}

export const intentsRouter = new Hono();
intentsRouter.use('*', requireAuth);

intentsRouter.post('/draft', async (c) => {
  const body = draftInputSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ ok: false, error: 'Invalid draft input' }, 400);

  const user = c.get('user');
  try {
    const draft = await createDraft(user.id, body.data.text, 'web');
    return c.json({ ok: true, draft });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.post('/draft/:id/answer', async (c) => {
  const body = answerInputSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ ok: false, error: 'Invalid answer payload' }, 400);

  try {
    const draft = await answerDraft(c.req.param('id'), body.data.text, c.get('user').id);
    return c.json({ ok: true, draft });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.post('/draft/:id/confirm', async (c) => {
  const user = c.get('user');
  try {
    getOwnedDraft(c.req.param('id'), user.id);
    const confirmed = await confirmDraft(c.req.param('id'), user.id, { handle: user.handle, tier: user.tier, imageUrl: user.imageUrl });
    return c.json({ ok: true, intents: confirmed.map((intent) => ({
      id: intent.id,
      version: intent.version,
      state: intent.state,
      public: intent.public,
      private: intent.private,
    })) });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.patch('/:id', async (c) => {
  const body = editInputSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ ok: false, error: 'Invalid edit input' }, 400);

  try {
    const user = c.get('user');
    const intent = await editIntent(c.req.param('id'), user.id, body.data.text);
    return c.json({ ok: true, intent: {
      id: intent.id,
      version: intent.version,
      state: intent.state,
      public: intent.public,
      private: intent.private,
    } });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.post('/:id/withdraw', async (c) => {
  try {
    await withdrawIntent(c.req.param('id'), c.get('user').id);
    return c.json({ ok: true });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.delete('/:id', async (c) => {
  try {
    await deleteIntent(c.req.param('id'), c.get('user').id);
    return c.json({ ok: true });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.post('/:id/reopen', async (c) => {
  const user = c.get('user');
  try {
    const draft = await reopenIntent(c.req.param('id'), user.id);
    return c.json({ ok: true, draft });
  } catch (error) {
    return failure(error, c);
  }
});

intentsRouter.get('/mine', async (c) => {
  const mine = (await listMine(c.get('user').id)).map((intent) => ({
    id: intent.id,
    version: intent.version,
    state: intent.state,
    public: intent.public,
    private: intent.private,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  }));
  return c.json({ ok: true, intents: mine });
});

export const publicMapRouter = new Hono();
publicMapRouter.use('*', requireAuth);
publicMapRouter.get('/intents', async (c) =>
  c.json({ ok: true, intents: await listPublicIntents() }));
