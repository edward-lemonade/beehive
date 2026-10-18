import { z } from 'zod'
import {
  draftSchema,
  intentPrivateSchema,
  intentPublicSchema,
  intentStateSchema,
  nearMissSchema,
  termsViewSchema,
} from '../contracts'

export const myIntentSchema = z.object({
  id: z.string(),
  version: z.number(),
  state: intentStateSchema,
  public: intentPublicSchema,
  private: intentPrivateSchema,
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
})

export const mineEntrySchema = z.object({
  terms: termsViewSchema,
  contacts: z.array(z.object({ handle: z.string(), contact: z.string().nullable() })).nullable(),
})

export const relevantSchema = z.object({
  relevant: z.boolean(),
  ownIntentId: z.string().nullable(),
})

export const negotiateResultSchema = z.object({
  status: z.string(),
  amountCents: z.number().optional(),
  rounds: z.number().optional(),
})

export const channelSchema = z.object({
  channel: z.enum(['app', 'sms']),
  phoneLinked: z.boolean(),
  phoneTail: z.string().nullable(),
  phoneNumber: z.string().optional(),
})

export const actionResultSchema = z.object({
  status: z.string().optional(),
  reason: z.string().optional(),
  amountCents: z.number().optional(),
  terms: termsViewSchema.optional(),
})

export type ChannelState = z.infer<typeof channelSchema>
export type ActionResult = { status: 'ok' | 'agreed' | 'pending' | 'failed'; reason?: string; amountCents?: number }
export type Draft = z.infer<typeof draftSchema>
export type MyIntent = z.infer<typeof myIntentSchema>
export type MineEntry = z.infer<typeof mineEntrySchema>
export type Relevant = z.infer<typeof relevantSchema>
export type NegotiateResult = z.infer<typeof negotiateResultSchema>
export { draftSchema, nearMissSchema, intentPublicSchema }
