import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
describe('intent route authentication', () => {
    it('rejects unauthenticated access to private and public intent routes', async () => {
        const privateResponse = await app.request('/intents/mine');
        const publicResponse = await app.request('/map/intents');
        expect(privateResponse.status).toBe(401);
        expect(publicResponse.status).toBe(401);
    });
    it('rejects unauthenticated access to discovery routes', async () => {
        const id = '00000000-0000-4000-8000-000000000000';
        expect((await app.request(`/intents/${id}/near-misses`)).status).toBe(401);
        expect((await app.request(`/intents/${id}/relevant`)).status).toBe(401);
    });
});
