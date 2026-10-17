import { z } from 'zod';

export const itemSchema = z.object({
  kind: z.enum(['ticket', 'sublet', 'cash', 'other']),
  label: z.string().min(1),
  attrs: z.record(z.string(), z.union([z.string(), z.number()])),
  qty: z.number().int().positive(),
  amountCents: z.number().int().optional(),
  flex: z.enum(['firm', 'flexible']).optional(),
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
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  radiusKm: z.number().nonnegative(),
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

export type Item = z.infer<typeof itemSchema>;
export type WantItem = z.infer<typeof wantItemSchema>;
export type IntentPublic = z.infer<typeof intentPublicSchema>;
export type IntentPrivate = z.infer<typeof intentPrivateSchema>;
export type IntentState = z.infer<typeof intentStateSchema>;
export type EdgeCover = z.infer<typeof edgeCoverSchema>;
export type Signal = z.infer<typeof signalSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Slot = z.infer<typeof slotSchema>;
export type Arrangement = z.infer<typeof arrangementSchema>;
export type BusBody = z.infer<typeof busBodySchema>;
export type Envelope = z.infer<typeof envelopeSchema>;

export const DEFAULT_RADIUS_KM = 4.8;
export const COARSE_GRID_M = 500;
export const SEARCH_BUDGET_EXPANSIONS = 200;
export const SEARCH_BUDGET_MS = 5000;
export const NEGOTIATION_ROUNDS = 3;
export const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;
