import { listMine as listMineArrangements } from '../arrangements/service.js';
import { runAgentChat } from '../agent/chat.js';
import { listChat, saveChat } from '../agent/messages.js';
import { sql } from '../db/index.js';
import { Sentry } from '../observability/telemetry.js';
import { claimUnknownPhoneReply, findUserByVerifiedPhone, verifyLinkCode } from './linking.js';
import { normalizePhone } from './service.js';

const MAX_SMS_LENGTH = 320;
const BARE_DECISION = /^(yes|y|yeah|yep|no|n|nope)$/i;

export type PhotonMessage = {
  id?: string;
  platform?: string;
  status?: string;
  sentBy?: { id?: string; handle?: string };
  space?: { id?: string };
  content?: { type?: string; text?: string };
}

export type PhotonReply = (spaceId: string, userId: string | null, phone: string, text: string, sourceId: string) => Promise<void>;

function splitSms(text: string): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > MAX_SMS_LENGTH) {
    let splitAt = remaining.lastIndexOf(' ', MAX_SMS_LENGTH);
    if (splitAt < 100) splitAt = MAX_SMS_LENGTH;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

async function savePhotonConversation(
  userId: string,
  phone: string,
  photonUserId: string,
  spaceId: string,
  platform: 'sms' | 'imessage',
): Promise<void> {
  await sql`
    INSERT INTO photon_conversations (user_id, phone, photon_user_id, photon_space_id, platform, updated_at)
    VALUES (${userId}, ${phone}, ${photonUserId}, ${spaceId}, ${platform}, ${Date.now()})
    ON CONFLICT (user_id) DO UPDATE SET
      phone = EXCLUDED.phone,
      photon_user_id = EXCLUDED.photon_user_id,
      photon_space_id = EXCLUDED.photon_space_id,
      platform = EXCLUDED.platform,
      updated_at = EXCLUDED.updated_at
  `;
}

async function handleInbound(message: PhotonMessage, sendReply: PhotonReply): Promise<void> {
  const platform = message.platform;
  if (message.status !== 'received' || (platform !== 'sms' && platform !== 'imessage') || message.content?.type !== 'text') return;
  const rawPhone = message.sentBy?.handle;
  const phone = typeof rawPhone === 'string' ? normalizePhone(rawPhone) : null;
  const spaceId = message.space?.id;
  const senderId = message.sentBy?.id;
  const messageId = message.id;
  const textBody = message.content.text;
  if (!phone || !spaceId || !senderId || !messageId || typeof textBody !== 'string') return;

  const accepted = await sql`
    INSERT INTO sms_log (provider_id, phone, direction, body, created_at)
    VALUES (${messageId}, ${phone}, 'inbound', ${textBody}, ${Date.now()})
    ON CONFLICT (provider_id) DO UPDATE SET status = 'received'
    WHERE sms_log.status <> 'processed'
    RETURNING provider_id
  `;
  if (accepted.length === 0) return;

  const finish = async (userId: string | null, reply?: string): Promise<void> => {
    if (userId) await sql`UPDATE sms_log SET user_id = ${userId} WHERE provider_id = ${messageId}`;
    if (reply) await sendReply(spaceId, userId, phone, reply, messageId);
    await sql`UPDATE sms_log SET status = 'processed' WHERE provider_id = ${messageId}`;
  };

  try {
    const text = textBody.trim();
    const linkResult = await verifyLinkCode(phone, text);
    if (linkResult === 'linked') {
      const user = await findUserByVerifiedPhone(phone);
      if (!user) throw new Error('Phone was verified but its account could not be loaded');
      await savePhotonConversation(user.id, phone, senderId, spaceId, platform);
      const reply = 'Your phone is verified and SMS is on. Message me here to create a listing, review a deal, or manage your account. Reply HELP for tips or STOP to switch back to app chat.';
      await saveChat(user.id, { from: 'me', text, key: `sms:${messageId}:in` });
      await saveChat(user.id, { from: 'agent', text: reply, key: `sms:${messageId}:out` });
      await finish(user.id, reply);
      return;
    }
    if (linkResult === 'invalid') {
      await finish(null, 'That code is invalid or expired. Request a new link code in the app and text it here.');
      return;
    }

    const user = await findUserByVerifiedPhone(phone);
    if (!user) {
      if (await claimUnknownPhoneReply(phone)) {
        await finish(null, 'To connect your account, sign in to the platform, choose SMS in your agent chat, and text the 4-digit verification code to this number.');
      } else {
        await finish(null);
      }
      return;
    }
    await savePhotonConversation(user.id, phone, senderId, spaceId, platform);

    if (user.channel !== 'sms') {
      await finish(user.id);
      return;
    }

    const command = text.toUpperCase();
    if (command === 'STOP') {
      await sql`UPDATE users SET channel = 'app' WHERE id = ${user.id} AND phone_verified = true`;
      const reply = 'SMS is paused. Your agent is back in app chat.';
      await saveChat(user.id, { from: 'me', text, key: `sms:${messageId}:in` });
      await saveChat(user.id, { from: 'agent', text: reply, key: `sms:${messageId}:out` });
      await finish(user.id, reply);
      return;
    }
    if (command === 'HELP') {
      const reply = 'Text naturally to create a listing, answer your agent, or discuss a deal. Say YES only when you want to approve the deal being discussed. Reply STOP to switch back to app chat.';
      await saveChat(user.id, { from: 'me', text, key: `sms:${messageId}:in` });
      await saveChat(user.id, { from: 'agent', text: reply, key: `sms:${messageId}:out` });
      await finish(user.id, reply);
      return;
    }
    if (BARE_DECISION.test(text)) {
      const pending = (await listMineArrangements(user.id)).filter(({ terms }) =>
        terms.state === 'proposed' && (terms.approval === 'requested' || terms.approval === 'queued'));
      if (pending.length > 1) {
        const deals = pending.map(({ terms }, index) => {
          const handles = new Set([
            ...terms.gives.map(({ toHandle }) => toHandle),
            ...terms.gets.map(({ fromHandle }) => fromHandle),
          ]);
          return `#${index + 1}${handles.size ? ` with ${[...handles].map((handle) => `@${handle}`).join(', ')}` : ''}`;
        });
        const reply = `Several deals are open (${deals.join('; ')}). Which one do you mean?`;
        await saveChat(user.id, { from: 'me', text, key: `sms:${messageId}:in` });
        await saveChat(user.id, { from: 'agent', text: reply, key: `sms:${messageId}:out` });
        await finish(user.id, reply);
        return;
      }
    }

    const prior = await listChat(user.id);
    await saveChat(user.id, { from: 'me', text, key: `sms:${messageId}:in` });
    Sentry.setConversationId(user.id);
    Sentry.setUser({ id: user.id, username: user.handle });
    const result = await runAgentChat({
      user: { id: user.id, handle: user.handle, tier: user.tier },
      message: text,
      history: prior.slice(-16).map(({ from, text: line }) => ({ from, text: line })),
    });
    await saveChat(user.id, { from: 'agent', text: result.reply, key: `sms:${messageId}:out` });
    await finish(user.id, result.reply);
  } catch (error) {
    Sentry.captureException(error, { tags: { 'messaging.provider': 'photon', 'messaging.direction': 'inbound' } });
    console.error('Photon inbound message failed:', error instanceof Error ? error.message : error);
    await sql`UPDATE sms_log SET status = 'failed' WHERE provider_id = ${messageId}`;
    throw error;
  }
}

export async function receivePhotonMessage(message: PhotonMessage, sendReply: PhotonReply): Promise<void> {
  await handleInbound(message, sendReply);
}

export { splitSms };
