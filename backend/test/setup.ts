process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.CLERK_SECRET_KEY ||= 'sk_test_local';
process.env.CLERK_PUBLISHABLE_KEY ||= 'pk_test_local';
process.env.LLM_MODEL_FAST ||= 'test-model';
process.env.CHANNEL ||= 'terminal';
