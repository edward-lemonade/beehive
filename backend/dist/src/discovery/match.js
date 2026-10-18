import { hasAlias, pairVerdict } from './semantic.js';
const norm = (value) => String(value).trim().toLowerCase();
const words = (label) => norm(label).split(/[^a-z0-9]+/).filter(Boolean);
function sameWord(a, b) {
    if (a === b)
        return true;
    if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1)
        return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i++;
            j++;
            continue;
        }
        if (++edits > 1)
            return false;
        if (a.length > b.length)
            i++;
        else if (b.length > a.length)
            j++;
        else {
            i++;
            j++;
        }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
}
// Labels are LLM-written, so "ticket" and "niteharts-saturday-ticket" must still match: one side's words are all in the other.
export function labelsMatch(a, b) {
    if (hasAlias(a, b))
        return true;
    const x = words(a);
    const y = words(b);
    if (x.length === 0 || y.length === 0)
        return norm(a) === norm(b);
    const [small, big] = x.length <= y.length ? [x, y] : [y, x];
    return small.every((w) => big.some((v) => sameWord(w, v)));
}
function rangeOf(item) {
    const start = item.attrs.dateStart;
    const end = item.attrs.dateEnd;
    if (typeof start !== 'string' || typeof end !== 'string')
        return null;
    return [start, end];
}
function matchDetail(given, wanted) {
    if (given.kind === 'cash' || wanted.kind === 'cash')
        return 'none';
    if (given.kind !== wanted.kind || !labelsMatch(given.label, wanted.label))
        return 'none';
    if (given.qty < wanted.qty)
        return 'none';
    let datesFail = false;
    for (const [key, value] of Object.entries(wanted.attrs)) {
        if (given.kind === 'sublet' && (key === 'dateStart' || key === 'dateEnd'))
            continue;
        const have = given.attrs[key];
        if (have === undefined || norm(have) !== norm(value))
            return 'none';
    }
    if (given.kind === 'sublet') {
        const offered = rangeOf(given);
        const needed = rangeOf(wanted);
        if (needed) {
            if (!offered)
                return 'none';
            const contained = offered[0] <= needed[0] && needed[1] <= offered[1];
            if (!contained) {
                const overlaps = offered[0] <= needed[1] && needed[0] <= offered[1];
                if (!overlaps)
                    return 'none';
                datesFail = true;
            }
        }
    }
    return datesFail ? 'dates' : 'match';
}
export function itemMatchDetail(given, wanted) {
    if (!('anyOf' in wanted))
        return matchDetail(given, wanted);
    let best = 'none';
    for (const option of wanted.anyOf) {
        const result = matchDetail(given, option);
        if (result === 'match')
            return 'match';
        if (result === 'dates')
            best = 'dates';
    }
    return best;
}
export function itemMatch(given, wanted) {
    return itemMatchDetail(given, wanted) === 'match';
}
// An LLM verdict on the pair (from the listings' own words) overrides the label comparison.
function agree(given, wanted, verdict) {
    if (verdict === undefined)
        return itemMatch(given, wanted);
    if (!verdict)
        return false;
    const options = 'anyOf' in wanted ? wanted.anyOf : [wanted];
    return options.some((o) => o.kind === given.kind && o.kind !== 'cash' && itemMatch(given, { ...o, label: given.label }));
}
function coversFor(wanter, giver) {
    const covers = [];
    const verdict = pairVerdict(wanter, giver);
    const used = new Set();
    const overlap = (a, b) => {
        const other = words(b.label);
        return words(a.label).filter((w) => other.some((v) => sameWord(w, v))).length;
    };
    // Exact fits claim their item first so a verdict-only match never takes an item that belongs to another slot.
    const chosen = new Map();
    if (verdict !== false) {
        wanter.want.forEach((slot, index) => {
            const exact = giver.give.find((c) => !used.has(c) && itemMatch(c, slot));
            if (exact) {
                used.add(exact);
                chosen.set(index, exact);
            }
        });
    }
    wanter.want.forEach((slot, index) => {
        if (chosen.has(index))
            return;
        const ranked = giver.give
            .filter((c) => !used.has(c) && agree(c, slot, verdict))
            .sort((x, y) => Math.max(...slot.anyOf.map((o) => overlap(y, o))) - Math.max(...slot.anyOf.map((o) => overlap(x, o))));
        const pick = ranked[0];
        if (pick) {
            used.add(pick);
            chosen.set(index, pick);
        }
    });
    wanter.want.forEach((_, index) => {
        const item = chosen.get(index);
        if (item)
            covers.push({ slot: `w${index}`, provider: giver.intentId, item });
    });
    return covers;
}
function flowsFor(giver, wanter) {
    const flows = [];
    const verdict = pairVerdict(wanter, giver);
    for (const item of giver.give) {
        if (wanter.want.some((slot) => agree(item, slot, verdict))) {
            flows.push({ from: giver.intentId, to: wanter.intentId, item });
        }
    }
    return flows;
}
// Edge from x's point of view: what y can give x and what x can give y. Cash alone never counts.
export function directlyRelevant(x, y) {
    const selfWants = coversFor(x, y);
    const selfGives = flowsFor(x, y);
    if (selfWants.length === 0 && selfGives.length === 0)
        return null;
    return { self: x.intentId, other: y.intentId, otherVersion: y.version, selfWants, selfGives };
}
const dollars = (cents) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
function cashTotal(items) {
    return items.filter((i) => i.kind === 'cash').reduce((sum, i) => sum + (i.amountCents ?? 0) * i.qty, 0);
}
function wantedCash(slots) {
    return slots.reduce((sum, slot) => {
        const cash = slot.anyOf.filter((i) => i.kind === 'cash').map((i) => (i.amountCents ?? 0) * i.qty);
        return sum + (cash.length > 0 ? Math.min(...cash) : 0);
    }, 0);
}
// Public parts only; text never contains handles or free text.
export function nearMissBetween(x, y) {
    const misses = [];
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
                text: `Closest ${incoming[0].item.label} I found is ${dollars(asked)}, you're at ${dollars(have)}.`,
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
                text: `Best offer for your ${outgoing[0].item.label} is ${dollars(offered)}, you're at ${dollars(asked)}.`,
            });
        }
    }
    const dateHit = (giver, wanter) => wanter.want.some((slot) => giver.give.some((item) => itemMatchDetail(item, slot) === 'dates'));
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
