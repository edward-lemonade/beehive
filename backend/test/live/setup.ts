import { existsSync } from 'node:fs';

// Live tests use the real LLM configured in backend/.env.
if (existsSync('.env')) process.loadEnvFile('.env');
for (const key of ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL_FAST']) {
  if (!process.env[key]) throw new Error(`${key} is missing from backend/.env. Live tests need a working LLM: set LLM_API_KEY, LLM_BASE_URL and LLM_MODEL_FAST.`);
}
process.env.DATABASE_URL ||= 'postgres://localhost:5432/test';
process.env.CLERK_SECRET_KEY ||= 'sk_test_local';
process.env.CLERK_PUBLISHABLE_KEY ||= 'pk_test_local';
process.env.CHANNEL ||= 'terminal';
