import type { IntentPublic, Item, Link, RelevantEdge, Slot } from '../contracts/index.js';
import { canon, slotsOf, type SlotInfo } from './slots.js';
import { labelsMatch } from '../discovery/match.js';
import { BudgetMeter, type ArrangementDraft, type Budget, type Id } from './types.js';

export function arrangementKey(slots: Array<{ intentId: Id; intentVersion: number }>): string {
  return slots.map((s) => `${s.intentId}@${s.intentVersion}`).sort().join('|');
}

const TIER_SCORE: Record<string, number> = { reliable: 1, new: 0, flagged: -1 };
const tierScore = (tier: string): number => TIER_SCORE[tier.trim().toLowerCase()] ?? 0;

const hasCashGive = (intent: IntentPublic): boolean => intent.give.some((i) => i.kind === 'cash');
const hasCashWant = (intent: IntentPublic): boolean => intent.want.some((w) => w.anyOf.some((i) => i.kind === 'cash'));

function cashGiven(intent: IntentPublic): number {
  return intent.give.filter((i) => i.kind === 'cash').reduce((sum, i) => sum + (i.amountCents ?? 0) * i.qty, 0);
}

function cashWanted(intent: IntentPublic): number {
  return intent.want.reduce((sum, w) => {
    const amounts = w.anyOf.filter((i) => i.kind === 'cash').map((i) => (i.amountCents ?? 0) * i.qty);
    return sum + (amounts.length > 0 ? Math.min(...amounts) : 0);
  }, 0);
}

type Alloc = { provider: Id; giveIdx: number; wanter: Id; slot: string; qty: number };

type State = {
  members: Id[];
  allocs: Alloc[];
  used: Map<string, number>;
  needs: Map<string, number>;
};

const giveKey = (provider: Id, idx: number): string => `${provider}#${idx}`;
const wantKey = (wanter: Id, slot: string): string => `${wanter}#${slot}`;

function cloneState(state: State, member?: Id): State {
  return {
    members: member && !state.members.includes(member) ? [...state.members, member] : [...state.members],
    allocs: [...state.allocs],
    used: new Map(state.used),
    needs: new Map(state.needs),
  };
}

function got(state: State, wanter: Id, slot: string): number {
  return state.allocs.filter((a) => a.wanter === wanter && a.slot === slot).reduce((s, a) => s + a.qty, 0);
}

function optionQty(options: Item[], given: Item): number {
  const match = options.find((o) => o.kind === given.kind && labelsMatch(o.label, given.label));
  return (match ?? options[0]!).qty;
}

// Payer rules: cash only ever flows between two intents that exchange a non-cash item.
function buildLinks(allocs: Alloc[], intents: Map<Id, IntentPublic>): Link[] {
  const groups = new Map<string, Alloc[]>();
  for (const alloc of allocs) {
    const [a, b] = [alloc.provider, alloc.wanter].sort();
    const key = `${a}|${b}`;
    groups.set(key, [...(groups.get(key) ?? []), alloc]);
  }
  const links: Link[] = [];
  for (const [id, list] of [...groups].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const [a, b] = id.split('|') as [Id, Id];
    const flows = list.map((alloc) => ({
      from: alloc.provider,
      to: alloc.wanter,
      item: { ...intents.get(alloc.provider)!.give[alloc.giveIdx]!, qty: alloc.qty },
    }));
    const directions = new Set(flows.map((f) => f.from));
    let payer: Id | null = null;
    if (directions.size === 1) {
      const giver = flows[0]!.from;
      const receiver = giver === a ? b : a;
      if (hasCashGive(intents.get(receiver)!) || hasCashWant(intents.get(giver)!)) payer = receiver;
    } else {
      const aCash = hasCashGive(intents.get(a)!);
      const bCash = hasCashGive(intents.get(b)!);
      if (aCash !== bCash) payer = aCash ? a : b;
    }
    links.push({ id, a, b, flows, payer, amountCents: null, state: 'unpriced' });
  }
  return links;
}

export function finalizeDraft(
  members: Id[],
  links: Link[],
  intents: Map<Id, IntentPublic>,
  budgetExhausted: boolean,
): ArrangementDraft {
  const slots: Slot[] = [...members].sort().map((id) => ({
    intentId: id,
    intentVersion: intents.get(id)!.version,
    approval: 'queued' as const,
  }));
  const declaredNet: Record<Id, number> = Object.fromEntries(slots.map((s) => [s.intentId, 0]));
  for (const link of links) {
    if (!link.payer) continue;
    const receiver = link.payer === link.a ? link.b : link.a;
    const payerIntent = intents.get(link.payer)!;
    const amount = cashGiven(payerIntent) || cashWanted(intents.get(receiver)!);
    declaredNet[link.payer] = (declaredNet[link.payer] ?? 0) - amount;
    declaredNet[receiver] = (declaredNet[receiver] ?? 0) + amount;
  }
  return {
    key: arrangementKey(slots),
    slots,
    links,
    declaredNet,
    tierScore: slots.reduce((sum, s) => sum + tierScore(intents.get(s.intentId)!.tier), 0),
    budgetExhausted,
  };
}

export type BuildOptions = { seed?: Id; must?: Id[] };
export type BuildResult = { draft: ArrangementDraft | null; budgetExhausted: boolean };

export function buildArrangement(
  set: Id[],
  intents: Map<Id, IntentPublic>,
  edges: Map<Id, RelevantEdge[]>,
  budget: Budget,
  options: BuildOptions = {},
): BuildResult {
  const inSet = new Set(set.filter((id) => intents.has(id)));
  const initial = [...new Set([...(options.must ?? []), ...(options.seed ? [options.seed] : [])])];
  if (initial.length === 0 && inSet.size > 0) initial.push([...inSet].sort()[0]!);
  if (initial.length === 0 || initial.some((id) => !inSet.has(id))) return { draft: null, budgetExhausted: false };

  const meter = new BudgetMeter(budget);
  const slotCache = new Map<Id, SlotInfo[]>();
  const slotsFor = (id: Id): SlotInfo[] => {
    if (!slotCache.has(id)) slotCache.set(id, slotsOf(intents.get(id)!));
    return slotCache.get(id)!;
  };
  const giveIndex = (provider: Id, item: Item): number =>
    intents.get(provider)!.give.findIndex((g) => canon(g) === canon(item));

  const rankChoice = (state: State, other: Id, seedPrice: Id): [number, number, number, string] => [
    state.members.includes(other) ? 0 : 1,
    slotsFor(other).length,
    cashWanted(intents.get(other)!) * (seedPrice === other ? 0 : 1),
    other,
  ];
  const compare = (a: ReturnType<typeof rankChoice>, b: ReturnType<typeof rankChoice>): number => {
    for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
    return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
  };
  const seedId = initial[0]!;

  type Option = { provider: Id; giveIdx: number; wanter: Id; slot: string; qty: number };

  const wantOptions = (state: State, wanter: Id, slot: Extract<SlotInfo, { side: 'want' }>): Option[] => {
    const out: Option[] = [];
    for (const edge of edges.get(wanter) ?? []) {
      if (edge.self !== wanter || !inSet.has(edge.other)) continue;
      if (intents.get(edge.other)?.version !== edge.otherVersion) continue;
      for (const cover of edge.selfWants) {
        if (cover.slot !== slot.id) continue;
        const idx = giveIndex(edge.other, cover.item);
        if (idx < 0) continue;
        const capacity = intents.get(edge.other)!.give[idx]!.qty - (state.used.get(giveKey(edge.other, idx)) ?? 0);
        if (capacity <= 0) continue;
        const need = state.needs.get(wantKey(wanter, slot.id)) ?? optionQty(slot.options, cover.item);
        const remaining = need - got(state, wanter, slot.id);
        out.push({ provider: edge.other, giveIdx: idx, wanter, slot: slot.id, qty: Math.min(capacity, remaining) });
      }
    }
    return out;
  };

  const takeOptions = (state: State, provider: Id, giveIdx: number): Option[] => {
    const item = intents.get(provider)!.give[giveIdx]!;
    const capacity = item.qty - (state.used.get(giveKey(provider, giveIdx)) ?? 0);
    if (capacity <= 0) return [];
    const out: Option[] = [];
    for (const edge of edges.get(provider) ?? []) {
      if (edge.self !== provider || !inSet.has(edge.other)) continue;
      if (intents.get(edge.other)?.version !== edge.otherVersion) continue;
      const wanter = edge.other;
      for (const cover of (edges.get(wanter) ?? []).flatMap((e) => (e.self === wanter && e.other === provider ? e.selfWants : []))) {
        if (canon(cover.item) !== canon(item)) continue;
        const slot = slotsFor(wanter).find((s) => s.id === cover.slot);
        if (!slot || slot.side !== 'want') continue;
        const need = state.needs.get(wantKey(wanter, slot.id)) ?? optionQty(slot.options, item);
        const remaining = need - got(state, wanter, slot.id);
        if (remaining <= 0) continue;
        out.push({ provider, giveIdx, wanter, slot: slot.id, qty: Math.min(capacity, remaining) });
      }
    }
    return out;
  };

  const apply = (state: State, option: Option): State => {
    const next = cloneState(state, option.wanter);
    if (!next.members.includes(option.provider)) next.members.push(option.provider);
    const slot = slotsFor(option.wanter).find((s) => s.id === option.slot) as Extract<SlotInfo, { side: 'want' }>;
    const wk = wantKey(option.wanter, option.slot);
    if (!next.needs.has(wk)) {
      next.needs.set(wk, optionQty(slot.options, intents.get(option.provider)!.give[option.giveIdx]!));
    }
    next.allocs.push({ ...option });
    const gk = giveKey(option.provider, option.giveIdx);
    next.used.set(gk, (next.used.get(gk) ?? 0) + option.qty);
    return next;
  };

  const choices = (state: State): State[] | null => {
    for (const member of state.members) {
      for (const slot of slotsFor(member)) {
        if (slot.side === 'want') {
          const need = state.needs.get(wantKey(member, slot.id));
          if (need !== undefined && got(state, member, slot.id) >= need) continue;
          return wantOptions(state, member, slot)
            .sort((a, b) => compare(rankChoice(state, a.provider, seedId), rankChoice(state, b.provider, seedId)))
            .map((option) => apply(state, option));
        }
        if (!state.allocs.some((a) => a.provider === member && a.giveIdx === slot.index)) {
          return takeOptions(state, member, slot.index)
            .sort((a, b) => compare(rankChoice(state, a.wanter, seedId), rankChoice(state, b.wanter, seedId)))
            .map((option) => apply(state, option));
        }
      }
    }
    return null;
  };

  const search = (state: State): State | null => {
    if (!meter.tick()) return null;
    const next = choices(state);
    if (next === null) return state;
    for (const candidate of next) {
      const found = search(candidate);
      if (found) return found;
      if (meter.exhausted) return null;
    }
    return null;
  };

  const found = search({ members: initial, allocs: [], used: new Map(), needs: new Map() });
  if (!found) return { draft: null, budgetExhausted: meter.exhausted };
  const draft = finalizeDraft(found.members, buildLinks(found.allocs, intents), intents, false);
  return { draft, budgetExhausted: false };
}
