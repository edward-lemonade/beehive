import { chatCompletion } from '../observability/llm.js';

export const WORDING_TIMEOUT_MS = 5000;

export type WordingContext = {
  round: number;
  amountCents: number | null;
  tone: 'open' | 'counter' | 'accept' | 'defer' | 'review' | 'walk';
};

const dollars = (cents: number): string => {
  const value = cents / 100;
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
};

export function templateWording(ctx: WordingContext): string {
  const amount = ctx.amountCents === null ? '' : dollars(ctx.amountCents);
  switch (ctx.tone) {
    case 'open': return amount ? `Could you do ${amount}?` : 'Here is my opening offer.';
    case 'counter': return amount ? `How about ${amount}?` : 'Here is my counter-offer.';
    case 'accept': return 'That works for me.';
    case 'review': return amount ? `${amount} is below my asking price. I'll check with my user.` : "That's below my asking price. I'll check with my user.";
    case 'defer': return amount ? `${amount} is above what I can confirm myself. I'll check with my user.` : "That's above what I can confirm myself. I'll check with my user.";
    default: return "Sorry, we can't make this work.";
  }
}

// Display text only: no decision or number is ever read back from this output.
export async function llmWording(ctx: WordingContext): Promise<string> {
  const text = await chatCompletion({
    functionId: 'negotiation.wording',
    agentName: 'negotiator',
    temperature: 0.4,
    timeoutMs: WORDING_TIMEOUT_MS,
    messages: [
      {
        role: 'system',
        content: 'Write one short, friendly sentence for a price negotiation message. Mention only the amount given, if any. No other numbers or names.',
      },
      {
        role: 'user',
        content: `Round ${ctx.round}. Tone: ${ctx.tone}.${ctx.amountCents === null ? '' : ` Amount: ${dollars(ctx.amountCents)}.`}`,
      },
    ],
  });
  return text.trim().slice(0, 240);
}

// Templates by default: an LLM call per negotiation line would burn the provider's per-minute request cap. llmWording stays available via setWordingProvider.
let provider: (ctx: WordingContext) => Promise<string> = async (ctx) => templateWording(ctx);

export function setWordingProvider(fn?: (ctx: WordingContext) => Promise<string>): void {
  provider = fn ?? (async (ctx) => templateWording(ctx));
}

export async function wording(ctx: WordingContext): Promise<string> {
  if (ctx.tone === 'defer' || ctx.tone === 'review') return templateWording(ctx);
  try {
    const text = await provider(ctx);
    return text.trim() || templateWording(ctx);
  } catch {
    return templateWording(ctx);
  }
}
