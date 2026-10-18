import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { receivePhotonMessage, splitSms, type PhotonMessage, type PhotonReply } from './inbound.js';
import { setSmsSender } from './service.js';

const API_ORIGIN = 'https://api.photon.codes';
const CURSOR_CONSUMER = 'la-hacks-backend';

type PhotonEvent = { id?: string; type?: string; data?: unknown };
type DeliveryMetadata = { seq?: number };

class RetryablePhotonError extends Error {}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function messageFromEvent(event: PhotonEvent): PhotonMessage | null {
  if (event.type !== 'message.received') return null;
  const data = asRecord(event.data);
  const nestedMessage = asRecord(data?.message);
  const raw = nestedMessage ?? data;
  if (!raw) return null;
  return raw as PhotonMessage;
}

async function sendText(
  spaceId: string,
  userId: string | null,
  phone: string,
  text: string,
  sourceId: string,
): Promise<void> {
  for (const [index, part] of splitSms(text).entries()) {
    const idempotencyKey = `${sourceId}:${index}`.replace(/[^!-~]/g, '_').slice(0, 255);
    let sentId: string | undefined;
    for (let attempt = 0; attempt < 3 && !sentId; attempt += 1) {
      try {
        const response = await fetch(`${API_ORIGIN}/v1/projects/${encodeURIComponent(config.PHOTON_PROJECT_ID)}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.PHOTON_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            content: { type: 'text', format: 'plain', text: part },
            senderId: config.PHOTON_SENDER_ID,
            spaceId,
          }),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          const ErrorType = response.status === 408 || response.status === 429 || response.status >= 500
            ? RetryablePhotonError
            : Error;
          throw new ErrorType(`Photon Beta send failed (${response.status}): ${detail}`);
        }
        const result = await response.json() as { id?: unknown };
        if (typeof result.id !== 'string') throw new Error('Photon Beta send did not return a message id');
        sentId = result.id;
      } catch (error) {
        if (attempt === 2 || !(error instanceof TypeError || error instanceof RetryablePhotonError)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    if (!sentId) throw new Error('Photon Beta send did not return a message id');
    await sql`
      INSERT INTO sms_log (provider_id, user_id, phone, direction, body, created_at, status)
      VALUES (${sentId}, ${userId}, ${phone}, 'outbound', ${part}, ${Date.now()}, 'processed')
      ON CONFLICT (provider_id) DO NOTHING
    `;
  }
}

async function saveCursor(seq: number): Promise<void> {
  await sql`
    INSERT INTO photon_event_cursors (consumer, seq, updated_at)
    VALUES (${CURSOR_CONSUMER}, ${seq}, ${Date.now()})
    ON CONFLICT (consumer) DO UPDATE SET
      seq = GREATEST(photon_event_cursors.seq, EXCLUDED.seq),
      updated_at = EXCLUDED.updated_at
  `;
}

export async function createPhotonAdapter(): Promise<{ stop(): Promise<void> }> {
  const [storedCursor] = await sql<{ seq: string }[]>`
    SELECT seq::text AS seq FROM photon_event_cursors WHERE consumer = ${CURSOR_CONSUMER}
  `;
  let cursor = storedCursor ? Number(storedCursor.seq) : 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Stored Photon Beta event cursor is invalid');

  const socket: Socket = io(API_ORIGIN, {
    path: `/v1/projects/${encodeURIComponent(config.PHOTON_PROJECT_ID)}/events/ws`,
    addTrailingSlash: false,
    transports: ['websocket'],
    extraHeaders: { Authorization: `Bearer ${config.PHOTON_API_KEY}` },
    autoConnect: false,
  });

  const sendReply: PhotonReply = (spaceId, userId, phone, text, sourceId) =>
    sendText(spaceId, userId, phone, text, sourceId);

  setSmsSender(async (phone, text, userId) => {
    if (!userId) throw new Error('Photon Beta outbound text requires a linked platform user');
    const [conversation] = await sql<{ photon_space_id: string; phone: string }[]>`
      SELECT photon_space_id, phone FROM photon_conversations WHERE user_id = ${userId}
    `;
    if (!conversation || conversation.phone !== phone) {
      throw new Error(`No Photon Beta conversation is linked for user ${userId}`);
    }
    await sendText(conversation.photon_space_id, userId, phone, text, randomUUID());
  });

  let generation = 0;
  let pending = 0;
  let queue = Promise.resolve();
  socket.on('connect', () => {
    socket.timeout(10_000).emit('subscribe', { startSeq: cursor }, (error: Error | null, result: { ok?: boolean; error?: { code?: string } }) => {
      if (error) {
        console.error('Photon Beta subscription timed out');
        socket.io.engine?.close();
      } else if (!result?.ok) {
        console.error('Photon Beta subscription rejected:', result?.error?.code ?? 'unknown error');
        socket.io.engine?.close();
      } else {
        console.info(`Subscribed to Photon Beta events at cursor ${cursor}`);
      }
    });
  });
  socket.on('disconnect', () => { generation += 1; });
  socket.on('connect_error', (error) => {
    console.error('Photon Beta connection failed:', error.message);
  });
  socket.on('delivery_error', (error: { code?: string; message?: string }) => {
    console.error('Photon Beta delivery error:', error.code ?? error.message ?? 'unknown error');
  });
  socket.on('delivery', (event: PhotonEvent, metadata: DeliveryMetadata) => {
    const currentGeneration = generation;
    const seq = metadata?.seq;
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
      console.error('Photon Beta delivered an invalid event cursor');
      socket.io.engine?.close();
      return;
    }
    if (++pending > 128) {
      pending -= 1;
      generation += 1;
      socket.io.engine?.close();
      return;
    }
    queue = queue.then(async () => {
      if (currentGeneration !== generation || seq <= cursor) return;
      const message = messageFromEvent(event);
      if (message) await receivePhotonMessage(message, sendReply);
      await saveCursor(seq);
      cursor = seq;
    }).catch((error: unknown) => {
      console.error('Photon Beta event processing failed:', error instanceof Error ? error.message : error);
      if (currentGeneration === generation) {
        generation += 1;
        socket.io.engine?.close();
      }
    }).finally(() => { pending -= 1; });
  });

  socket.connect();
  return {
    async stop(): Promise<void> {
      socket.disconnect();
      setSmsSender();
    },
  };
}
