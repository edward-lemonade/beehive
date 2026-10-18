import { config } from '../config.js';
import { reportBudgetExhausted } from '../observability/monitors.js';
export const runtimeStats = { budgetExhaustions: 0, violations: 0 };
export function searchBudget() {
    return { maxExpansions: config.SEARCH_BUDGET_EXPANSIONS, maxMs: config.SEARCH_BUDGET_MS };
}
// Call with the `budgetExhausted` flag of every slice 04 result.
export function noteBudget(exhausted, where = 'search') {
    if (!exhausted)
        return;
    runtimeStats.budgetExhaustions += 1;
    reportBudgetExhausted(where);
}
