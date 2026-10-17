import { refreshEdges } from '../discovery/service.js';
import { events } from '../events.js';
import { getIntentRepository } from '../intents/service.js';
import { Agent } from './agent.js';
import { bus } from './bus.js';
import { buildGuardContext } from './guard-context.js';
import { hooks } from './hooks.js';
import { Scheduler } from './scheduler.js';
const agents = new Map();
const REFRESH_FIRST = ['opened', 'updated', 'boot', 'keep'];
export const scheduler = new Scheduler(async (intentId, reasons) => {
    const entry = agents.get(intentId) ?? createEntry(intentId);
    // Edges may not be computed yet for a new, edited or rehydrated intent.
    if (REFRESH_FIRST.some((reason) => reasons.has(reason)))
        await refreshEdges(intentId);
    const primary = REFRESH_FIRST.find((reason) => reasons.has(reason)) ?? [...reasons][0] ?? 'edges';
    const { closed } = await entry.agent.wake(primary);
    if (closed)
        destroyAgent(intentId);
});
function createEntry(intentId) {
    const agent = new Agent(intentId, (reason) => scheduler.wake(intentId, reason));
    const unsubscribe = bus.subscribe(intentId, (env) => agent.onMessage(env));
    const entry = { agent, unsubscribe };
    agents.set(intentId, entry);
    return entry;
}
export function ensureAgent(intentId) {
    return (agents.get(intentId) ?? createEntry(intentId)).agent;
}
export function getAgent(intentId) {
    return agents.get(intentId)?.agent;
}
export function destroyAgent(intentId) {
    agents.get(intentId)?.unsubscribe();
    agents.delete(intentId);
}
export function agentCount() {
    return agents.size;
}
export async function rehydrate() {
    hooks.resetNegotiation();
    const open = await getIntentRepository().listOpen();
    for (const intent of open) {
        ensureAgent(intent.id);
        scheduler.wake(intent.id, 'boot');
    }
    return open.length;
}
const onOpened = ({ intentId }) => {
    ensureAgent(intentId);
    scheduler.wake(intentId, 'opened');
};
const onUpdated = ({ intentId }) => scheduler.wake(intentId, 'updated');
const onClosed = ({ intentId }) => scheduler.wake(intentId, 'closed');
const onEdges = ({ intentId }) => scheduler.wake(intentId, 'edges');
let started = false;
export async function startRuntime(options = {}) {
    if (started)
        return;
    started = true;
    bus.setGuardContext(buildGuardContext);
    events.on('intent.opened', onOpened);
    events.on('intent.updated', onUpdated);
    events.on('intent.closed', onClosed);
    events.on('edges.changed', onEdges);
    if (options.rehydrate !== false)
        await rehydrate();
}
export function stopRuntime() {
    started = false;
    events.off('intent.opened', onOpened);
    events.off('intent.updated', onUpdated);
    events.off('intent.closed', onClosed);
    events.off('edges.changed', onEdges);
    scheduler.stop();
    for (const id of [...agents.keys()])
        destroyAgent(id);
}
