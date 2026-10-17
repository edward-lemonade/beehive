import { envelopeSchema, type BusBody, type Envelope } from '../contracts/index.js';

export type Violation = {
  rule: 'addressee' | 'schema' | 'content' | 'version';
  from: string;
  to: string;
};

export type GuardContext = {
  senderVersion: number | null;
  recipientVersion: number | null;
  relevant: ReadonlySet<string>;
  retractTargets: ReadonlySet<string>;
  coordinatorRecipients: ReadonlySet<string>;
  senderBounds: readonly number[];
  forbidden: readonly string[];
};

export type GuardResult = { ok: true; envelope: Envelope } | { ok: false; violation: Violation };

const NUMBER = /(?<![\w.])\$?\d[\d,]*(?:\.\d+)?/g;

function freeStrings(body: BusBody): string[] {
  return Object.entries(body)
    .filter(([key, value]) => typeof value === 'string' && key !== 'type' && key !== 'linkId')
    .map(([, value]) => value as string);
}

function leaksBound(texts: string[], bounds: readonly number[]): boolean {
  const secret = new Set<number>();
  for (const bound of bounds) {
    if (bound === 0) continue;
    secret.add(Math.abs(bound));
    secret.add(Math.abs(bound) / 100);
  }
  if (secret.size === 0) return false;
  for (const text of texts) {
    for (const match of text.matchAll(NUMBER)) {
      const value = Number.parseFloat(match[0].replace(/[$,]/g, ''));
      if (secret.has(value)) return true;
    }
  }
  return false;
}

export function guard(raw: Envelope, ctx: GuardContext): GuardResult {
  const from = typeof raw?.from === 'string' ? raw.from : 'unknown';
  const to = typeof raw?.to === 'string' ? raw.to : 'unknown';
  const fail = (rule: Violation['rule']): GuardResult => ({ ok: false, violation: { rule, from, to } });

  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return fail('schema');
  const env = parsed.data;
  const body = env.body;

  if (env.from === 'coordinator') {
    if (!ctx.coordinatorRecipients.has(env.to)) return fail('addressee');
  } else {
    const retract = body.type === 'signal' && !body.satisfiable && ctx.retractTargets.has(env.to);
    if (!ctx.relevant.has(env.to) && !retract) return fail('addressee');
  }

  const texts = freeStrings(body);
  if (leaksBound(texts, ctx.senderBounds)) return fail('content');
  const lowered = texts.map((text) => text.toLowerCase());
  if (ctx.forbidden.some((token) => token && lowered.some((text) => text.includes(token.toLowerCase())))) {
    return fail('content');
  }

  if (body.type === 'signal') {
    if (ctx.senderVersion !== body.fromVersion || ctx.recipientVersion !== body.toVersion) return fail('version');
  }
  return { ok: true, envelope: env };
}
