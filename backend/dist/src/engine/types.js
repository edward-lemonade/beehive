export class BudgetMeter {
    budget;
    exhausted = false;
    expansions = 0;
    now;
    start;
    constructor(budget) {
        this.budget = budget;
        this.now = budget.now ?? (() => Date.now());
        this.start = this.now();
    }
    // Returns false once either limit is hit; callers must then stop searching.
    tick() {
        if (this.exhausted)
            return false;
        this.expansions += 1;
        if (this.expansions > this.budget.maxExpansions || this.now() - this.start > this.budget.maxMs) {
            this.exhausted = true;
            return false;
        }
        return true;
    }
}
