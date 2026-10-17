import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIntent, parseIntentText } from '../src/intents/parse.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('structured intent parser', () => {
  it('sends only the supplied user text and validates the structured model output', async () => {
    const text = 'selling my Friday Coachella ticket, want $300 but would take $270';
    const parsed = parseIntentText(text);
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        messages: [{ role: 'system' }, { role: 'user', content: text }],
        response_format: { type: 'json_object' },
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(parsed) } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await parseIntent(text);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchInlineSnapshot(`
      {
        "deadline": null,
        "declaredNetCents": 30000,
        "give": [
          {
            "attrs": {
              "day": "friday",
              "event": "coachella",
            },
            "kind": "ticket",
            "label": "coachella-friday",
            "qty": 1,
          },
        ],
        "injectionReason": null,
        "injectionSuspected": false,
        "minNetCents": 27000,
        "separateOrTogether": null,
        "want": [
          {
            "anyOf": [
              {
                "amountCents": 30000,
                "attrs": {
                  "currency": "usd",
                },
                "flex": "flexible",
                "kind": "cash",
                "label": "cash",
                "qty": 1,
              },
            ],
          },
        ],
      }
    `);
  });

  it('rejects invalid structured output instead of returning a partial parse', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ give: [], want: [] }) } }],
    }), { status: 200 })));

    await expect(parseIntent('selling a ticket')).rejects.toThrow();
  });
});
