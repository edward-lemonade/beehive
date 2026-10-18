export type EventMap = {
  'intent.opened': { intentId: string };
  'intent.updated': { intentId: string; privateOnly?: boolean };
  'intent.closed': { intentId: string };
  'edges.changed': { intentId: string };
  'signal.changed': { intentId: string };
  'arrangement.candidate': { arrangementId: string };
  'arrangement.priced': { arrangementId: string };
  'arrangement.proposed': { arrangementId: string };
  'arrangement.committed': { arrangementId: string };
  'arrangement.approved': { arrangementId: string; intentId: string };
  'arrangement.dissolved': { arrangementId: string; reason?: string };
  'slot.vacated': { arrangementId: string; intentId: string };
  'negotiation.round': {
    arrangementId?: string;
    linkId?: string;
    round: number;
    fromIntentId?: string;
    toIntentId?: string;
    kind?: 'offer' | 'accept' | 'walk' | 'say';
    amountCents?: number | null;
    text?: string | null;
  };
  /** An agent reached a price its user never authorised and needs the user's decision. */
  'negotiation.awaiting_user': { arrangementId?: string; linkId: string; intentId: string; counterpartIntentId: string; amountCents: number; side?: 'payer' | 'receiver' };
  notify: { userId: string; kind: string; payload?: Record<string, unknown> };
};

export type EventName = keyof EventMap;

export class TypedEventEmitter {
  private listeners = new Map<EventName, Set<(payload: EventMap[EventName]) => void>>();

  on<K extends EventName>(eventName: K, listener: (payload: EventMap[K]) => void): void {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener as (payload: EventMap[EventName]) => void);
    this.listeners.set(eventName, listeners);
  }

  off<K extends EventName>(eventName: K, listener: (payload: EventMap[K]) => void): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;
    listeners.delete(listener as (payload: EventMap[EventName]) => void);
  }

  emit<K extends EventName>(eventName: K, payload: EventMap[K]): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(payload);
    }
  }
}

export const events = new TypedEventEmitter();
