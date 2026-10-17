import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  LLM_MODEL_FAST: z.string().min(1),
  PHOTON_PROJECT_ID: z.string().min(1),
  PHOTON_PROJECT_SECRET: z.string().min(1),
  PHOTON_WEBHOOK_SECRET: z.string().min(1),
  CHANNEL: z.enum(['photon', 'terminal']),
  SENTRY_DSN_API: z.string().optional().default(''),
  TIME_SCALE: z.coerce.number().default(1),
  SEARCH_BUDGET_EXPANSIONS: z.coerce.number().default(200),
  SEARCH_BUDGET_MS: z.coerce.number().default(5000),
  NEGOTIATION_ROUNDS: z.coerce.number().default(3),
  DEFAULT_RADIUS_KM: z.coerce.number().default(4.8),
  COARSE_GRID_M: z.coerce.number().default(500),
  CAMPUS_CENTER_LAT: z.coerce.number().default(0),
  CAMPUS_CENTER_LNG: z.coerce.number().default(0),
  VITE_API_URL: z.string().optional(),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;
