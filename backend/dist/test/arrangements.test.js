import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryArrangementRepository, arrangementSettings, coordinator, setArrangementRepository, setContactLookup, startCoordinator, } from '../src/arrangements/index.js';
import { stopCoordinator } from '../src/arrangements/coordinator.js';
import * as service from '../src/arrangements/service.js';
import { ArrangementError } from '../src/arrangements/types.js';
import { termsView } from '../src/arrangements/terms.js';
import { MemoryNoticeRepository } from '../src/discovery/notices.js';
import { refreshEdges, resetNearMissDeliveries, setNoticeRepository } from '../src/discovery/service.js';
import { events } from '../src/events.js';
import { setIntentParser, setIntentRepository } from '../src/intents/service.js';
import { parseIntentText } from '../src/intents/parse.js';
import app from '../src/index.js';
import { MemoryNegotiationLogRepository, negotiationLog, setNegotiationLogRepository } from '../src/negotiation/log.js';
import { installNegotiation, resetSessions } from '../src/negotiation/session.js';
import { setWordingProvider, templateWording } from '../src/negotiation/wording.js';
import { bus } from '../src/runtime/bus.js';
import { buildGuardContext } from '../src/runtime/guard-context.js';
import { resetHooks } from '../src/runtime/hooks.js';
import { ensureAgent, scheduler, startRuntime, stopRuntime } from '../src/runtime/registry.js';
import { MemorySignalRepository, setSignalRepository } from '../src/runtime/signals.js';
import { SEED_SCENARIOS, SEED_USERS, postScenario, seedOptions } from '../src/seed/scenario.js';
import { runAgentChat, setChatCompleter } from '../src/agent/chat.js';
const ticket = (label) => ({ kind: 'ticket', label, attrs: {}, qty: 1 });
const cash = (amountCents) => ({ kind: 'cash', label: 'cash', attrs: {}, qty: 1, amountCents });
class MemoryRepo {
    intents = new Map();
    async createMany(records) { records.forEach((r) => this.intents.set(r.id, r)); return records; }
    async get(id) { return this.intents.get(id); }
    async saveVersion(record) { this.intents.set(record.id, record); return true; }
    async changeState() { return undefined; }
    async expireDue() { return []; }
    async listMine(ownerId) { return [...this.intents.values()].filter((i) => i.ownerId === ownerId); }
    async remove(id, ownerId, state) { const i = this.intents.get(id); if (!i || i.ownerId !== ownerId || i.state !== state)
        return false; return this.intents.delete(id); }
    async listOpen() { return [...this.intents.values()].filter((i) => i.state === 'open'); }
}
let repo;
let arrs;
let sent;
const onNotify = (n) => { sent.push(n); };
function add(id, give, want, minNetCents) {
    const publicView = {
        intentId: id, version: 1, ownerHandle: `h-${id}`, tier: 'new', give,
        want: want.map((anyOf) => ({ anyOf })), deadline: null, freeText: '',
    };
    repo.intents.set(id, {
        id, draftId: id, ownerId: `u${id}`, version: 1, state: 'open', public: publicView,
        private: { minNetCents, declaredNetCents: null }, sourceText: '', parsed: {}, createdAt: 0, updatedAt: 0,
    });
}
// alice pays bob, bob pays carol.
function chain() {
    add('alice', [cash(6000)], [[ticket('x1')]], -6000);
    add('bob', [ticket('x1')], [[ticket('x2')]], 0);
    add('carol', [ticket('x2')], [[cash(5000)]], 5000);
}
async function waitFor(check, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await check())
            return;
        await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error('waitFor timed out');
}
const rows = () => [...arrs.rows.values()];
const byState = (state) => rows().filter((r) => r.state === state);
const kinds = (userId, kind) => sent.filter((n) => n.userId === userId && n.kind === kind);
async function start(...ids) {
    for (const id of ids)
        await refreshEdges(id);
    await startRuntime();
    await startCoordinator({ rehydrate: false });
}
beforeEach(() => {
    repo = new MemoryRepo();
    arrs = new MemoryArrangementRepository();
    sent = [];
    events.on('notify', onNotify);
    setIntentRepository(repo);
    setSignalRepository(new MemorySignalRepository());
    setNoticeRepository(new MemoryNoticeRepository());
    setNegotiationLogRepository(new MemoryNegotiationLogRepository());
    setArrangementRepository(arrs);
    setContactLookup(async (ids) => new Map(ids.map((id) => [id, `+1-${id}`])));
    setWordingProvider(async (ctx) => templateWording(ctx));
    resetNearMissDeliveries();
    bus.reset();
    resetHooks();
    installNegotiation();
    bus.setGuardContext(buildGuardContext);
    scheduler.coalesceMs = 10;
    coordinator.coalesceMs = 10;
    arrangementSettings.approvalWindowMs = 60_000;
    arrangementSettings.replaceWindowMs = 60_000;
    arrangementSettings.pendingCap = 3;
});
afterEach(() => {
    events.off('notify', onNotify);
    stopCoordinator();
    stopRuntime();
    resetSessions();
    bus.reset();
    resetHooks();
    setWordingProvider();
    setNegotiationLogRepository();
    setArrangementRepository();
    setContactLookup();
    setIntentRepository();
    setIntentParser();
    setChatCompleter();
    setSignalRepository();
    setNoticeRepository();
});
describe('end to end', () => {
    it('does not turn an agent-originated opening into consent from its user', async () => {
        const money = { kind: 'cash', label: 'cash', attrs: {}, qty: 1 };
        add('buyer', [money], [[ticket('concert')]], null);
        add('seller', [ticket('concert')], [[cash(11000)]], null);
        add('firm', [ticket('concert')], [[{ ...cash(10000), flex: 'firm' }]], 10000);
        await start('buyer', 'seller', 'firm');
        await waitFor(() => byState('proposed').length === 2);
        const arr = byState('proposed').find((entry) => entry.slots.some((slot) => slot.intentId === 'seller'));
        expect(arr.proposal).toMatchObject({ fromIntentId: 'buyer', amountCents: 9000, source: 'agent' });
        await service.approve('useller', arr.id);
        const accepted = arrs.rows.get(arr.id);
        expect(accepted.state).toBe('proposed');
        expect(accepted.proposal).toBeNull();
        expect(accepted.slots.find((slot) => slot.intentId === 'seller').approval).toBe('approved');
        expect(accepted.slots.find((slot) => slot.intentId === 'buyer').approval).toBe('requested');
        await service.approve('ubuyer', arr.id);
        expect(arrs.rows.get(arr.id).state).toBe('committed');
    });
    it('loads the shopping seed and proposes $90 with dawg while preserving the $100 firm option', async () => {
        expect(seedOptions().map((scenario) => scenario.id)).toEqual(['ticket-swap', 'ticket-shopping']);
        expect(SEED_SCENARIOS[0].users).toBe(SEED_USERS);
        const scenario = SEED_SCENARIOS[1];
        setIntentParser(async (text) => parseIntentText(text));
        await postScenario(scenario.users.map((user) => ({ id: `u-${user.handle}`, handle: user.handle, tier: 'new' })), scenario.id);
        const intents = [...repo.intents.values()];
        const buyer = intents.find((intent) => intent.public.ownerHandle === 'edward');
        const firm = intents.find((intent) => intent.public.ownerHandle === 'kat');
        const negotiable = intents.find((intent) => intent.public.ownerHandle === 'dawg');
        expect(buyer.private.minNetCents).toBeNull();
        expect(firm.private.minNetCents).toBe(10000);
        expect(negotiable.private.minNetCents).toBeNull();
        await start(...intents.map((intent) => intent.id));
        await waitFor(() => byState('proposed').length === 2);
        await coordinator.idle();
        const offers = await negotiationLog().forIntents([buyer.id], 100);
        expect(offers.find((entry) => entry.kind === 'offer' && entry.to === negotiable.id)).toMatchObject({
            from: buyer.id, amountCents: 9000,
        });
        const mine = await service.listMine(buyer.ownerId);
        expect(mine.flatMap((entry) => entry.terms.cashOut)).toEqual(expect.arrayContaining([
            { toHandle: 'kat', amountCents: 10000 },
            { toHandle: 'dawg', amountCents: 9000 },
        ]));
        expect(byState('committed')).toHaveLength(0);
        const shoppingDeal = mine.find((entry) => entry.terms.cashOut.some((cash) => cash.toHandle === 'dawg'));
        let marketCalls = 0;
        setChatCompleter(async (messages) => {
            marketCalls++;
            const context = messages[0].content;
            expect(context).toContain(`ownIntentId=${buyer.id}`);
            expect(context.match(new RegExp(`ownIntentId=${buyer.id}`, 'g'))).toHaveLength(2);
            expect(context).toContain('pay $100 to kat');
            expect(context).toContain('pay $90 to dawg');
            expect(context).toContain("The user's agent offered $90 to dawg");
            expect(context).toContain('waiting for their answer');
            const event = messages[messages.length - 1].content;
            expect(event).toContain('Review the market as a whole');
            expect(event).toContain(shoppingDeal.terms.arrangementId);
            expect(event).not.toContain('11000');
            expect(event).not.toContain('unowned-arrangement');
            return JSON.stringify({ reply: 'model-output-market-review', action: null });
        });
        const review = await runAgentChat({
            user: { id: buyer.ownerId, handle: 'edward', tier: 'new' },
            event: {
                kind: 'market_update',
                arrangementIds: [...mine.map((entry) => entry.terms.arrangementId), 'unowned-arrangement'],
                amountCents: 11000,
            },
            history: [],
        });
        expect(marketCalls).toBe(1);
        expect(review.reply).toBe('model-output-market-review');
        expect(review.changed).toBe(false);
        expect(shoppingDeal.terms.proposal).toMatchObject({
            amountCents: 9000, otherHandle: 'dawg', awaiting: 'counterparty', source: 'agent',
        });
        const openingForSeller = (await service.listMine(negotiable.ownerId)).find((entry) => entry.terms.arrangementId === shoppingDeal.terms.arrangementId);
        expect(openingForSeller.terms.proposal).toMatchObject({
            amountCents: 9000, otherHandle: 'edward', awaiting: 'user', source: 'agent',
        });
        await expect(service.approve(buyer.ownerId, shoppingDeal.terms.arrangementId)).rejects.toThrow(/waiting for the other user/);
        let openingCalls = 0;
        setChatCompleter(async (messages) => {
            openingCalls++;
            expect(messages[0].content).toContain("edward's agent offered $90");
            expect(messages[0].content).toContain('waiting on the USER');
            return JSON.stringify({ reply: 'model-output-opening', action: null });
        });
        const openingNotice = await runAgentChat({
            user: { id: negotiable.ownerId, handle: 'dawg', tier: 'new' },
            event: { kind: 'approval_request', arrangementId: shoppingDeal.terms.arrangementId }, history: [],
        });
        expect(openingCalls).toBe(1);
        expect(openingNotice.reply).toBe('model-output-opening');
        const updates = [];
        const onUpdate = ({ arrangementId }) => {
            if (arrangementId === shoppingDeal.terms.arrangementId) {
                updates.push(arrs.rows.get(arrangementId).proposal.amountCents);
            }
        };
        events.on('arrangement.updated', onUpdate);
        try {
            let step = 0;
            setChatCompleter(async (messages) => {
                if (step++ === 0)
                    return JSON.stringify({
                        reply: '', action: { type: 'negotiate_arrangement', arrangementId: shoppingDeal.terms.arrangementId, targetCents: 10000 },
                    });
                expect(messages[0].content).toContain('receive $100 from edward');
                expect(messages[0].content).not.toContain('receive $90 from edward');
                expect(messages[0].content).toContain('waiting for their answer');
                return JSON.stringify({ reply: 'model-output-counter', action: null });
            });
            const counter = await runAgentChat({
                user: { id: negotiable.ownerId, handle: 'dawg', tier: 'new' },
                message: "No. I'll do $100 max", history: [],
            });
            expect(counter.changed).toBe(true);
            expect(updates).toEqual([10000]);
        }
        finally {
            events.off('arrangement.updated', onUpdate);
        }
        const buyerTerms = (await service.listMine(buyer.ownerId)).find((entry) => entry.terms.arrangementId === shoppingDeal.terms.arrangementId).terms;
        const sellerTerms = (await service.listMine(negotiable.ownerId)).find((entry) => entry.terms.arrangementId === shoppingDeal.terms.arrangementId).terms;
        expect(buyerTerms).toMatchObject({
            cashOut: [{ toHandle: 'dawg', amountCents: 10000 }],
            netCents: -10000,
            approval: 'requested',
            proposal: { amountCents: 10000, otherHandle: 'dawg', awaiting: 'user' },
        });
        expect(sellerTerms).toMatchObject({
            cashIn: [{ fromHandle: 'edward', amountCents: 10000 }],
            proposal: { amountCents: 10000, otherHandle: 'edward', awaiting: 'counterparty' },
        });
        expect(buyerTerms.revision).toBeGreaterThan(shoppingDeal.terms.revision);
        // Check the model's factual inputs and that its output is used, not an injected scenario response.
        let noticeCalls = 0;
        setChatCompleter(async (messages) => {
            noticeCalls++;
            expect(messages[0].content).toContain(noticeCalls === 1 ? 'dawg proposed $100' : 'You proposed $100 to edward');
            expect(messages[0].content).not.toContain('receive $90 from edward');
            expect(messages[0].content).not.toContain('pay $90 to dawg');
            expect(messages[messages.length - 1].content).not.toContain('9000');
            return JSON.stringify({ reply: `model-output-notice-${noticeCalls}`, action: null });
        });
        const event = { kind: 'approval_request', arrangementId: shoppingDeal.terms.arrangementId, amountCents: 9000 };
        const buyerNotice = await runAgentChat({
            user: { id: buyer.ownerId, handle: 'edward', tier: 'new' }, event,
            history: [{ from: 'agent', text: "Dawg's price is $90. Should we go with that?" }],
        });
        expect(buyerNotice.reply).toBe('model-output-notice-1');
        const sellerNotice = await runAgentChat({
            user: { id: negotiable.ownerId, handle: 'dawg', tier: 'new' }, event, history: [],
        });
        expect(sellerNotice.reply).toBe('model-output-notice-2');
        expect(noticeCalls).toBe(2);
        await expect(service.approve(negotiable.ownerId, shoppingDeal.terms.arrangementId)).rejects.toThrow(/waiting for the other user/);
        await expect(service.approve(buyer.ownerId, shoppingDeal.terms.arrangementId, {
            expectedRevision: shoppingDeal.terms.revision,
        })).rejects.toThrow(/proposal changed/);
        await service.approve(buyer.ownerId, shoppingDeal.terms.arrangementId);
        const final = (await service.listMine(buyer.ownerId)).find((entry) => entry.terms.arrangementId === shoppingDeal.terms.arrangementId).terms;
        expect(final.state).toBe('committed');
        expect(final.cashOut).toEqual([{ toHandle: 'dawg', amountCents: 10000 }]);
        expect(final.proposal).toBeUndefined();
    });
    it('clears every historical arrangement involving seed users while preserving unrelated users', async () => {
        const arrangement = (id, state, userId) => ({
            id,
            key: `${id}@1`,
            state,
            revision: 1,
            reason: null,
            excluded: [],
            declaredNet: {},
            replaceDeadline: null,
            createdAt: 0,
            updatedAt: 0,
            slots: [{
                    intentId: `intent-${id}`,
                    userId,
                    intentVersion: 1,
                    approval: state === 'committed' ? 'fulfilled' : 'requested',
                    termsHash: null,
                    approvedNetCents: null,
                    requestedAt: null,
                    decidedAt: null,
                }],
            links: [],
        });
        await arrs.save(arrangement('seed-active', 'proposed', 'u-seed'));
        await arrs.save(arrangement('seed-history', 'committed', 'u-seed'));
        await arrs.save(arrangement('other-user', 'committed', 'u-other'));
        arrs.declines.add('u-seed|old-seed-key');
        arrs.declines.add('u-other|other-key');
        await service.clearForUsers(['u-seed']);
        expect(arrs.rows.has('seed-active')).toBe(false);
        expect(arrs.rows.has('seed-history')).toBe(false);
        expect(arrs.rows.has('other-user')).toBe(true);
        expect(arrs.declines.has('u-seed|old-seed-key')).toBe(false);
        expect(arrs.declines.has('u-other|other-key')).toBe(true);
    });
    it('S1: proposes once, commits once, and releases contacts per counterparty pair only', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        expect(arr.slots).toHaveLength(3);
        expect(arr.links.every((l) => l.state === 'agreed' && l.amountCents !== null)).toBe(true);
        await waitFor(() => ['ualice', 'ubob', 'ucarol'].every((u) => kinds(u, 'approval_request').length === 1));
        await service.approve('ualice', arr.id);
        await service.approve('ubob', arr.id);
        expect(byState('committed')).toHaveLength(0);
        await service.approve('ucarol', arr.id);
        expect(byState('committed')).toHaveLength(1);
        expect(['alice', 'bob', 'carol'].every((id) => repo.intents.get(id).state === 'done')).toBe(true);
        const contacts = (u) => kinds(u, 'committed')[0].payload.contacts
            .map((c) => c.handle).sort();
        expect(contacts('ualice')).toEqual(['h-bob']);
        expect(contacts('ubob')).toEqual(['h-alice', 'h-carol']);
        expect(contacts('ucarol')).toEqual(['h-bob']);
        expect(JSON.stringify(kinds('ualice', 'committed')[0])).not.toContain('h-carol');
        await coordinator.idle();
        expect(rows()).toHaveLength(1);
    });
    it('S1 committed deals expose counterparties to contact', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        for (const u of ['ualice', 'ubob', 'ucarol'])
            await service.approve(u, id);
        const mine = await service.listMine('ubob');
        expect(mine[0].contacts.length).toBeGreaterThan(0);
    });
    it('approves by itself for a user with a standing limit the deal meets, without asking', async () => {
        chain();
        repo.intents.get('carol').private.autoApprove = true;
        await start('alice', 'bob', 'carol');
        await waitFor(() => rows().some((r) => r.slots.some((sl) => sl.intentId === 'carol' && sl.approval === 'approved')));
        expect(kinds('ucarol', 'approval_request')).toHaveLength(0);
        expect(kinds('ubob', 'approval_request').length).toBeGreaterThan(0);
    });
    it('leaves a link nobody priced unpriced, tells the seller to name it, and blocks approval', async () => {
        const plainCash = { kind: 'cash', label: 'cash', attrs: {}, qty: 1 };
        add('edward', [ticket('sat'), ticket('sun')], [[ticket('three')]], null);
        add('kat', [plainCash], [[ticket('sat')], [ticket('sun')]], null);
        add('dawg', [ticket('three')], [[plainCash]], null);
        await start('edward', 'kat', 'dawg');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        expect(arr.links.filter((l) => l.payer).every((l) => l.amountCents === null)).toBe(true);
        const view = (await service.listMine('udawg')).find((a) => a.terms.arrangementId === arr.id).terms;
        expect(view.unpriced).toEqual([{ otherHandle: 'h-edward', role: 'seller', items: ['three'] }]);
        expect(view.cashIn).toHaveLength(0);
        await expect(service.approve('udawg', arr.id)).rejects.toThrow(/price has not been set/);
    });
    it('lets a user approve their own priced link while a link between two others is still unpriced, but never commits unpriced', async () => {
        const plainCash = { kind: 'cash', label: 'cash', attrs: {}, qty: 1 };
        add('edward', [ticket('sat'), ticket('sun')], [[ticket('three')]], -20000);
        add('kat', [plainCash], [[ticket('sat')], [ticket('sun')]], null);
        add('dawg', [ticket('three')], [[cash(20000)]], 20000);
        await start('edward', 'kat', 'dawg');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        const dawgLink = arr.links.find((l) => l.a === 'dawg' || l.b === 'dawg');
        expect(dawgLink.amountCents).toBe(20000);
        expect(arr.links.some((l) => l.payer && l.amountCents === null)).toBe(true);
        await service.approve('udawg', arr.id);
        expect(byState('proposed')[0].slots.find((s) => s.intentId === 'dawg').approval).toBe('approved');
        await expect(service.approve('uedward', arr.id)).rejects.toThrow(/price has not been set/);
        await expect(service.approve('ukat', arr.id)).rejects.toThrow(/price has not been set/);
        expect(byState('committed')).toHaveLength(0);
    });
    it('refuses approval from a user with no public contact', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        setContactLookup(async (ids) => new Map(ids.map((i) => [i, null])));
        await expect(service.approve('ubob', id)).rejects.toThrow(/public contact/);
    });
    it('S2: a decline is replaced by a new participant at the old amounts; only they are asked', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        const amounts = arr.links.map((l) => l.amountCents);
        await service.approve('ualice', arr.id);
        await service.approve('ubob', arr.id);
        await service.decline('ucarol', arr.id);
        expect(arrs.rows.get(arr.id).slots.find((s) => s.intentId === 'carol').approval).toBe('declined');
        add('dave', [ticket('x2')], [[cash(5000)]], 5000);
        await refreshEdges('bob');
        await refreshEdges('dave');
        ensureAgent('dave');
        await waitFor(() => arrs.rows.get(arr.id).revision === 2);
        const next = arrs.rows.get(arr.id);
        expect(next.slots.map((s) => s.intentId).sort()).toEqual(['alice', 'bob', 'dave']);
        expect(next.links.map((l) => l.amountCents)).toEqual(amounts);
        expect(next.slots.find((s) => s.intentId === 'alice').approval).toBe('approved');
        expect(next.slots.find((s) => s.intentId === 'bob').approval).toBe('approved');
        expect(kinds('udave', 'approval_request')).toHaveLength(1);
        expect(kinds('ualice', 'approval_request')).toHaveLength(1);
        expect(kinds('ubob', 'approval_request')).toHaveLength(1);
        await service.approve('udave', arr.id);
        expect(arrs.rows.get(arr.id).state).toBe('committed');
        await coordinator.idle();
        expect(rows().filter((r) => r.slots.some((s) => s.intentId === 'carol' && r.state === 'proposed'))).toHaveLength(0);
    });
    it('S3: no replacement within the window dissolves the arrangement and tells approvers once', async () => {
        arrangementSettings.replaceWindowMs = 150;
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        await service.approve('ualice', id);
        await service.approve('ubob', id);
        await service.decline('ucarol', id);
        await waitFor(() => arrs.rows.get(id).state === 'dissolved');
        await coordinator.idle();
        expect(arrs.rows.get(id).reason).toBe('no_replacement');
        expect(kinds('ualice', 'dissolved')).toHaveLength(1);
        expect(kinds('ubob', 'dissolved')).toHaveLength(1);
        expect(kinds('ucarol', 'dissolved')).toHaveLength(0);
    });
    it('S4: committing one arrangement dissolves the others that share an intent', async () => {
        add('alice', [cash(6000)], [[ticket('x1')]], -6000);
        add('bob1', [ticket('x1')], [[cash(5000)]], 5000);
        add('bob2', [ticket('x1')], [[cash(5500)]], 5500);
        await start('alice', 'bob1', 'bob2');
        await waitFor(() => byState('proposed').length === 2);
        const first = byState('proposed').find((r) => r.slots.some((s) => s.intentId === 'bob1'));
        const second = byState('proposed').find((r) => r.slots.some((s) => s.intentId === 'bob2'));
        await service.approve('ualice', second.id);
        await service.approve('ualice', first.id);
        await service.approve('ubob1', first.id);
        expect(arrs.rows.get(first.id).state).toBe('committed');
        expect(arrs.rows.get(second.id).state).toBe('dissolved');
        expect(arrs.rows.get(second.id).reason).toBe('consumed');
        expect(kinds('ualice', 'dissolved')).toHaveLength(1);
        expect(repo.intents.get('bob2').state).toBe('open');
    });
});
describe('approvals', () => {
    it('does not re-propose an arrangement a participant declined', async () => {
        arrangementSettings.replaceWindowMs = 100;
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        await service.decline('ualice', id);
        await service.vacateSlot(id, 'bob', 'withdrawn');
        await waitFor(() => arrs.rows.get(id).state === 'dissolved');
        await new Promise((r) => setTimeout(r, 120));
        await coordinator.idle();
        expect(rows().filter((r) => r.state === 'proposed')).toHaveLength(0);
        expect(rows()).toHaveLength(1);
    });
    it('times out a request, treats it as a decline, and remembers it', async () => {
        arrangementSettings.approvalWindowMs = 80;
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => rows().some((r) => r.slots.some((s) => s.approval === 'timed_out')));
        const arr = rows()[0];
        expect(await arrs.isDeclined('ualice', arr.key)).toBe(true);
        expect(arr.excluded.length).toBeGreaterThan(0);
    });
    it('retract after approval vacates the slot', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        await service.approve('ualice', id);
        await service.retract('ualice', id);
        expect(arrs.rows.get(id).slots.find((s) => s.intentId === 'alice').approval).toBe('retracted');
        await expect(service.retract('ubob', id)).rejects.toMatchObject({ status: 409 });
    });
    it('voids a slot when its intent changes version', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        const bob = repo.intents.get('bob');
        repo.intents.set('bob', { ...bob, version: 2 });
        events.emit('intent.updated', { intentId: 'bob' });
        await waitFor(() => arrs.rows.get(id).slots.find((s) => s.intentId === 'bob').approval === 'void');
    });
    it('voids a slot when its intent is withdrawn', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        repo.intents.set('carol', { ...repo.intents.get('carol'), state: 'withdrawn' });
        events.emit('intent.closed', { intentId: 'carol' });
        await waitFor(() => arrs.rows.get(id).slots.find((s) => s.intentId === 'carol').approval === 'void');
    });
    it('caps pending requests per user and promotes a queued one when a slot frees', async () => {
        add('alice', [cash(6000)], [[ticket('x1')]], -6000);
        for (const n of [1, 2, 3, 4])
            add(`b${n}`, [ticket('x1')], [[cash(5000 + n * 10)]], 5000);
        await start('alice', 'b1', 'b2', 'b3', 'b4');
        await waitFor(() => byState('proposed').length === 4);
        const mineStates = () => rows().flatMap((r) => r.slots).filter((s) => s.userId === 'ualice').map((s) => s.approval);
        expect(mineStates().filter((s) => s === 'requested')).toHaveLength(3);
        expect(mineStates().filter((s) => s === 'queued')).toHaveLength(1);
        const queued = byState('proposed').find((r) => r.slots.some((s) => s.userId === 'ualice' && s.approval === 'queued'));
        await expect(service.approve('ualice', queued.id)).rejects.toMatchObject({ status: 409 });
        const requested = byState('proposed').find((r) => r.slots.some((s) => s.userId === 'ualice' && s.approval === 'requested'));
        await service.decline('ualice', requested.id);
        expect(mineStates().filter((s) => s === 'queued')).toHaveLength(0);
        expect(kinds('ualice', 'approval_request')).toHaveLength(4);
    });
    it('negotiate further re-prices one link and bumps the revision', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        await service.approve('ucarol', arr.id);
        const result = await service.negotiateFurther('ualice', arr.id, { targetCents: 5500, linkId: 'alice|bob' });
        expect(result.status).toBe('agreed');
        const next = arrs.rows.get(arr.id);
        expect(next.revision).toBe(2);
        expect(next.slots.find((s) => s.intentId === 'carol').approval).toBe('approved');
        const bad = await service.negotiateFurther('ualice', arr.id, { targetCents: 999999, linkId: 'alice|bob' });
        expect(bad).toMatchObject({ status: 'failed' });
    });
    it('lets a seller who already approved name a lower price than their listed ask', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        await service.approve('ucarol', arr.id);
        const result = await service.negotiateFurther('ucarol', arr.id, { targetCents: 4800, linkId: 'bob|carol' });
        expect(result.status).not.toBe('failed');
    });
    it('a standing proposal is settled by the other user saying yes, leaving nobody waiting', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        for (const l of arrs.rows.get(arr.id).links)
            if (l.id === 'alice|bob')
                l.amountCents = 6000;
        arrs.rows.get(arr.id).proposal = { linkId: 'bob|carol', amountCents: 5200, fromIntentId: 'carol' };
        await service.approve('ubob', arr.id);
        const next = arrs.rows.get(arr.id);
        expect(next.proposal).toBeNull();
        expect(next.links.find((l) => l.id === 'bob|carol').amountCents).toBe(5200);
        expect(next.slots.find((s) => s.intentId === 'carol').approval).toBe('approved');
        expect(next.slots.find((s) => s.intentId === 'bob').approval).toBe('approved');
    });
    it('saying no to a proposal drops only that price', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        arrs.rows.get(arr.id).proposal = { linkId: 'bob|carol', amountCents: 5200, fromIntentId: 'carol' };
        await service.decline('ubob', arr.id);
        const next = arrs.rows.get(arr.id);
        expect(next.proposal).toBeNull();
        expect(next.state).toBe('proposed');
        expect(next.slots.find((s) => s.intentId === 'bob').approval).not.toBe('declined');
    });
    it('hides arrangements from non-participants with a 404', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const id = byState('proposed')[0].id;
        await expect(service.approve('ustranger', id)).rejects.toBeInstanceOf(ArrangementError);
        await expect(service.approve('ustranger', id)).rejects.toMatchObject({ status: 404 });
        await expect(service.approve('ualice', 'missing')).rejects.toMatchObject({ status: 404 });
    });
});
describe('terms view', () => {
    it('only shows counterparties and never leaks other participants', async () => {
        chain();
        await start('alice', 'bob', 'carol');
        await waitFor(() => byState('proposed').length === 1);
        const arr = byState('proposed')[0];
        const intents = new Map([...repo.intents].map(([id, i]) => [id, i]));
        for (const slot of arr.slots) {
            const view = termsView(arr, slot, intents, null);
            const text = JSON.stringify(view);
            const counterparties = new Set(arr.links.filter((l) => l.a === slot.intentId || l.b === slot.intentId)
                .map((l) => (l.a === slot.intentId ? l.b : l.a)));
            for (const other of arr.slots.map((s) => s.intentId).filter((i) => i !== slot.intentId && !counterparties.has(i))) {
                expect(text).not.toContain(other);
                expect(text).not.toContain(`h-${other}`);
            }
            expect(text).not.toContain(slot.intentId === 'alice' ? 'carol' : '\u0000');
        }
        const aliceView = termsView(arr, arr.slots.find((s) => s.intentId === 'alice'), intents, null);
        expect(aliceView.otherParticipants).toBe(1);
        expect(aliceView.cashOut).toHaveLength(1);
        expect(aliceView.cashOut[0].toHandle).toBe('h-bob');
    });
});
describe('routes', () => {
    it('requires authentication', async () => {
        expect((await app.request('/arrangements/mine')).status).toBe(401);
        expect((await app.request('/arrangements/abc/approve', { method: 'POST' })).status).toBe(401);
    });
});
