import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';

describe('config', () => {
  it('loads the typed config object', () => {
    expect(config).toMatchObject({
      CHANNEL: expect.any(String),
      TIME_SCALE: expect.any(Number),
    });
  });
});
