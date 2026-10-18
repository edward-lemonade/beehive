export type Channel = 'app' | 'sms';

export type ChannelSettings = { channel: Channel; phone: string | null };

export interface ChannelStore {
  get(userId: string): Promise<ChannelSettings>;
  setChannel(userId: string, channel: Channel): Promise<void>;
  setPhone(userId: string, phone: string): Promise<void>;
}

export class ChannelError extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message);
  }
}

/** Sends text over SMS. The Photon adapter (slice 08) replaces the default console sender. */
export type SmsSender = (phone: string, text: string) => Promise<void>;

let store: ChannelStore | undefined;
let sender: SmsSender = async (phone, text) => {
  console.log(`[sms -> ${phone}] ${text}`);
};

export function setChannelStore(next: ChannelStore | undefined): void {
  store = next;
}
export function setSmsSender(next: SmsSender): void {
  sender = next;
}

async function getStore(): Promise<ChannelStore> {
  if (!store) store = (await import('./pg.js')).pgChannelStore;
  return store;
}

export const getSettings = async (userId: string): Promise<ChannelSettings> => (await getStore()).get(userId);

const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export async function savePhone(userId: string, raw: string): Promise<void> {
  const phone = raw.trim();
  if (!PHONE.test(phone)) throw new ChannelError('Enter a valid phone number', 400);
  await (await getStore()).setPhone(userId, phone);
}

export async function switchChannel(userId: string, channel: Channel): Promise<ChannelSettings> {
  const s = await getStore();
  const current = await s.get(userId);
  if (channel === 'sms' && !current.phone) throw new ChannelError('Add a phone number before switching to SMS', 409);
  await s.setChannel(userId, channel);
  return { ...current, channel };
}

/**
 * Delivers one agent message on the user's single active channel. Returns true when the app
 * stream should carry it, false when it was texted instead. Never both.
 */
export async function routeToUser(userId: string, smsText: string | null): Promise<boolean> {
  const current = await (await getStore()).get(userId).catch(() => ({ channel: 'app', phone: null }) as ChannelSettings);
  if (current.channel !== 'sms' || !current.phone) return true;
  if (smsText) await sender(current.phone, smsText).catch(() => {});
  return false;
}

const dollars = (cents: unknown): string => (typeof cents === 'number' ? `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}` : 'a price');

/** Short text for the notify kinds that need the user. Other kinds are not texted. */
export function smsTextFor(kind: string, payload: Record<string, unknown>): string | null {
  const who = typeof payload.counterpartHandle === 'string' ? payload.counterpartHandle : 'Another agent';
  switch (kind) {
    case 'approval_request': return 'I found a match that needs your approval. Open the app or reply here to review it.';
    case 'needs_user':
      return payload.side === 'receiver'
        ? `${who} offered ${dollars(payload.amountCents)}, below your ask. Want to take it? Reply with a price or NO.`
        : `${who} won't go below ${dollars(payload.amountCents)}. What's the most you'd pay? Reply with a price or NO.`;
    case 'committed': return 'Your arrangement is confirmed. Check the app for the checklist.';
    case 'dissolved': return 'An arrangement you approved fell through.';
    case 'nothing_found': return 'I found nothing yet. Try a better price and I will keep watching.';
    default: return null;
  }
}
