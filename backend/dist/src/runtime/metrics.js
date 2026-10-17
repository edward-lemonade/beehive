import { config } from '../config.js';
export const runtimeStats = { budgetExhaustions: 0, violations: 0 };
export function searchBudget() {
    return { maxExpansions: config.SEARCH_BUDGET_EXPANSIONS, maxMs: config.SEARCH_BUDGET_MS };
}
// Call with the `budgetExhausted` flag of every slice 04 result.
export function noteBudget(exhausted) {
    if (exhausted)
        runtimeStats.budgetExhaustions += 1;
}
