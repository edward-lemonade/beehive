import { afterEach, describe, expect, it } from 'vitest';
import { ChannelError, routeToUser, setChannelStore, setSmsSender, smsTextFor, switchChannel, savePhone, type ChannelStore } from '../src/channel/service.js';

function memoryStore(): ChannelStore & { verify(id: string): void } {
  const users = new Map<string, { channel: 'app' | 'sms'; phone: string | null; phoneVerified: boolean }>();
  const row = (id: string) => users.get(id) ?? users.set(id, { channel: 'app', phone: null, phoneVerified: false }).get(id)!;
  return {
    get: async (id) => ({ ...row(id) }),
    setChannel: async (id, channel) => void (row(id).channel = channel),
    setPhone: async (id, phone) => {
      row(id).phone = phone;
      row(id).phoneVerified = false;
    },
    verify: (id) => void (row(id).phoneVerified = true),
  };
}

afterEach(() => {
  setChannelStore(undefined);
  setSmsSender();
});

describe('channel toggle', () => {
  it('refuses sms without a phone', async () => {
    setChannelStore(memoryStore());
    await expect(switchChannel('u1', 'sms')).rejects.toBeInstanceOf(ChannelError);
    await expect(savePhone('u1', 'nope')).rejects.toBeInstanceOf(ChannelError);
  });

  it('sends on exactly one channel', async () => {
    const store = memoryStore();
    setChannelStore(store);
    const sent: string[] = [];
    setSmsSender(async (phone, text) => void sent.push(`${phone}:${text}`));
    expect(await routeToUser('u1', 'hello')).toBe(true);
    expect(sent).toEqual([]);
    await savePhone('u1', '+1 555 010 0000');
    await expect(switchChannel('u1', 'sms')).rejects.toBeInstanceOf(ChannelError);
    store.verify('u1');
    await switchChannel('u1', 'sms');
    expect(await routeToUser('u1', 'hello')).toBe(false);
    expect(sent).toEqual(['+15550100000:hello']);
    await switchChannel('u1', 'app');
    expect(await routeToUser('u1', 'again')).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('only texts kinds that need the user', () => {
    expect(smsTextFor('needs_user', { side: 'payer', amountCents: 30000, counterpartHandle: 'Bob' })).toContain('$300');
    expect(smsTextFor('near_miss', {})).toBeNull();
    expect(smsTextFor('approval_request', {
      terms: { gives: [{ item: { label: 'ticket' }, toHandle: 'Rae' }], gets: [], cashOut: [], cashIn: [] },
    })).toContain('Give ticket to @Rae');
    expect(smsTextFor('committed', {
      contacts: [{ handle: 'Rae', contact: 'rae@example.com' }],
    })).toContain('rae@example.com');
  });
});
