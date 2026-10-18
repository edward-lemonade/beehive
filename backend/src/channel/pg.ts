import { sql } from '../db/index.js';
import type { Channel, ChannelStore } from './service.js';

export const pgChannelStore: ChannelStore = {
  async get(userId) {
    const [row] = await sql<{ channel: Channel; phone: string | null; phone_verified: boolean }[]>`
      SELECT channel, phone, phone_verified FROM users WHERE id = ${userId}
    `;
    return { channel: row?.channel ?? 'app', phone: row?.phone ?? null, phoneVerified: row?.phone_verified ?? false };
  },
  async setChannel(userId, channel) {
    await sql`UPDATE users SET channel = ${channel} WHERE id = ${userId}`;
  },
  async setPhone(userId, phone) {
    await sql`
      UPDATE users SET phone = ${phone}, phone_verified = false, channel = 'app'
      WHERE id = ${userId}
    `;
    await sql`DELETE FROM phone_link_codes WHERE user_id = ${userId}`;
  },
};
