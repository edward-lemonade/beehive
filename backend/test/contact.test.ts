import { describe, expect, it } from 'vitest';
import { normalizeContact } from '../src/channel/contact.js';

describe('normalizeContact', () => {
  it('accepts emails and phone numbers, rejects the rest', () => {
    expect(normalizeContact(' a@b.co ')).toBe('a@b.co');
    expect(normalizeContact('+1 (555) 010-0100')).toBe('+1 (555) 010-0100');
    expect(normalizeContact('hello')).toBeNull();
    expect(normalizeContact('12')).toBeNull();
  });
});
