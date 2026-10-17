import { getEdges } from '../discovery/service.js';
import { getIntentRepository } from '../intents/service.js';
import { hooks } from './hooks.js';
import { signalRepo } from './signals.js';
export async function buildGuardContext(env) {
    const repo = getIntentRepository();
    const fromId = typeof env?.from === 'string' ? env.from : '';
    const toId = typeof env?.to === 'string' ? env.to : '';
    const isCoordinator = fromId === 'coordinator';
    const bodyType = env?.body?.type;
    const [sender, recipient] = await Promise.all([
        isCoordinator ? undefined : repo.get(fromId),
        repo.get(toId),
    ]);
    const relevant = sender && !isCoordinator
        ? new Set((await getEdges(fromId)).map((edge) => edge.other))
        : new Set();
    const retractTargets = sender && bodyType === 'signal'
        ? new Set((await signalRepo().from(fromId)).map((row) => row.to))
        : new Set();
    let forbidden = [];
    if (bodyType && bodyType !== 'signal') {
        forbidden = (await repo.listOpen())
            .filter((intent) => intent.id !== fromId && intent.id !== toId)
            .flatMap((intent) => [intent.id, intent.public.ownerHandle]);
    }
    return {
        senderVersion: sender?.version ?? null,
        recipientVersion: recipient?.version ?? null,
        relevant,
        retractTargets,
        coordinatorRecipients: isCoordinator ? await hooks.coordinatorRecipients(env) : new Set(),
        senderBounds: sender?.private.minNetCents != null ? [sender.private.minNetCents] : [],
        forbidden,
    };
}
