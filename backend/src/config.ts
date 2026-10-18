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
  PHOTON_PHONE_NUMBER: z.string().optional().default(''),
  CHANNEL: z.enum(['photon', 'terminal']),
  SENTRY_DSN_API: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  // Off by default: chat prompts hold the user's private limits and other users' listings.
  SENTRY_RECORD_LLM_IO: z.enum(['true', 'false']).default('false'),
  // On by default: streams user↔agent and agent↔agent message text to Sentry Logs as a live transcript.
  SENTRY_CONVERSATION_LOG: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  DEMO_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  TIME_SCALE: z.coerce.number().default(1),
  SEARCH_BUDGET_EXPANSIONS: z.coerce.number().default(200),
  SEARCH_BUDGET_MS: z.coerce.number().default(5000),
  BUS_LOG_CONTENT: z.enum(['true', 'false']).optional(),
  NEGOTIATION_ROUNDS: z.coerce.number().default(3),
  VITE_API_URL: z.string().optional(),
  FRONTEND_ORIGIN: z.string().default('*'),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
}).superRefine((values, context) => {
  if (values.CHANNEL === 'photon') {
    for (const key of ['PHOTON_PROJECT_ID', 'PHOTON_PROJECT_SECRET', 'PHOTON_WEBHOOK_SECRET', 'PHOTON_PHONE_NUMBER'] as const) {
      if (!values[key]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when CHANNEL=photon`,
        });
      }
    }
    if (values.PHOTON_PHONE_NUMBER && !/^\+[1-9]\d{6,14}$/.test(values.PHOTON_PHONE_NUMBER)) {
      context.addIssue({
        code: 'custom',
        path: ['PHOTON_PHONE_NUMBER'],
        message: 'PHOTON_PHONE_NUMBER must use E.164 format',
      });
    }
  }
});

export const config = envSchema.parse(process.env);

export type Config = z.infer<typeof envSchema>;
