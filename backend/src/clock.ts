import { config } from './config.js';

type TimerId = ReturnType<typeof setTimeout>;

const scale = Math.max(1, config.TIME_SCALE ?? 1);

export const clock = {
  now(): number {
    return Date.now() * scale;
  },

  after(simMs: number, fn: () => void): TimerId {
    const delayMs = Math.max(0, simMs / scale);
    return setTimeout(() => fn(), delayMs);
  },

  cancel(id: TimerId): void {
    clearTimeout(id);
  },
};

export default clock;
