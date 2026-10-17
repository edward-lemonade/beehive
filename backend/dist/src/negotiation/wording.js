import { config } from '../config.js';
export const WORDING_TIMEOUT_MS = 5000;
const dollars = (cents) => {
    const value = cents / 100;
    return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
};
export function templateWording(ctx) {
    const amount = ctx.amountCents === null ? '' : dollars(ctx.amountCents);
    switch (ctx.tone) {
        case 'open': return `Could you do ${amount}?`;
        case 'counter': return `How about ${amount}?`;
        case 'accept': return 'That works for me.';
        default: return "Sorry, we can't make this work.";
    }
}
// Display text only: no decision or number is ever read back from this output.
export async function llmWording(ctx) {
    const headers = { 'content-type': 'application/json' };
    if (config.LLM_API_KEY)
        headers.authorization = `Bearer ${config.LLM_API_KEY}`;
    const response = await fetch(`${config.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(WORDING_TIMEOUT_MS),
        body: JSON.stringify({
            model: config.LLM_MODEL_FAST,
            temperature: 0.4,
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
        }),
    });
    if (!response.ok)
        throw new Error(`Wording request failed with HTTP ${response.status}`);
    const data = (await response.json());
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.trim().length === 0)
        throw new Error('Empty wording');
    return text.trim().slice(0, 240);
}
let provider = llmWording;
export function setWordingProvider(fn) {
    provider = fn ?? llmWording;
}
export async function wording(ctx) {
    try {
        const text = await provider(ctx);
        return text.trim() || templateWording(ctx);
    }
    catch {
        return templateWording(ctx);
    }
}
