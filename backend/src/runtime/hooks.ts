import type { Envelope } from '../contracts/index.js';

// Extension points that later slices fill in (negotiation: 06, arrangements: 07).
export const hooks = {
  hasPendingArrangement: async (_intentId: string): Promise<boolean> => false,
  coordinatorRecipients: async (_env: Envelope): Promise<Set<string>> => new Set<string>(),
  negotiation: (_env: Envelope): void => {},
  resetNegotiation: (): void => {},
};

export function resetHooks(): void {
  hooks.hasPendingArrangement = async () => false;
  hooks.coordinatorRecipients = async () => new Set<string>();
  hooks.negotiation = () => {};
  hooks.resetNegotiation = () => {};
}
