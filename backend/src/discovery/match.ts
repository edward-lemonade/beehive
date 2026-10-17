import type { Flow, EdgeCover, IntentPublic, Item, NearMiss, RelevantEdge, WantItem } from '../contracts/index.js';

export type MatchResult = 'match' | 'dates' | 'none';

const norm = (value: string | number): string => String(value).trim().toLowerCase();

function rangeOf(item: Item): [string, string] | null {
  const start = item.attrs.dateStart;
  const end = item.attrs.dateEnd;
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  return [start, end];
}

function matchDetail(given: Item, wanted: Item): MatchResult {
  if (given.kind === 'cash' || wanted.kind === 'cash') return 'none';
  if (given.kind !== wanted.kind || norm(given.label) !== norm(wanted.label)) return 'none';
  if (given.qty < wanted.qty) return 'none';

  let datesFail = false;
  for (const [key, value] of Object.entries(wanted.attrs)) {
    if (given.kind === 'sublet' && (key === 'dateStart' || key === 'dateEnd')) continue;
    const have = given.attrs[key];
    if (have === undefined || norm(have) !== norm(value)) return 'none';
  }

  if (given.kind === 'sublet') {
    const offered = rangeOf(given);
    const needed = rangeOf(wanted);
    if (needed) {
      if (!offered) return 'none';
      const contained = offered[0] <= needed[0] && needed[1] <= offered[1];
      if (!contained) {
        const overlaps = offered[0] <= needed[1] && needed[0] <= offered[1];
        if (!overlaps) return 'none';
        datesFail = true;
      }
    }
  }
  return datesFail ? 'dates' : 'match';
}

export function itemMatchDetail(given: Item, wanted: WantItem | Item): MatchResult {
  if (!('anyOf' in wanted)) return matchDetail(given, wanted);
  let best: MatchResult = 'none';
  for (const option of wanted.anyOf) {
    const result = matchDetail(given, option);
    if (result === 'match') return 'match';
    if (result === 'dates') best = 'dates';
  }
  return best;
}

export function itemMatch(given: Item, wanted: WantItem | Item): boolean {
  return itemMatchDetail(given, wanted) === 'match';
}

function coversFor(wanter: IntentPublic, giver: IntentPublic): EdgeCover[] {
  const covers: EdgeCover[] = [];
  wanter.want.forEach((slot, index) => {
    const item = giver.give.find((candidate) => itemMatch(candidate, slot));
    if (item) covers.push({ slot: `w${index}`, provider: giver.intentId, item });
  });
  return covers;
}

function flowsFor(giver: IntentPublic, wanter: IntentPublic): Flow[] {
  const flows: Flow[] = [];
  for (const item of giver.give) {
    if (wanter.want.some((slot) => itemMatch(item, slot))) {
      flows.push({ from: giver.intentId, to: wanter.intentId, item });
    }
  }
  return flows;
}

// Edge from x's point of view: what y can give x and what x can give y. Cash alone never counts.
export function directlyRelevant(x: IntentPublic, y: IntentPublic): RelevantEdge | null {
  const selfWants = coversFor(x, y);
  const selfGives = flowsFor(x, y);
  if (selfWants.length === 0 && selfGives.length === 0) return null;
  return { self: x.intentId, other: y.intentId, otherVersion: y.version, selfWants, selfGives };
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function cashTotal(items: Item[]): number {
  return items.filter((i) => i.kind === 'cash').reduce((sum, i) => sum + (i.amountCents ?? 0) * i.qty, 0);
}

function wantedCash(slots: WantItem[]): number {
  return slots.reduce((sum, slot) => {
    const cash = slot.anyOf.filter((i) => i.kind === 'cash').map((i) => (i.amountCents ?? 0) * i.qty);
    return sum + (cash.length > 0 ? Math.min(...cash) : 0);
  }, 0);
}

// Public parts only; text never contains handles or free text.
export function nearMissBetween(x: IntentPublic, y: IntentPublic): NearMiss[] {
  const misses: NearMiss[] = [];
  const handle = y.ownerHandle;

  const incoming = coversFor(x, y);
  if (incoming.length > 0) {
    const have = cashTotal(x.give);
    const asked = wantedCash(y.want);
    if (asked > have && have > 0) {
      misses.push({
        otherHandle: handle,
        kind: 'price',
        gapCents: asked - have,
        text: `Closest ${incoming[0]!.item.label} I found is ${dollars(asked)}, you're at ${dollars(have)}.`,
      });
    }
  }
  const outgoing = flowsFor(x, y);
  if (outgoing.length > 0) {
    const asked = wantedCash(x.want);
    const offered = cashTotal(y.give);
    if (asked > offered && offered > 0) {
      misses.push({
        otherHandle: handle,
        kind: 'price',
        gapCents: asked - offered,
        text: `Best offer for your ${outgoing[0]!.item.label} is ${dollars(offered)}, you're at ${dollars(asked)}.`,
      });
    }
  }

  const dateHit = (giver: IntentPublic, wanter: IntentPublic): boolean =>
    wanter.want.some((slot) => giver.give.some((item) => itemMatchDetail(item, slot) === 'dates'));
  if (dateHit(y, x) || dateHit(x, y)) {
    misses.push({
      otherHandle: handle,
      kind: 'dates',
      gapCents: 0,
      text: "A sublet overlaps your dates but doesn't cover them fully.",
    });
  }
  return misses;
}
