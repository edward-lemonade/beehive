import type { ApprovalState, Link } from '../contracts/index.js';

export type ArrangementState = 'candidate' | 'dropped' | 'proposed' | 'committed' | 'dissolved';

export const LIVE_STATES: ArrangementState[] = ['candidate', 'proposed', 'committed', 'dropped'];
export const ACTIVE_STATES: ArrangementState[] = ['candidate', 'proposed'];
export const VACATED: ApprovalState[] = ['declined', 'timed_out', 'retracted', 'void'];

export type StoredSlot = {
  intentId: string;
  userId: string;
  intentVersion: number;
  approval: ApprovalState;
  termsHash: string | null;
  approvedNetCents: number | null;
  requestedAt: number | null;
  decidedAt: number | null;
};

/** A price one side has put to the other's user and is waiting on. At most one exists per arrangement. */
export type PriceProposal = { linkId: string; amountCents: number; fromIntentId: string; source?: 'agent' | 'user' };

export type StoredArrangement = {
  id: string;
  key: string;
  state: ArrangementState;
  revision: number;
  reason: string | null;
  excluded: string[];
  declaredNet: Record<string, number>;
  replaceDeadline: number | null;
  createdAt: number;
  updatedAt: number;
  slots: StoredSlot[];
  links: Link[];
  proposal?: PriceProposal | null;
};

export type SaveResult = 'ok' | 'key' | 'stale';

export type CommitFailure = 'not_found' | 'state' | 'revision' | 'approvals' | 'intent';

export type CommitResult =
  | {
      ok: true;
      arrangement: StoredArrangement;
      consumed: Array<{ arrangementId: string; approvedUserIds: string[] }>;
    }
  | { ok: false; reason: CommitFailure; intentId?: string };

export class ArrangementError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'ArrangementError';
  }
}

export const isVacated = (slot: StoredSlot): boolean => VACATED.includes(slot.approval);
