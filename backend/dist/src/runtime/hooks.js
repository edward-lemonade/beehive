// Extension points that later slices fill in (negotiation: 06, arrangements: 07).
export const hooks = {
    hasPendingArrangement: async (_intentId) => false,
    coordinatorRecipients: async (_env) => new Set(),
    negotiation: (_env) => { },
    resetNegotiation: () => { },
};
export function resetHooks() {
    hooks.hasPendingArrangement = async () => false;
    hooks.coordinatorRecipients = async () => new Set();
    hooks.negotiation = () => { };
    hooks.resetNegotiation = () => { };
}
