import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { routeToUser, smsTextFor } from '../channel/service.js';
import { saveChat } from '../agent/messages.js';
import { sseHub } from './hub.js';

let installed = false;

/** Forwards internal events to browsers: public feed changes to everyone, private activity to its owners. */
export function installSseBridge(): void {
  if (installed) return;
  installed = true;

  events.on('intent.opened', ({ intentId }) => sseHub.publishPublic({ type: 'intent.opened', payload: { intentId } }));
  events.on('intent.closed', ({ intentId }) => sseHub.publishPublic({ type: 'intent.closed', payload: { intentId } }));
  events.on('intent.updated', ({ intentId, privateOnly }) => {
    if (!privateOnly) sseHub.publishPublic({ type: 'intent.updated', payload: { intentId } });
  });

  events.on('notify', ({ userId, kind, payload }) => {
    void routeToUser(userId, smsTextFor(kind, payload ?? {})).then((viaApp) => {
      if (viaApp) sseHub.publishToUser(userId, { type: 'notify', payload: { kind, ...payload } });
    });
  });

  // Agent↔agent rounds are no longer pushed to browsers; they stream to Sentry Logs (observability/conversation.ts).
  events.on('negotiation.awaiting_user', (e) => {
    void (async () => {
      const repo = getIntentRepository();
      const [own, other] = await Promise.all([repo.get(e.intentId), repo.get(e.counterpartIntentId)]);
      if (!own) return;
      const arr = e.arrangementId ? await (await import('../arrangements/repository.js')).arrangementRepo().get(e.arrangementId) : undefined;
      const dealParts = (arr?.links ?? []).filter((l) => (l.a === e.intentId || l.b === e.intentId) && l.payer).length;
      events.emit('notify', {
        userId: own.ownerId,
        kind: 'needs_user',
        payload: { multi: dealParts > 1, side: e.side ?? 'payer', amountCents: e.amountCents, counterpartHandle: other?.public.ownerHandle ?? 'unknown', intentId: e.intentId, arrangementId: e.arrangementId },
      });
    })().catch(() => {});
  });

  // A counterparty's approval is written into the other users' stored chat, so it is there whether or not their page is open.
  events.on('arrangement.approved', ({ arrangementId, intentId }) => {
    void (async () => {
      const arr = await (await import('../arrangements/repository.js')).arrangementRepo().get(arrangementId);
      const approver = arr?.slots.find((s) => s.intentId === intentId);
      if (!arr || !approver) return;
      const repo = getIntentRepository();
      const handle = (await repo.get(intentId))?.public.ownerHandle ?? 'The other user';
      const direct = new Set(arr.links.flatMap((l) => (l.a === intentId ? [l.b] : l.b === intentId ? [l.a] : [])));
      for (const slot of arr.slots.filter((s) => direct.has(s.intentId))) {
        await saveChat(slot.userId, { from: 'agent', text: `${handle} approved their side of the deal.`, key: `approved:${arrangementId}:${intentId}:${arr.revision}`, arrangementId });
        sseHub.publishToUser(slot.userId, { type: 'chat.message', payload: { arrangementId } });
      }
    })().catch(() => {});
  });

  for (const name of ['arrangement.proposed', 'arrangement.updated', 'arrangement.committed', 'arrangement.dissolved', 'slot.vacated'] as const) {
    events.on(name, (payload) => {
      void (async () => {
        const arr = await (await import('../arrangements/repository.js')).arrangementRepo().get(payload.arrangementId);
        for (const slot of arr?.slots ?? []) {
          sseHub.publishToUser(slot.userId, { type: name, payload: { arrangementId: payload.arrangementId } });
        }
      })().catch(() => {});
    });
  }
}
