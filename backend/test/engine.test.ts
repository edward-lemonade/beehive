import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Arrangement, RelevantEdge } from '../src/contracts/index.js';
import {
  arrangementKey,
  buildArrangement,
  findClosedSets,
  findReplacement,
  localStatus,
  pruneToReady,
  rank,
  type Budget,
} from '../src/engine/index.js';
import { cash, edgesFor, intent, simulateSignals, ticket, toMap } from './fixtures/engine.js';

const budget: Budget = { maxExpansions: 200, maxMs: 5000 };

function closed(list: ReturnType<typeof intent>[], b: Budget = budget) {
  const intents = toMap(list);
  const edges = edgesFor(intents);
  const signals = simulateSignals(intents, edges);
  return { intents, edges, signals, result: findClosedSets(intents, signals, edges, b) };
}

const s1 = () => [
  intent('A', [cash(30000)], [[ticket('x1')]]),
  intent('B', [ticket('x1')], [[ticket('x2')]]),
  intent('C', [ticket('x2')], [[cash(30000)]]),
];

describe('S1 chain', () => {
  it('forms one set of 3 with links A-B (A pays) and B-C (B pays)', () => {
    const { intents, edges, result } = closed(s1());
    expect(result.sets).toEqual([['A', 'B', 'C']]);
    const { draft } = buildArrangement(result.sets[0]!, intents, edges, budget);
    expect(draft!.links.map((l) => [l.a, l.b, l.payer])).toEqual([['A', 'B', 'A'], ['B', 'C', 'B']]);
    expect(draft!.key).toBe('A@1|B@1|C@1');
  });

  it('gives the same key from every seed', () => {
    const { intents, edges } = closed(s1());
    const keys = ['A', 'B', 'C'].map((seed) => buildArrangement(['A', 'B', 'C'], intents, edges, budget, { seed }).draft!.key);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('other shapes', () => {
  it('chain of 4 forms a line', () => {
    const { intents, edges, result } = closed([
      intent('A', [cash(100)], [[ticket('x1')]]),
      intent('B', [ticket('x1')], [[ticket('x2')]]),
      intent('C', [ticket('x2')], [[ticket('x3')]]),
      intent('D', [ticket('x3')], [[cash(100)]]),
    ]);
    expect(result.sets).toEqual([['A', 'B', 'C', 'D']]);
    const { draft } = buildArrangement(result.sets[0]!, intents, edges, budget);
    expect(draft!.links.map((l) => l.id)).toEqual(['A|B', 'B|C', 'C|D']);
  });

  it('three-way swap has no cash', () => {
    const { intents, edges, result } = closed([
      intent('A', [ticket('x')], [[ticket('y')]]),
      intent('B', [ticket('y')], [[ticket('z')]]),
      intent('C', [ticket('z')], [[ticket('x')]]),
    ]);
    expect(result.sets).toEqual([['A', 'B', 'C']]);
    const { draft } = buildArrangement(result.sets[0]!, intents, edges, budget);
    expect(draft!.links).toHaveLength(3);
    expect(draft!.links.every((l) => l.payer === null)).toBe(true);
  });

  it('S10: user gives Fri and Sat and wants a 3-day; two buyers and a seller form a star', () => {
    const { intents, edges, result } = closed([
      intent('U', [ticket('fri'), ticket('sat')], [[ticket('3day')]]),
      intent('S', [ticket('3day')], [[cash(40000)]]),
      intent('B1', [cash(15000)], [[ticket('fri')]]),
      intent('B2', [cash(15000)], [[ticket('sat')]]),
    ]);
    expect(result.sets).toEqual([['B1', 'B2', 'S', 'U']]);
    const { draft } = buildArrangement(result.sets[0]!, intents, edges, budget, { seed: 'U' });
    expect(draft!.links.map((l) => [l.id, l.payer])).toEqual([
      ['B1|U', 'B1'], ['B2|U', 'B2'], ['S|U', 'U'],
    ]);
    expect(draft!.declaredNet.U).toBe(30000 - 40000);
  });

  it('one seller with qty 4 serves two buyers of qty 2, but not three', () => {
    const base = [
      intent('S', [ticket('t', 4)], [[cash(100)]]),
      intent('B1', [cash(100)], [[ticket('t', 2)]]),
      intent('B2', [cash(100)], [[ticket('t', 2)]]),
    ];
    const two = closed(base);
    expect(two.result.sets).toEqual([['B1', 'B2', 'S']]);
    const built = buildArrangement(['B1', 'B2', 'S'], two.intents, two.edges, budget, { must: ['B1', 'B2'] });
    expect(built.draft!.links.flatMap((l) => l.flows.map((f) => f.item.qty))).toEqual([2, 2]);

    const three = closed([...base, intent('B3', [cash(100)], [[ticket('t', 2)]])]);
    const over = buildArrangement(['B1', 'B2', 'B3', 'S'], three.intents, three.edges, budget, { must: ['B1', 'B2', 'B3'] });
    expect(over.draft).toBeNull();
  });

  it('splits one wanted quantity across providers', () => {
    const intents = toMap([
      intent('B', [cash(100)], [[ticket('t', 4)]]),
      intent('P1', [ticket('t', 2)], [[cash(100)]]),
      intent('P2', [ticket('t', 2)], [[cash(100)]]),
    ]);
    const cover = (provider: string): RelevantEdge => ({
      self: 'B', other: provider, otherVersion: 1,
      selfWants: [{ slot: 'w0', provider, item: ticket('t', 2) }],
      selfGives: [],
    });
    const back = (provider: string): RelevantEdge => ({
      self: provider, other: 'B', otherVersion: 1, selfWants: [],
      selfGives: [{ from: provider, to: 'B', item: ticket('t', 2) }],
    });
    const edges = new Map([['B', [cover('P1'), cover('P2')]], ['P1', [back('P1')]], ['P2', [back('P2')]]]);
    const { draft } = buildArrangement(['B', 'P1', 'P2'], intents, edges, budget);
    expect(draft!.links.map((l) => l.flows[0]!.item.qty)).toEqual([2, 2]);
  });
});

describe('ready set', () => {
  it('retraction of D drops C, B and A', () => {
    const intents = toMap([
      intent('A', [cash(100)], [[ticket('x1')]]),
      intent('B', [ticket('x1')], [[ticket('x2')]]),
      intent('C', [ticket('x2')], [[ticket('x3')]]),
      intent('D', [ticket('x3')], [[cash(100)]]),
    ]);
    expect([...pruneToReady(intents, edgesFor(intents))].sort()).toEqual(['A', 'B', 'C', 'D']);
    intents.delete('D');
    expect(pruneToReady(intents, edgesFor(intents)).size).toBe(0);
  });

  it('leaves out intents with an unsatisfiable slot', () => {
    const { result } = closed([
      intent('A', [cash(100)], [[ticket('x1')]]),
      intent('B', [ticket('x1')], [[ticket('x2')]]),
    ]);
    expect(result.sets).toEqual([]);
  });

  it('ignores signals built on an old version', () => {
    const { intents, edges, signals } = closed(s1());
    const stale = signals.map((s) => (s.from === 'B' ? { ...s, fromVersion: 0 } : s));
    expect(findClosedSets(intents, stale, edges, budget).sets).toEqual([]);

    const status = localStatus(intents.get('A')!, edges.get('A')!, stale);
    expect(status.satisfiable).toBe(false);
    expect(localStatus(intents.get('A')!, edges.get('A')!, signals)).toEqual({
      satisfiable: true, covers: { w0: ['B'] },
    });
  });

  it('ignores edges to a changed version', () => {
    const intents = toMap(s1());
    const edges = edgesFor(intents);
    intents.set('C', { ...intents.get('C')!, version: 2 });
    expect(pruneToReady(intents, edges).size).toBe(0);
  });
});

describe('budget', () => {
  const ring = Array.from({ length: 60 }, (_, i) =>
    intent(`i${String(i).padStart(2, '0')}`, [ticket(`t${i}`)], [[ticket(`t${(i + 1) % 60}`)]]));

  it('stops closed-set search at the budget', () => {
    const { result } = closed(ring, { maxExpansions: 10, maxMs: 5000 });
    expect(result.budgetExhausted).toBe(true);
    expect(result.sets).toEqual([]);
  });

  it('stops building at the budget and still solves within it', () => {
    const intents = toMap(ring);
    const edges = edgesFor(intents);
    const set = ring.map((i) => i.intentId);
    expect(buildArrangement(set, intents, edges, { maxExpansions: 10, maxMs: 5000 })).toEqual({
      draft: null, budgetExhausted: true,
    });
    expect(buildArrangement(set, intents, edges, budget).draft!.slots).toHaveLength(60);
  });

  it('stops on the time limit', () => {
    let t = 0;
    const intents = toMap(ring);
    const result = buildArrangement(ring.map((i) => i.intentId), intents, edgesFor(intents), {
      maxExpansions: 1000, maxMs: 5, now: () => (t += 3),
    });
    expect(result.budgetExhausted).toBe(true);
  });
});

describe('rank and replacement', () => {
  it('orders by participants, then net, then tier', () => {
    const { intents, edges } = closed(s1());
    const three = buildArrangement(['A', 'B', 'C'], intents, edges, budget).draft!;
    const two = { ...three, slots: three.slots.slice(0, 2), key: 'x' };
    expect(rank(two, three, 'A')).toBeLessThan(0);
    const richer = { ...three, key: 'y', declaredNet: { ...three.declaredNet, A: 5 } };
    expect(rank(richer, three, 'A')).toBeLessThan(0);
    const better = { ...three, key: 'z', tierScore: 2 };
    expect(rank(better, three, 'A')).toBeLessThan(0);
  });

  it('replaces a vacated intent with an identical candidate and skips decliners', () => {
    const list = [...s1(), intent('C2', [ticket('x2')], [[cash(28000)]]), intent('C3', [ticket('other')], [[cash(1)]])];
    const intents = toMap(list);
    const edges = edgesFor(intents);
    const original = buildArrangement(['A', 'B', 'C'], intents, edges, budget, { seed: 'A' }).draft!;
    const arrangement: Arrangement = {
      id: 'arr', key: original.key, state: 'proposed', revision: 1, slots: original.slots, links: original.links,
    };
    const replaced = findReplacement(arrangement, 'C', ['C3', 'C2'], intents, edges)!;
    expect(replaced.key).toBe('A@1|B@1|C2@1');
    expect(replaced.links.map((l) => l.id)).toEqual(['A|B', 'B|C2']);
    expect(replaced.links.every((l) => l.state === 'unpriced')).toBe(true);
    expect(findReplacement(arrangement, 'C', ['C2'], intents, edges, new Set(['C2']))).toBeNull();
    expect(findReplacement(arrangement, 'C', ['C3'], intents, edges)).toBeNull();
  });

  it('builds keys from sorted intentId@version', () => {
    expect(arrangementKey([{ intentId: 'b', intentVersion: 2 }, { intentId: 'a', intentVersion: 1 }])).toBe('a@1|b@2');
  });
});

describe('engine purity', () => {
  it('imports no db, clock, events or private data', () => {
    const dir = new URL('../src/engine/', import.meta.url);
    for (const file of readdirSync(dir)) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      expect(source).not.toMatch(/from '\.\.\/(db|clock|events|config)/);
      expect(source).not.toMatch(/IntentPrivate|minNetCents|\.private/);
    }
  });
});
