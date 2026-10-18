import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { routeToUser, smsTextFor } from '../channel/service.js';
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

  events.on('negotiation.round', (round) => {
    void (async () => {
      const repo = getIntentRepository();
      const [from, to] = await Promise.all([round.fromIntentId ? repo.get(round.fromIntentId) : undefined, round.toIntentId ? repo.get(round.toIntentId) : undefined]);
      for (const userId of new Set([from?.ownerId, to?.ownerId].filter((id): id is string => !!id))) {
        sseHub.publishToUser(userId, {
          type: 'negotiation.round',
          payload: {
            round: round.round,
            kind: round.kind,
            amountCents: round.amountCents ?? null,
            text: round.text ?? null,
            fromIntentId: round.fromIntentId,
            toIntentId: round.toIntentId,
            fromHandle: from?.public.ownerHandle ?? 'unknown',
            toHandle: to?.public.ownerHandle ?? 'unknown',
            fromText: from?.public.freeText ?? '',
            toText: to?.public.freeText ?? '',
            fromMine: from?.ownerId === userId,
            linkId: round.linkId,
          },
        });
      }
    })().catch(() => {});
  });

  events.on('negotiation.awaiting_user', (e) => {
    void (async () => {
      const repo = getIntentRepository();
      const [own, other] = await Promise.all([repo.get(e.intentId), repo.get(e.counterpartIntentId)]);
      if (!own) return;
      events.emit('notify', {
        userId: own.ownerId,
        kind: 'needs_user',
        payload: { side: e.side ?? 'payer', amountCents: e.amountCents, counterpartHandle: other?.public.ownerHandle ?? 'unknown', intentId: e.intentId, arrangementId: e.arrangementId },
      });
    })().catch(() => {});
  });

  for (const name of ['arrangement.proposed', 'arrangement.committed', 'arrangement.dissolved', 'slot.vacated'] as const) {
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
