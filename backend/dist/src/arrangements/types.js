export const LIVE_STATES = ['candidate', 'proposed', 'committed', 'dropped'];
export const ACTIVE_STATES = ['candidate', 'proposed'];
export const VACATED = ['declined', 'timed_out', 'retracted', 'void'];
export class ArrangementError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.name = 'ArrangementError';
    }
}
export const isVacated = (slot) => VACATED.includes(slot.approval);
