import { config } from './config.js';
const scale = Math.max(1, config.TIME_SCALE ?? 1);
export const clock = {
    now() {
        return Date.now() * scale;
    },
    after(simMs, fn) {
        const delayMs = Math.max(0, simMs / scale);
        return setTimeout(() => fn(), delayMs);
    },
    cancel(id) {
        clearTimeout(id);
    },
};
export default clock;
