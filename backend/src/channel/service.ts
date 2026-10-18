export type Channel = 'app' | 'sms';

export type ChannelSettings = { channel: Channel; phone: string | null; phoneVerified: boolean };

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

/** Sends text over the active messaging provider. */
export type SmsSender = (phone: string, text: string, userId?: string) => Promise<void>;

let store: ChannelStore | undefined;
let sender: SmsSender = async (phone, text) => {
  console.log(`[sms -> ${phone}] ${text}`);
};

export function setChannelStore(next: ChannelStore | undefined): void {
  store = next;
}
export function setSmsSender(next?: SmsSender): void {
  sender = next ?? (async (phone, text) => {
    console.log(`[sms -> ${phone}] ${text}`);
  });
}

async function getStore(): Promise<ChannelStore> {
  if (!store) store = (await import('./pg.js')).pgChannelStore;
  return store;
}

export const getSettings = async (userId: string): Promise<ChannelSettings> => (await getStore()).get(userId);

export function normalizePhone(raw: string): string | null {
  const value = raw.trim();
  if (!/^\+?[0-9 ()-]{7,20}$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return value.startsWith('+') && digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

export async function savePhone(userId: string, raw: string): Promise<void> {
  const phone = normalizePhone(raw);
  if (!phone) throw new ChannelError('Enter a valid phone number, including its country code', 400);
  await (await getStore()).setPhone(userId, phone);
}

export async function switchChannel(userId: string, channel: Channel): Promise<ChannelSettings> {
  const s = await getStore();
  const current = await s.get(userId);
  if (channel === 'sms' && (!current.phone || !current.phoneVerified)) {
    throw new ChannelError('Verify your phone number before switching to SMS', 409);
  }
  await s.setChannel(userId, channel);
  return { ...current, channel };
}

/**
 * Delivers one agent message on the user's single active channel. Returns true when the app
 * stream should carry it, false when it was texted instead. Never both.
 */
export async function routeToUser(userId: string, smsText: string | null, dedupeKey?: string): Promise<boolean> {
  const current = await (await getStore()).get(userId);
  if (current.channel !== 'sms' || !current.phone || !current.phoneVerified) return true;
  if (smsText) {
    if (dedupeKey) {
      const { sql } = await import('../db/index.js');
      const claimed = await sql`
        INSERT INTO sms_notification_dedupe (user_id, notification_key, created_at)
        VALUES (${userId}, ${dedupeKey}, ${Date.now()})
        ON CONFLICT (user_id, notification_key) DO NOTHING
        RETURNING notification_key
      `;
      if (claimed.length === 0) return false;
    }
    try {
      await sender(current.phone, smsText, userId);
    } catch (error) {
      if (dedupeKey) {
        const { sql } = await import('../db/index.js');
        await sql`DELETE FROM sms_notification_dedupe WHERE user_id = ${userId} AND notification_key = ${dedupeKey}`;
      }
      throw error;
    }
  }
  return false;
}

const dollars = (cents: unknown): string => (typeof cents === 'number' ? `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}` : 'a price');

const itemNames = (items: unknown): string => Array.isArray(items)
  ? items.map((entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const item = entry as { item?: { label?: unknown }; toHandle?: unknown; fromHandle?: unknown };
    const label = typeof item.item?.label === 'string' ? item.item.label : '';
    const handle = typeof item.toHandle === 'string' ? ` to @${item.toHandle}` : typeof item.fromHandle === 'string' ? ` from @${item.fromHandle}` : '';
    return `${label}${handle}`;
  }).filter(Boolean).join(', ')
  : '';

/** Short, actionable text for notifications the SMS user can resolve conversationally. */
export function smsTextFor(kind: string, payload: Record<string, unknown>): string | null {
  const who = typeof payload.counterpartHandle === 'string' ? payload.counterpartHandle : 'Another agent';
  switch (kind) {
    case 'approval_request': {
      const terms = payload.terms && typeof payload.terms === 'object'
        ? payload.terms as Record<string, unknown>
        : {};
      const gives = itemNames(terms.gives);
      const gets = itemNames(terms.gets);
      const out = Array.isArray(terms.cashOut) ? terms.cashOut as Array<{ toHandle?: unknown; amountCents?: unknown }> : [];
      const incoming = Array.isArray(terms.cashIn) ? terms.cashIn as Array<{ fromHandle?: unknown; amountCents?: unknown }> : [];
      const cash = [
        ...out.map((entry) => `pay ${dollars(entry.amountCents)} to @${String(entry.toHandle ?? 'counterparty')}`),
        ...incoming.map((entry) => `get ${dollars(entry.amountCents)} from @${String(entry.fromHandle ?? 'counterparty')}`),
      ];
      const details = [
        gives ? `Give ${gives}` : '',
        gets ? `get ${gets}` : '',
        ...cash,
      ].filter(Boolean).join('; ');
      return `A deal needs your approval${details ? `: ${details}` : ''}. Reply YES to approve or NO to pass; ask me if you want to review details.`;
    }
    case 'needs_user':
      return payload.side === 'receiver'
        ? `${who} offered ${dollars(payload.amountCents)}, below your ask. Want to take it? Reply with a price or NO.`
        : `${who} won't go below ${dollars(payload.amountCents)}. What's the most you'd pay? Reply with a price or NO.`;
    case 'committed': {
      const contacts = Array.isArray(payload.contacts)
        ? (payload.contacts as Array<{ handle?: unknown; contact?: unknown }>)
          .filter((entry) => typeof entry.handle === 'string' && typeof entry.contact === 'string')
          .map((entry) => `@${entry.handle}: ${entry.contact}`)
        : [];
      return `Your arrangement is confirmed.${contacts.length ? ` Contact${contacts.length === 1 ? '' : 's'}: ${contacts.join('; ')}.` : ' No counterpart contact is on file; open the app to follow up.'}`;
    }
    case 'dissolved': return 'An arrangement you approved fell through.';
    case 'nothing_found': return 'I found nothing yet. Try a better price and I will keep watching.';
    default: return null;
  }
}
