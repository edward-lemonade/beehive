import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  LLM_API_KEY: z.string().optional().default(''),
  LLM_MODEL_FAST: z.string().min(1),
  PHOTON_PROJECT_ID: z.string().optional().default(''),
  PHOTON_PROJECT_SECRET: z.string().optional().default(''),
  PHOTON_WEBHOOK_SECRET: z.string().optional().default(''),
  CHANNEL: z.enum(['photon', 'terminal']),
  SENTRY_DSN_API: z.string().optional().default(''),
  TIME_SCALE: z.coerce.number().default(1),
  SEARCH_BUDGET_EXPANSIONS: z.coerce.number().default(200),
  SEARCH_BUDGET_MS: z.coerce.number().default(5000),
  BUS_LOG_CONTENT: z.enum(['true', 'false']).optional(),
  NEGOTIATION_ROUNDS: z.coerce.number().default(3),
  VITE_API_URL: z.string().optional(),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
}).superRefine((values, context) => {
  if (values.CHANNEL === 'photon') {
    for (const key of ['PHOTON_PROJECT_ID', 'PHOTON_PROJECT_SECRET', 'PHOTON_WEBHOOK_SECRET'] as const) {
      if (!values[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when CHANNEL=photon`,
        });
      }
    }
  }
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;
