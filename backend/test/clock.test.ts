import { describe, expect, it } from 'vitest';
import { clock } from '../src/clock.js';

describe('clock', () => {
  it('returns a positive timestamp', () => {
    expect(clock.now()).toBeGreaterThan(0);
  });

  it('schedules a callback after simulated delay', async () => {
    let fired = false;
    const id = clock.after(10, () => {
      fired = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    clock.cancel(id);
    expect(fired).toBe(true);
  });
});
