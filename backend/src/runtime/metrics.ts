import { config } from '../config.js';
import type { Budget } from '../engine/index.js';
import { reportBudgetExhausted } from '../observability/monitors.js';

export const runtimeStats = { budgetExhaustions: 0, violations: 0 };

export function searchBudget(): Budget {
  return { maxExpansions: config.SEARCH_BUDGET_EXPANSIONS, maxMs: config.SEARCH_BUDGET_MS };
}

// Call with the `budgetExhausted` flag of every slice 04 result.
export function noteBudget(exhausted: boolean, where = 'search'): void {
  if (!exhausted) return;
  runtimeStats.budgetExhaustions += 1;
  reportBudgetExhausted(where);
}
