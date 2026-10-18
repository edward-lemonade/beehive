import { sql } from '../db/index.js';
import type { Channel, ChannelStore } from './service.js';

export const pgChannelStore: ChannelStore = {
  async get(userId) {
    const [row] = await sql<{ channel: Channel; phone: string | null }[]>`SELECT channel, phone FROM users WHERE id = ${userId}`;
    return { channel: row?.channel ?? 'app', phone: row?.phone ?? null };
  },
  async setChannel(userId, channel) {
    await sql`UPDATE users SET channel = ${channel} WHERE id = ${userId}`;
  },
  async setPhone(userId, phone) {
    await sql`UPDATE users SET phone = ${phone}, phone_verified = false WHERE id = ${userId}`;
  },
};
