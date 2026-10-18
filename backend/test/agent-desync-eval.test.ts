import { describe, expect, it } from 'vitest';
import { gradeAgentDesync } from '../src/observability/evals.js';

describe('agent desync eval', () => {
  it('passes when the reply makes no communication claim', () => {
    expect(gradeAgentDesync('I can ask the other agent about that.').result).toBe('pass');
  });

  it('fails an outbound communication claim without a processed message', () => {
    expect(gradeAgentDesync('I already spoke with their agent.')).toMatchObject({
      result: 'fail',
      detail: 'unsupported outbound communication claim',
    });
  });

  it('passes an outbound claim when a message was processed', () => {
    expect(gradeAgentDesync('I sent them an offer.', {
      outbound: ['processed'],
      inbound: [],
    }).result).toBe('pass');
  });

  it('marks an enqueued but unprocessed message inconclusive', () => {
    expect(gradeAgentDesync('I messaged the other agent.', {
      outbound: ['enqueued'],
      inbound: [],
    }).result).toBe('inconclusive');
  });

  it('requires a processed inbound message for claims about a reply', () => {
    expect(gradeAgentDesync('They told me they would accept.')).toMatchObject({
      result: 'fail',
      detail: 'unsupported inbound communication claim',
    });
  });
});
