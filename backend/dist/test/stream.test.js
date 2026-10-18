import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import { sseHub } from '../src/sse/hub.js';
describe('stream', () => {
    it('requires authentication', async () => {
        const res = await app.request('/stream');
        expect(res.status).toBe(401);
    });
    it('delivers user and public events and unsubscribes on cancel', async () => {
        const controller = new AbortController();
        const res = sseHub.streamForUser('u1', controller.signal);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        sseHub.publishToUser('u1', { type: 'notify', payload: { kind: 'x' } });
        sseHub.publishToUser('u2', { type: 'notify', payload: { kind: 'other' } });
        sseHub.publishPublic({ type: 'intent.opened', payload: { intentId: 'i1' } });
        let text = '';
        while (!text.includes('intent.opened'))
            text += decoder.decode((await reader.read()).value);
        expect(text).toContain('event: notify');
        expect(text).not.toContain('other');
        await reader.cancel();
        expect(() => sseHub.publishPublic({ type: 'intent.closed' })).not.toThrow();
    });
    it('answers CORS preflight', async () => {
        const res = await app.request('/intents/mine', {
            method: 'OPTIONS',
            headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
        });
        expect(res.headers.get('access-control-allow-headers')).toMatch(/Authorization/i);
    });
});
