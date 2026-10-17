import type { Arrangement, IntentPublic, Link, RelevantEdge } from '../contracts/index.js';
import { itemMatch } from '../discovery/match.js';
import { arrangementKey, finalizeDraft } from './build.js';
import type { ArrangementDraft, Id } from './types.js';

// Higher is better for `a` when negative; ordering is by structure only.
export function rank(a: ArrangementDraft, b: ArrangementDraft, viewer: Id): number {
  if (a.slots.length !== b.slots.length) return a.slots.length - b.slots.length;
  const netA = a.declaredNet[viewer] ?? 0;
  const netB = b.declaredNet[viewer] ?? 0;
  if (netA !== netB) return netB - netA;
  if (a.tierScore !== b.tierScore) return b.tierScore - a.tierScore;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

const swap = (id: Id, vacated: Id, candidate: Id): Id => (id === vacated ? candidate : id);

function canTrade(link: Link, vacated: Id, candidate: IntentPublic): boolean {
  return link.flows.every((flow) => {
    if (flow.from === vacated) return candidate.give.some((item) => itemMatch(item, flow.item));
    if (flow.to === vacated) return candidate.want.some((slot) => itemMatch(flow.item, slot));
    return true;
  });
}

export function findReplacement(
  arr: Arrangement,
  vacated: Id,
  candidates: Id[],
  intents: Map<Id, IntentPublic>,
  edges: Map<Id, RelevantEdge[]>,
  declinedBy: ReadonlySet<Id> = new Set(),
): ArrangementDraft | null {
  const members = new Map(arr.slots.map((s) => [s.intentId, s.intentVersion] as const));
  const affected = arr.links.filter((l) => l.a === vacated || l.b === vacated);

  for (const id of [...candidates].sort()) {
    const candidate = intents.get(id);
    if (!candidate || members.has(id) || declinedBy.has(id)) continue;
    const ok = affected.every((link) => {
      const neighbor = link.a === vacated ? link.b : link.a;
      const hasEdge = (edges.get(id) ?? []).some((e) => e.self === id && e.other === neighbor
        && e.otherVersion === members.get(neighbor));
      return hasEdge && canTrade(link, vacated, candidate);
    });
    if (!ok) continue;

    const links: Link[] = arr.links.map((link) => {
      const [a, b] = [swap(link.a, vacated, id), swap(link.b, vacated, id)].sort() as [Id, Id];
      return {
        id: `${a}|${b}`,
        a,
        b,
        flows: link.flows.map((f) => ({ ...f, from: swap(f.from, vacated, id), to: swap(f.to, vacated, id) })),
        payer: link.payer ? swap(link.payer, vacated, id) : null,
        amountCents: null,
        state: 'unpriced' as const,
      };
    });
    const nextMembers = arr.slots.map((s) => swap(s.intentId, vacated, id));
    const draft = finalizeDraft(nextMembers, links, intents, false);
    return { ...draft, key: arrangementKey(draft.slots) };
  }
  return null;
}
