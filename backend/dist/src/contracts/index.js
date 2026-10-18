import { z } from 'zod';
export const itemSchema = z.object({
    kind: z.enum(['ticket', 'sublet', 'cash', 'other']),
    label: z.string().min(1),
    attrs: z.record(z.string(), z.union([z.string(), z.number()])),
    qty: z.number().int().positive(),
    amountCents: z.number().int().optional(),
    flex: z.enum(['firm', 'flexible']).optional(),
});
export const parsedIntentSchema = z.object({
    give: z.array(itemSchema),
    want: z.array(z.object({ anyOf: z.array(itemSchema) })),
    deadline: z.string().nullable(),
    minNetCents: z.number().nullable(),
    declaredNetCents: z.number().nullable(),
    separateOrTogether: z.enum(['separate', 'together']).nullable(),
    injectionSuspected: z.boolean(),
    injectionReason: z.string().nullable(),
});
export const draftSchema = z.object({
    id: z.string(),
    parsed: parsedIntentSchema,
    missing: z.array(z.string()),
    question: z.string().nullable(),
});
export const wantItemSchema = z.object({
    anyOf: z.array(itemSchema),
});
export const intentPublicSchema = z.object({
    intentId: z.string(),
    version: z.number().int().nonnegative(),
    ownerHandle: z.string(),
    ownerImageUrl: z.string().nullable().optional(),
    tier: z.string(),
    give: z.array(itemSchema),
    want: z.array(wantItemSchema),
    deadline: z.string().nullable(),
    freeText: z.string(),
});
export const intentPrivateSchema = z.object({
    minNetCents: z.number().nullable(),
    declaredNetCents: z.number().nullable(),
    autoApprove: z.boolean().optional(),
});
export const intentStateSchema = z.enum(['draft', 'open', 'done', 'withdrawn', 'expired']);
export const edgeCoverSchema = z.object({
    slot: z.string(),
    provider: z.string(),
    item: itemSchema,
});
export const flowSchema = z.object({
    from: z.string(),
    to: z.string(),
    item: itemSchema,
});
export const relevantEdgeSchema = z.object({
    self: z.string(),
    other: z.string(),
    otherVersion: z.number().int().nonnegative(),
    selfWants: z.array(edgeCoverSchema),
    selfGives: z.array(flowSchema),
});
export const nearMissSchema = z.object({
    otherHandle: z.string(),
    gapCents: z.number().int().nonnegative(),
    kind: z.enum(['price', 'dates']),
    text: z.string(),
});
export const signalSchema = z.object({
    from: z.string(),
    to: z.string(),
    fromVersion: z.number().int().nonnegative(),
    toVersion: z.number().int().nonnegative(),
    satisfiable: z.boolean(),
});
export const linkSchema = z.object({
    id: z.string(),
    a: z.string(),
    b: z.string(),
    flows: z.array(flowSchema),
    payer: z.string().nullable(),
    amountCents: z.number().int().nullable(),
    state: z.enum(['unpriced', 'agreed', 'failed']),
});
export const approvalStateSchema = z.enum([
    'queued', 'requested', 'approved', 'declined', 'timed_out', 'retracted', 'void', 'fulfilled',
]);
export const slotSchema = z.object({
    intentId: z.string(),
    intentVersion: z.number().int().nonnegative(),
    approval: approvalStateSchema,
});
export const termsViewSchema = z.object({
    arrangementId: z.string(),
    revision: z.number().int().nonnegative(),
    intentId: z.string(),
    intentVersion: z.number().int().nonnegative(),
    state: z.string(),
    approval: approvalStateSchema,
    expiresAt: z.number().nullable(),
    gives: z.array(z.object({ item: itemSchema, toHandle: z.string() })),
    gets: z.array(z.object({ item: itemSchema, fromHandle: z.string() })),
    cashOut: z.array(z.object({ toHandle: z.string(), amountCents: z.number().int() })),
    cashIn: z.array(z.object({ fromHandle: z.string(), amountCents: z.number().int() })),
    netCents: z.number().int(),
    declaredNetCents: z.number().int().nullable(),
    grade: z.enum(['exact', 'within_tolerance']),
    otherParticipants: z.number().int().nonnegative(),
    unpriced: z.array(z.object({ otherHandle: z.string(), role: z.enum(['buyer', 'seller']), items: z.array(z.string()) })).optional(),
    proposal: z.object({
        amountCents: z.number().int(),
        otherHandle: z.string(),
        awaiting: z.enum(['user', 'counterparty']),
        source: z.enum(['agent', 'user']).optional(),
    }).optional(),
});
export const arrangementSchema = z.object({
    id: z.string(),
    key: z.string(),
    state: z.enum(['candidate', 'dropped', 'proposed', 'committed', 'dissolved']),
    revision: z.number().int().nonnegative(),
    slots: z.array(slotSchema),
    links: z.array(linkSchema),
});
export const busBodySchema = z.union([
    z.object({ type: z.literal('signal'), fromVersion: z.number().int().nonnegative(), toVersion: z.number().int().nonnegative(), satisfiable: z.boolean() }).strict(),
    z.object({ type: z.literal('offer'), linkId: z.string(), round: z.number().int().nonnegative(), amountCents: z.number().int() }).strict(),
    z.object({ type: z.literal('accept'), linkId: z.string(), amountCents: z.number().int() }).strict(),
    z.object({ type: z.literal('walk'), linkId: z.string() }).strict(),
    z.object({ type: z.literal('say'), linkId: z.string(), text: z.string() }).strict(),
]);
export const envelopeSchema = z.object({
    id: z.string(),
    from: z.union([z.string(), z.literal('coordinator')]),
    to: z.string(),
    sentAt: z.number(),
    trace: z.object({
        sentryTrace: z.string().optional(),
        baggage: z.string().optional(),
    }).strict(),
    body: busBodySchema,
}).strict();
export const SEARCH_BUDGET_EXPANSIONS = 200;
export const SEARCH_BUDGET_MS = 5000;
export const NEGOTIATION_ROUNDS = 3;
export const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;
