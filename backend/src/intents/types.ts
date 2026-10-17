import { z } from 'zod';
import { draftSchema, itemSchema, parsedIntentSchema, wantItemSchema } from '../contracts/index.js';

export type ParsedIntent = z.infer<typeof parsedIntentSchema>;
export type Draft = z.infer<typeof draftSchema>;
export type Item = z.infer<typeof itemSchema>;
export type WantItem = z.infer<typeof wantItemSchema>;

export type DraftQuestion = {
  question: string | null;
  missing: string[];
};
