import { afterEach, describe, expect, it } from 'vitest';
import { ChannelError, routeToUser, setChannelStore, setSmsSender, smsTextFor, switchChannel, savePhone, type ChannelStore } from '../src/channel/service.js';

function memoryStore(): ChannelStore {
  const users = new Map<string, { channel: 'app' | 'sms'; phone: string | null }>();
  const row = (id: string) => users.get(id) ?? users.set(id, { channel: 'app', phone: null }).get(id)!;
  return {
    get: async (id) => ({ ...row(id) }),
    setChannel: async (id, channel) => void (row(id).channel = channel),
    setPhone: async (id, phone) => void (row(id).phone = phone),
  };
}

afterEach(() => setChannelStore(undefined));

describe('channel toggle', () => {
  it('refuses sms without a phone', async () => {
    setChannelStore(memoryStore());
    await expect(switchChannel('u1', 'sms')).rejects.toBeInstanceOf(ChannelError);
    await expect(savePhone('u1', 'nope')).rejects.toBeInstanceOf(ChannelError);
  });

  it('sends on exactly one channel', async () => {
    setChannelStore(memoryStore())
    const sent: string[] = [];
    setSmsSender(async (phone, text) => void sent.push(`${phone}:${text}`));
    expect(await routeToUser('u1', 'hello')).toBe(true);
    expect(sent).toEqual([]);
    await savePhone('u1', '+1 555 010 0000');
    await switchChannel('u1', 'sms');
    expect(await routeToUser('u1', 'hello')).toBe(false);
    expect(sent).toEqual(['+1 555 010 0000:hello']);
    await switchChannel('u1', 'app');
    expect(await routeToUser('u1', 'again')).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('only texts kinds that need the user', () => {
    expect(smsTextFor('needs_user', { side: 'payer', amountCents: 30000, counterpartHandle: 'Bob' })).toContain('$300');
    expect(smsTextFor('near_miss', {})).toBeNull();
  });
});
