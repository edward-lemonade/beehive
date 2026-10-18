import { describe, expect, it } from 'vitest';
import { MemoryArrangementRepository } from '../src/arrangements/index.js';
import { MemoryNegotiationLogRepository } from '../src/negotiation/log.js';

describe('revive', () => {
  it('forgets declines that involve the intent only', async () => {
    const repo = new MemoryArrangementRepository();
    await repo.addDecline('u1', 'a@1|b@1');
    await repo.addDecline('u1', 'c@1|d@1');
    await repo.revive('a');
    expect(await repo.isDeclined('u1', 'a@1|b@1')).toBe(false);
    expect(await repo.isDeclined('u1', 'c@1|d@1')).toBe(true);
  });
});

describe('negotiation history', () => {
  it('returns recent entries involving the intents, oldest first', async () => {
    const log = new MemoryNegotiationLogRepository();
    const base = { linkId: 'l', arrangementId: 'x', kind: 'offer' as const, amountCents: 100, text: null };
    await log.append({ ...base, round: 1, from: 'a', to: 'b', at: 1 });
    await log.append({ ...base, round: 2, from: 'b', to: 'a', at: 2 });
    await log.append({ ...base, round: 1, from: 'c', to: 'd', at: 3 });
    const got = await log.forIntents(['a'], 10);
    expect(got.map((e) => e.round)).toEqual([1, 2]);
    expect(await log.forIntents(['a'], 1)).toHaveLength(1);
  });
});
