import { config } from '../config.js';
import { Sentry, metric } from './telemetry.js';
/** Network or HTTP failure from the provider (retryable), as opposed to a bad answer. */
export class LlmProviderError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'LlmProviderError';
    }
}
export function providerName(baseUrl = config.LLM_BASE_URL) {
    if (/googleapis|generativelanguage/.test(baseUrl))
        return 'gcp.gemini';
    if (/groq/.test(baseUrl))
        return 'groq';
    if (/localhost:11434|ollama/.test(baseUrl))
        return 'ollama';
    if (/openai\.com/.test(baseUrl))
        return 'openai';
    return 'openai_compatible';
}
const recordIo = () => process.env.SENTRY_RECORD_LLM_IO === 'true';
const parts = (m) => ({ role: m.role, parts: [{ type: 'text', content: m.content }] });
const agentUsage = new WeakMap();
/** The enclosing `invoke_agent` span, if this LLM call is one step of an agent turn. */
function agentSpan() {
    const active = Sentry.getActiveSpan();
    return active && Sentry.spanToJSON(active).attributes['gen_ai.operation.name'] === 'invoke_agent' ? active : undefined;
}
// Sentry's AI Agents view reads cost and tokens from the agent span itself, so each call's usage is summed onto it.
function addAgentUsage(agent, usage) {
    if (!agent || !usage)
        return;
    const sum = agentUsage.get(agent) ?? { input: 0, output: 0, total: 0 };
    sum.input += usage.prompt_tokens ?? 0;
    sum.output += usage.completion_tokens ?? 0;
    sum.total += usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
    agentUsage.set(agent, sum);
    agent.setAttributes({ 'gen_ai.usage.input_tokens': sum.input, 'gen_ai.usage.output_tokens': sum.output, 'gen_ai.usage.total_tokens': sum.total });
}
/** Records an agent turn's user input and final reply on its `invoke_agent` span, only when LLM I/O recording is on. */
export function recordAgentIo(span, io) {
    if (!recordIo())
        return;
    if (io.input !== undefined)
        span.setAttribute('gen_ai.input.messages', JSON.stringify([parts({ role: 'user', content: io.input })]));
    if (io.output !== undefined)
        span.setAttribute('gen_ai.output.messages', JSON.stringify([parts({ role: 'assistant', content: io.output })]));
}
/** One OpenAI-compatible chat completion, recorded as a `gen_ai.chat` span with token usage. Returns the raw text. */
export async function chatCompletion(req) {
    const model = config.LLM_MODEL_FAST;
    const provider = providerName();
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const attributes = {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': provider,
        'gen_ai.request.model': model,
        'gen_ai.function_id': req.functionId,
    };
    if (req.agentName)
        attributes['gen_ai.agent.name'] = req.agentName;
    if (req.temperature !== undefined)
        attributes['gen_ai.request.temperature'] = req.temperature;
    if (req.maxTokens !== undefined)
        attributes['gen_ai.request.max_tokens'] = req.maxTokens;
    if (recordIo()) {
        if (system)
            attributes['gen_ai.system_instructions'] = system;
        attributes['gen_ai.input.messages'] = JSON.stringify(req.messages.filter((m) => m.role !== 'system').map(parts));
    }
    const agent = agentSpan();
    return Sentry.startSpan({ op: 'gen_ai.chat', name: `chat ${model}`, attributes }, async (span) => {
        const started = performance.now();
        const tags = { function_id: req.functionId, model, provider };
        try {
            const headers = { 'content-type': 'application/json' };
            if (config.LLM_API_KEY)
                headers.authorization = `Bearer ${config.LLM_API_KEY}`;
            const response = await fetch(`${config.LLM_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers,
                ...(req.timeoutMs ? { signal: AbortSignal.timeout(req.timeoutMs) } : {}),
                body: JSON.stringify({
                    model,
                    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
                    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
                    ...(req.json ? { response_format: { type: 'json_object' } } : {}),
                    messages: req.messages,
                }),
            }).catch((error) => {
                throw new LlmProviderError(`${req.functionId} request failed: ${error instanceof Error ? error.message : 'network error'}`);
            });
            if (!response.ok)
                throw new LlmProviderError(`${req.functionId} request failed with HTTP ${response.status}`, response.status);
            const data = (await response.json());
            const content = data.choices?.[0]?.message?.content;
            const usage = data.usage;
            span.setAttributes({
                ...(data.model ? { 'gen_ai.response.model': data.model } : {}),
                ...(data.id ? { 'gen_ai.response.id': data.id } : {}),
                ...(data.choices?.[0]?.finish_reason ? { 'gen_ai.response.finish_reasons': JSON.stringify([data.choices[0].finish_reason]) } : {}),
                ...(typeof usage?.prompt_tokens === 'number' ? { 'gen_ai.usage.input_tokens': usage.prompt_tokens } : {}),
                ...(typeof usage?.completion_tokens === 'number' ? { 'gen_ai.usage.output_tokens': usage.completion_tokens } : {}),
                ...(typeof usage?.total_tokens === 'number' ? { 'gen_ai.usage.total_tokens': usage.total_tokens } : {}),
            });
            addAgentUsage(agent, usage);
            if (typeof usage?.total_tokens === 'number')
                metric.count('llm.tokens', tags, usage.total_tokens);
            if (typeof content !== 'string' || !content.trim())
                throw new Error(`${req.functionId} returned an empty response`);
            if (recordIo())
                span.setAttribute('gen_ai.output.messages', JSON.stringify([parts({ role: 'assistant', content })]));
            metric.count('llm.call', { ...tags, outcome: 'ok' });
            return content;
        }
        catch (error) {
            const type = error instanceof LlmProviderError ? (error.status ? `http_${error.status}` : 'network') : 'bad_response';
            span.setStatus({ code: 2, message: type });
            span.setAttribute('error.type', type);
            metric.count('llm.call', { ...tags, outcome: type });
            throw error;
        }
        finally {
            metric.dist('llm.latency', performance.now() - started, 'millisecond', tags);
        }
    });
}
export const stripFences = (s) => s.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
