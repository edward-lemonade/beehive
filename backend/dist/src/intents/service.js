import { randomUUID } from 'node:crypto';
import { clock } from '../clock.js';
import { draftSchema, intentPublicSchema } from '../contracts/index.js';
import { events } from '../events.js';
import { parseIntent as parseIntentWithLLM } from './parse.js';
import { intentRepository, OpenIntentLimitError, } from './repository.js';
const DRAFT_LIFETIME_MS = 48 * 60 * 60 * 1000;
const MAX_OPEN_INTENTS = 10;
export class IntentServiceError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'IntentServiceError';
    }
}
const drafts = new Map();
let activeRepository = intentRepository;
let activeParser = parseIntentWithLLM;
export function setIntentRepository(repository) {
    activeRepository = repository ?? intentRepository;
}
export function getIntentRepository() {
    return activeRepository;
}
export function setIntentParser(parser) {
    activeParser = parser ?? parseIntentWithLLM;
}
function hasAttr(item, key) {
    const value = item.attrs[key];
    return typeof value === 'string' ? value.trim().length > 0 : typeof value === 'number' && Number.isFinite(value);
}
function missingFields(parsed) {
    const missing = [];
    if (parsed.give.length === 0 && parsed.want.length === 0)
        missing.push('item');
    if (![...parsed.give, ...parsed.want.flatMap((want) => want.anyOf)].some((item) => item.kind !== 'cash')) {
        missing.push('nonCashItem');
    }
    if ([...parsed.give, ...parsed.want.flatMap((want) => want.anyOf)]
        .some((item) => item.qty > 1 && parsed.separateOrTogether === null)) {
        missing.push('separateOrTogether');
    }
    for (const [side, items] of [['give', parsed.give], ['want', parsed.want.flatMap((want) => want.anyOf)]]) {
        for (const item of items) {
            if (item.kind === 'ticket') {
                if (!hasAttr(item, 'event'))
                    missing.push(`${side}.ticket.event`);
                if (!hasAttr(item, 'day'))
                    missing.push(`${side}.ticket.day`);
            }
            if (item.kind === 'sublet') {
                if (!hasAttr(item, 'dates'))
                    missing.push(`${side}.sublet.dates`);
                if (!hasAttr(item, 'rentCents'))
                    missing.push(`${side}.sublet.rent`);
            }
            if (item.kind === 'cash' && (item.amountCents === undefined || item.amountCents <= 0)) {
                missing.push(`${side}.cash.amount`);
            }
        }
    }
    return [...new Set(missing)];
}
function questionFor(missing) {
    const first = missing[0];
    if (!first)
        return null;
    if (first === 'item' || first === 'nonCashItem')
        return 'What are you offering or looking for?';
    if (first === 'separateOrTogether')
        return 'Sell them separately or only together?';
    if (first.endsWith('.ticket.event'))
        return 'What event is the ticket for?';
    if (first.endsWith('.ticket.day'))
        return 'What day is the ticket for?';
    if (first.endsWith('.sublet.dates'))
        return 'What dates is the sublet available?';
    if (first.endsWith('.sublet.rent'))
        return 'What is the rent?';
    if (first.endsWith('.cash.amount'))
        return 'What amount of cash is part of the trade?';
    return null;
}
function publicFreeText(text) {
    return text
        .replace(/,?\s*(?:but\s*)?(?:would take|won't take under|will not take under|at least|minimum(?: of)?|up to)\s*\$[\d,]+(?:\.\d{1,2})?/gi, '')
        .replace(/\s+([,.!?])/g, '$1')
        .trim();
}
function publicView(intent) {
    return intentPublicSchema.parse(intent.public);
}
function createIntent(ownerId, draftId, sourceText, parsed, state, owner) {
    const now = clock.now();
    const id = randomUUID();
    const publicData = {
        intentId: id,
        version: 0,
        ownerHandle: owner.handle,
        tier: owner.tier,
        give: parsed.give,
        want: parsed.want,
        deadline: parsed.deadline,
        freeText: publicFreeText(sourceText),
    };
    const privateData = {
        minNetCents: parsed.minNetCents,
        declaredNetCents: parsed.declaredNetCents,
    };
    const intent = {
        id,
        draftId,
        ownerId,
        version: 0,
        state,
        public: publicData,
        private: privateData,
        sourceText,
        parsed,
        createdAt: now,
        updatedAt: now,
    };
    return intent;
}
function assertOwner(record, ownerId) {
    if (!record)
        throw new IntentServiceError('Record not found', 404);
    if (record.ownerId !== ownerId)
        throw new IntentServiceError('Forbidden', 403);
    return record;
}
function assertDraftActive(draft) {
    if (draft.expiresAt <= clock.now()) {
        clearTimeout(draft.timer);
        drafts.delete(draft.id);
        throw new IntentServiceError('Draft expired', 404);
    }
    if (draft.confirmation)
        throw new IntentServiceError('Draft has already been confirmed', 409);
}
export function createDraft(userId, text, source = 'web') {
    return createDraftParsed(userId, text, source);
}
async function createDraftParsed(userId, text, source) {
    const parsed = await activeParser(text);
    const missing = missingFields(parsed);
    const id = randomUUID();
    const expiresAt = clock.now() + DRAFT_LIFETIME_MS;
    const timer = clock.after(DRAFT_LIFETIME_MS, () => drafts.delete(id));
    timer.unref?.();
    const draft = {
        id,
        ownerId: userId,
        source,
        sourceText: text,
        createdAt: clock.now(),
        expiresAt,
        confirmation: null,
        confirmationPromise: null,
        timer,
        parsed,
        missing,
        question: questionFor(missing),
    };
    drafts.set(id, draft);
    return draftSchema.parse({ id, parsed, missing, question: draft.question });
}
export function answerDraft(draftId, text, userId) {
    return answerDraftParsed(draftId, text, userId);
}
async function answerDraftParsed(draftId, text, userId) {
    const draft = drafts.get(draftId);
    if (userId)
        assertOwner(draft, userId);
    if (!draft)
        throw new IntentServiceError('Draft not found', 404);
    assertDraftActive(draft);
    const sourceText = text.trim() ? `${draft.sourceText}\n${text}` : draft.sourceText;
    const parsed = await activeParser(sourceText);
    const missing = missingFields(parsed);
    draft.sourceText = sourceText;
    draft.parsed = parsed;
    draft.missing = missing;
    draft.question = questionFor(missing);
    return draftSchema.parse({
        id: draft.id,
        parsed,
        missing: draft.missing,
        question: draft.question,
    });
}
export function confirmDraft(draftId, userId, owner) {
    const draft = drafts.get(draftId);
    if (!draft)
        return confirmDraftPersisted(draftId, userId, owner);
    try {
        assertOwner(draft, userId);
    }
    catch (error) {
        return Promise.reject(error);
    }
    if (draft.confirmation)
        return Promise.resolve(draft.confirmation);
    if (draft.confirmationPromise)
        return draft.confirmationPromise;
    const pending = confirmDraftPersisted(draftId, userId, owner);
    draft.confirmationPromise = pending;
    return pending.then((confirmed) => {
        draft.confirmationPromise = null;
        return confirmed;
    }, (error) => {
        draft.confirmationPromise = null;
        throw error;
    });
}
async function confirmDraftPersisted(draftId, userId, owner) {
    const draft = assertOwner(drafts.get(draftId), userId);
    if (draft.confirmation)
        return draft.confirmation;
    assertDraftActive(draft);
    if (draft.missing.length > 0) {
        throw new IntentServiceError('Draft is incomplete', 400);
    }
    const copies = draft.parsed.separateOrTogether === 'separate'
        ? Math.max(1, ...[...draft.parsed.give, ...draft.parsed.want.flatMap((want) => want.anyOf)].map((item) => item.qty))
        : 1;
    const confirmedParsed = copies > 1
        ? {
            ...draft.parsed,
            give: draft.parsed.give.map((item) => ({ ...item, qty: 1 })),
            want: draft.parsed.want.map((want) => ({
                anyOf: want.anyOf.map((item) => ({ ...item, qty: 1 })),
            })),
        }
        : draft.parsed;
    const confirmed = Array.from({ length: copies }, () => createIntent(userId, draft.id, draft.sourceText, confirmedParsed, 'open', owner));
    try {
        const persisted = await activeRepository.createMany(confirmed, MAX_OPEN_INTENTS, draft.id);
        confirmed.splice(0, confirmed.length, ...persisted);
    }
    catch (error) {
        if (error instanceof OpenIntentLimitError) {
            throw new IntentServiceError('User has reached the limit of 10 open intents', 409);
        }
        throw error;
    }
    draft.confirmation = confirmed;
    draft.missing = [];
    draft.question = null;
    clearTimeout(draft.timer);
    for (const intent of confirmed)
        events.emit('intent.opened', { intentId: intent.id });
    return confirmed;
}
export function editIntent(intentId, userId, text) {
    return editIntentPersisted(intentId, userId, text);
}
async function editIntentPersisted(intentId, userId, text) {
    const intent = assertOwner(await activeRepository.get(intentId), userId);
    if (intent.state !== 'open')
        throw new IntentServiceError('Only open intents can be edited', 409);
    const parsed = await activeParser(text);
    const missing = missingFields(parsed);
    if (missing.length > 0)
        throw new IntentServiceError(`Edited intent is incomplete: ${questionFor(missing)}`, 400);
    const previousPublic = intent.public;
    const nextVersion = intent.version + 1;
    const nextPublic = {
        ...previousPublic,
        version: nextVersion,
        give: parsed.give,
        want: parsed.want,
        deadline: parsed.deadline,
        freeText: publicFreeText(text),
    };
    const nextPrivate = {
        minNetCents: parsed.minNetCents,
        declaredNetCents: parsed.declaredNetCents,
    };
    const privateOnly = JSON.stringify({
        give: previousPublic.give,
        want: previousPublic.want,
        deadline: previousPublic.deadline,
    }) === JSON.stringify({
        give: nextPublic.give,
        want: nextPublic.want,
        deadline: nextPublic.deadline,
    });
    const updated = {
        ...intent,
        version: nextVersion,
        public: nextPublic,
        private: nextPrivate,
        parsed,
        sourceText: text,
        updatedAt: clock.now(),
    };
    const saved = await activeRepository.saveVersion(updated, intent.version);
    if (!saved)
        throw new IntentServiceError('Intent changed before the edit could be saved', 409);
    events.emit('intent.updated', { intentId, privateOnly });
    return updated;
}
export async function withdrawIntent(intentId, userId) {
    const intent = assertOwner(await activeRepository.get(intentId), userId);
    if (intent.state !== 'open')
        throw new IntentServiceError('Only open intents can be withdrawn', 409);
    const withdrawn = await activeRepository.changeState(intentId, userId, 'open', 'withdrawn', clock.now());
    if (!withdrawn)
        throw new IntentServiceError('Intent changed before it could be withdrawn', 409);
    events.emit('intent.closed', { intentId });
}
export async function expireDue() {
    const now = clock.now();
    for (const [id, draft] of drafts) {
        if (draft.expiresAt <= now) {
            clearTimeout(draft.timer);
            drafts.delete(id);
        }
    }
    const expired = await activeRepository.expireDue(now);
    for (const intent of expired)
        events.emit('intent.closed', { intentId: intent.id });
    return expired.length;
}
export async function reopenIntent(intentId, userId) {
    const intent = assertOwner(await activeRepository.get(intentId), userId);
    if (intent.state !== 'withdrawn' && intent.state !== 'expired') {
        throw new IntentServiceError('Only withdrawn or expired intents can be reopened', 409);
    }
    const openCount = (await activeRepository.listMine(userId))
        .filter((record) => record.state === 'open').length;
    if (openCount >= MAX_OPEN_INTENTS) {
        throw new IntentServiceError('User has reached the limit of 10 open intents', 409);
    }
    return createDraft(userId, intent.sourceText, 'web');
}
export async function listMine(userId) {
    return activeRepository.listMine(userId);
}
export async function listPublicIntents() {
    const openIntents = await activeRepository.listOpen();
    return openIntents.map(publicView);
}
export function getOwnedDraft(draftId, userId) {
    return assertOwner(drafts.get(draftId), userId);
}
