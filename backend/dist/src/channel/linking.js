import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { sql } from '../db/index.js';
import { config } from '../config.js';
import { normalizePhone } from './service.js';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const hashCode = (code) => createHash('sha256').update(code).digest('hex');
const matchesCode = (code, expectedHash) => {
    const actual = Buffer.from(hashCode(code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
};
export class PhoneLinkError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export async function createLinkCode(userId) {
    const [user] = await sql `SELECT phone FROM users WHERE id = ${userId}`;
    if (!user?.phone)
        throw new PhoneLinkError('Add a phone number before requesting a link code', 409);
    if (!config.PHOTON_PHONE_NUMBER)
        throw new Error('PHOTON_PHONE_NUMBER is required to link a phone');
    const [alreadyLinked] = await sql `
    SELECT id FROM users WHERE phone = ${user.phone} AND phone_verified = true AND id <> ${userId} LIMIT 1
  `;
    if (alreadyLinked)
        throw new PhoneLinkError('That phone number is already linked to another account', 409);
    const code = String(randomInt(1000, 10_000));
    try {
        await sql `
      INSERT INTO phone_link_codes (user_id, phone, code_hash, expires_at, attempts, created_at)
      VALUES (${userId}, ${user.phone}, ${hashCode(code)}, ${Date.now() + CODE_TTL_MS}, 0, ${Date.now()})
      ON CONFLICT (user_id) DO UPDATE SET
        phone = EXCLUDED.phone,
        code_hash = EXCLUDED.code_hash,
        expires_at = EXCLUDED.expires_at,
        attempts = 0,
        created_at = EXCLUDED.created_at
    `;
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
            throw new PhoneLinkError('That phone number is already being linked to another account', 409);
        }
        throw error;
    }
    return { code, phoneNumber: config.PHOTON_PHONE_NUMBER };
}
export async function verifyLinkCode(phoneInput, text) {
    const phone = normalizePhone(phoneInput);
    if (!phone)
        return 'not_pending';
    const code = text.trim();
    return sql.begin(async (tx) => {
        const [pending] = await tx `
      SELECT user_id, code_hash, expires_at, attempts
      FROM phone_link_codes WHERE phone = ${phone}
      FOR UPDATE
    `;
        if (!pending)
            return 'not_pending';
        if (pending.expires_at <= Date.now() || pending.attempts >= MAX_ATTEMPTS) {
            await tx `DELETE FROM phone_link_codes WHERE user_id = ${pending.user_id}`;
            return 'invalid';
        }
        if (!/^\d{4}$/.test(code) || !matchesCode(code, pending.code_hash)) {
            await tx `UPDATE phone_link_codes SET attempts = attempts + 1 WHERE user_id = ${pending.user_id}`;
            return 'invalid';
        }
        const [alreadyLinked] = await tx `
      SELECT id FROM users WHERE phone = ${phone} AND phone_verified = true AND id <> ${pending.user_id} LIMIT 1
    `;
        if (alreadyLinked) {
            await tx `DELETE FROM phone_link_codes WHERE user_id = ${pending.user_id}`;
            return 'invalid';
        }
        const linked = await tx `
      UPDATE users SET phone_verified = true, channel = 'sms'
      WHERE id = ${pending.user_id} AND phone = ${phone}
    `;
        if (linked.count !== 1)
            return 'invalid';
        await tx `DELETE FROM phone_link_codes WHERE user_id = ${pending.user_id}`;
        return 'linked';
    });
}
export async function claimUnknownPhoneReply(phoneInput) {
    const phone = normalizePhone(phoneInput);
    if (!phone)
        return false;
    const claimed = await sql `
    INSERT INTO unknown_phone_replies (phone, created_at)
    VALUES (${phone}, ${Date.now()})
    ON CONFLICT (phone) DO NOTHING
    RETURNING phone
  `;
    return claimed.length > 0;
}
export async function findUserByVerifiedPhone(phoneInput) {
    const phone = normalizePhone(phoneInput);
    if (!phone)
        return null;
    const [user] = await sql `
    SELECT id, handle, tier, channel, phone FROM users
    WHERE phone = ${phone} AND phone_verified = true
    LIMIT 1
  `;
    return user ?? null;
}
