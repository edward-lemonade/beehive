import type { IntentPublic, Item, RelevantEdge } from '../contracts/index.js';
import type { Id, SlotId } from './types.js';

export type SlotInfo =
  | { id: SlotId; side: 'give'; index: number; item: Item }
  | { id: SlotId; side: 'want'; index: number; options: Item[] };

export const normText = (value: string | number): string => String(value).trim().toLowerCase();

export function canon(item: Item): string {
  const attrs = Object.entries(item.attrs)
    .map(([key, value]) => [key, value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([item.kind, normText(item.label), attrs, item.qty, item.amountCents ?? null]);
}

// Slots are non-cash items only. Ids use the original array index so they line up with EdgeCover.slot.
export function slotsOf(intent: IntentPublic): SlotInfo[] {
  const slots: SlotInfo[] = [];
  intent.give.forEach((item, index) => {
    if (item.kind !== 'cash') slots.push({ id: `g${index}`, side: 'give', index, item });
  });
  intent.want.forEach((want, index) => {
    const options = want.anyOf.filter((item) => item.kind !== 'cash');
    if (options.length > 0) slots.push({ id: `w${index}`, side: 'want', index, options });
  });
  return slots;
}

// For each slot, the other intents (per self's edges) that could provide or take it.
export function candidatesBySlot(
  intent: IntentPublic,
  edges: RelevantEdge[],
  isCurrent?: (other: Id, version: number) => boolean,
): Map<SlotId, Id[]> {
  const map = new Map<SlotId, Id[]>();
  for (const slot of slotsOf(intent)) map.set(slot.id, []);
  const giveIds = new Map(intent.give.map((item, index) => [canon(item), `g${index}`] as const));

  const add = (slotId: SlotId, other: Id): void => {
    const list = map.get(slotId);
    if (list && !list.includes(other)) list.push(other);
  };

  for (const edge of edges) {
    if (edge.self !== intent.intentId) continue;
    if (isCurrent && !isCurrent(edge.other, edge.otherVersion)) continue;
    for (const cover of edge.selfWants) add(cover.slot, edge.other);
    for (const flow of edge.selfGives) {
      const slotId = giveIds.get(canon(flow.item));
      if (slotId) add(slotId, edge.other);
    }
  }
  return map;
}
