import { z } from 'zod';
const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_PUBLISHABLE_KEY: z.string().min(1),
    LLM_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta/openai'),
    LLM_API_KEY: z.string().optional().default(''),
    LLM_MODEL_FAST: z.string().min(1),
    PHOTON_PROJECT_ID: z.string().optional().default(''),
    PHOTON_API_KEY: z.string().optional().default(''),
    PHOTON_SENDER_ID: z.string().optional().default(''),
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
        for (const key of ['PHOTON_PROJECT_ID', 'PHOTON_API_KEY', 'PHOTON_SENDER_ID', 'PHOTON_PHONE_NUMBER']) {
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
        if (values.PHOTON_PROJECT_ID && !/^pho_prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(values.PHOTON_PROJECT_ID)) {
            context.addIssue({
                code: 'custom',
                path: ['PHOTON_PROJECT_ID'],
                message: 'PHOTON_PROJECT_ID must be a Photon Beta project ID',
            });
        }
        if (values.PHOTON_SENDER_ID && !/^pho_usr_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(values.PHOTON_SENDER_ID)) {
            context.addIssue({
                code: 'custom',
                path: ['PHOTON_SENDER_ID'],
                message: 'PHOTON_SENDER_ID must be the assigned Photon Beta sender user ID',
            });
        }
    }
});
export const config = envSchema.parse(process.env);
