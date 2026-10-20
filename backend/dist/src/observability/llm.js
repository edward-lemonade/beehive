import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
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
    sum.input += usage.input;
    sum.output += usage.output;
    sum.total += usage.total;
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
const toLangChainMessage = (message) => {
    switch (message.role) {
        case 'system': return new SystemMessage(message.content);
        case 'user': return new HumanMessage(message.content);
        case 'assistant': return new AIMessage(message.content);
    }
};
const providerStatus = (error) => {
    if (!error || typeof error !== 'object' || !('status' in error))
        return undefined;
    return typeof error.status === 'number' ? error.status : undefined;
};
/** One LangChain chat-model invocation, recorded as a `gen_ai.chat` span with token usage. Returns the raw text. */
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
            const chatModel = new ChatOpenAI({
                model,
                apiKey: config.LLM_API_KEY || 'not-required',
                configuration: { baseURL: config.LLM_BASE_URL.replace(/\/+$/, '') },
                maxRetries: 0,
                ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
                ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
                ...(req.timeoutMs !== undefined ? { timeout: req.timeoutMs } : {}),
            });
            const result = await chatModel.invoke(req.messages.map(toLangChainMessage), req.json ? { response_format: { type: 'json_object' } } : undefined).catch((error) => {
                const status = providerStatus(error);
                throw new LlmProviderError(status
                    ? `${req.functionId} request failed with HTTP ${status}`
                    : `${req.functionId} request failed: ${error instanceof Error ? error.message : 'network error'}`, status);
            });
            const content = result.content;
            const usage = result.usage_metadata ? {
                input: result.usage_metadata.input_tokens,
                output: result.usage_metadata.output_tokens,
                total: result.usage_metadata.total_tokens,
            } : undefined;
            const responseModel = typeof result.response_metadata.model_name === 'string' ? result.response_metadata.model_name : undefined;
            const finishReason = typeof result.response_metadata.finish_reason === 'string' ? result.response_metadata.finish_reason : undefined;
            span.setAttributes({
                ...(responseModel ? { 'gen_ai.response.model': responseModel } : {}),
                ...(result.id ? { 'gen_ai.response.id': result.id } : {}),
                ...(finishReason ? { 'gen_ai.response.finish_reasons': JSON.stringify([finishReason]) } : {}),
                ...(usage ? {
                    'gen_ai.usage.input_tokens': usage.input,
                    'gen_ai.usage.output_tokens': usage.output,
                    'gen_ai.usage.total_tokens': usage.total,
                } : {}),
            });
            addAgentUsage(agent, usage);
            if (usage)
                metric.count('llm.tokens', tags, usage.total);
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
