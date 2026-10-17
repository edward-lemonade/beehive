import type { Link, Slot } from '../contracts/index.js';

export type Id = string;
export type SlotId = string;

export type Budget = {
  maxExpansions: number;
  maxMs: number;
  now?: () => number;
};

export type ArrangementDraft = {
  key: string;
  slots: Slot[];
  links: Link[];
  declaredNet: Record<Id, number>;
  tierScore: number;
  budgetExhausted: boolean;
};

export class BudgetMeter {
  exhausted = false;
  private expansions = 0;
  private readonly now: () => number;
  private readonly start: number;

  constructor(private readonly budget: Budget) {
    this.now = budget.now ?? (() => Date.now());
    this.start = this.now();
  }

  // Returns false once either limit is hit; callers must then stop searching.
  tick(): boolean {
    if (this.exhausted) return false;
    this.expansions += 1;
    if (this.expansions > this.budget.maxExpansions || this.now() - this.start > this.budget.maxMs) {
      this.exhausted = true;
      return false;
    }
    return true;
  }
}
