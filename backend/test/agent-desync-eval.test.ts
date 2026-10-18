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
      counterparties: [],
      outbound: [{ counterparty: 'Kat', status: 'processed' }],
      inbound: [],
      waitingFor: [],
      accepted: [],
    }).result).toBe('pass');
  });

  it('marks an enqueued but unprocessed message inconclusive', () => {
    expect(gradeAgentDesync('I messaged the other agent.', {
      counterparties: ['Kat'],
      outbound: [{ counterparty: 'Kat', status: 'enqueued' }],
      inbound: [],
      waitingFor: [],
      accepted: [],
    }).result).toBe('inconclusive');
  });

  it('requires a processed inbound message for claims about a reply', () => {
    expect(gradeAgentDesync('They told me they would accept.')).toMatchObject({
      result: 'fail',
      detail: 'unsupported inbound communication claim',
    });
  });

  it('fails when it says it is waiting on Kat but authoritative state says the user must act', () => {
    expect(gradeAgentDesync(
      "We have Edward's proposal pending while we wait on Kat's answer.",
      { counterparties: ['Kat', 'Edward'], outbound: [], inbound: [], waitingFor: [], accepted: [] },
    )).toMatchObject({ result: 'fail', detail: 'waiting claim does not match authoritative pending party: Kat' });
  });

  it('fails a named agreement unless the negotiation log confirms that party and amount', () => {
    expect(gradeAgentDesync(
      "Dawg agreed to $200 for the 3-day ticket.",
      {
        counterparties: ['Dawg', 'Kat'],
        outbound: [{ counterparty: 'Kat', status: 'processed' }],
        inbound: [{ counterparty: 'Dawg', status: 'processed' }],
        waitingFor: [],
        accepted: [],
      },
    )).toMatchObject({ result: 'fail', detail: 'agreement claim about Dawg has no matching accepted offer' });
  });

  it('accepts named waiting and agreement claims when authoritative evidence matches', () => {
    expect(gradeAgentDesync(
      'We are waiting on Kat, and Dawg agreed to $200.',
      {
        counterparties: ['Dawg', 'Kat'],
        outbound: [{ counterparty: 'Kat', status: 'processed' }],
        inbound: [{ counterparty: 'Dawg', status: 'processed' }],
        waitingFor: ['Kat'],
        accepted: [{ counterparty: 'Dawg', amountCents: 20000 }],
      },
    ).result).toBe('pass');
  });
});
