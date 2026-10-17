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
    tier: z.string(),
    give: z.array(itemSchema),
    want: z.array(wantItemSchema),
    deadline: z.string().nullable(),
    freeText: z.string(),
});
export const intentPrivateSchema = z.object({
    minNetCents: z.number().nullable(),
    declaredNetCents: z.number().nullable(),
});
export const intentStateSchema = z.enum(['draft', 'open', 'done', 'withdrawn', 'expired']);
export const edgeCoverSchema = z.object({
    slot: z.string(),
    provider: z.string(),
    item: itemSchema,
});
export const signalSchema = z.object({
    from: z.string(),
    to: z.string(),
    fromVersion: z.number().int().nonnegative(),
    toVersion: z.number().int().nonnegative(),
    satisfiable: z.boolean(),
});
export const flowSchema = z.object({
    from: z.string(),
    to: z.string(),
    item: itemSchema,
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
export const slotSchema = z.object({
    intentId: z.string(),
    intentVersion: z.number().int().nonnegative(),
    approval: z.enum(['queued', 'requested', 'approved', 'declined', 'timed_out', 'retracted', 'void']),
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
    z.object({ type: z.literal('signal'), fromVersion: z.number().int().nonnegative(), toVersion: z.number().int().nonnegative(), satisfiable: z.boolean() }),
    z.object({ type: z.literal('offer'), linkId: z.string(), round: z.number().int().nonnegative(), amountCents: z.number().int() }),
    z.object({ type: z.literal('accept'), linkId: z.string(), amountCents: z.number().int() }),
    z.object({ type: z.literal('walk'), linkId: z.string() }),
    z.object({ type: z.literal('say'), linkId: z.string(), text: z.string() }),
]);
export const envelopeSchema = z.object({
    id: z.string(),
    from: z.union([z.string(), z.literal('coordinator')]),
    to: z.string(),
    sentAt: z.number(),
    trace: z.object({
        sentryTrace: z.string().optional(),
        baggage: z.string().optional(),
    }),
    body: busBodySchema,
});
export const SEARCH_BUDGET_EXPANSIONS = 200;
export const SEARCH_BUDGET_MS = 5000;
export const NEGOTIATION_ROUNDS = 3;
export const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;
