// Second privacy layer: whatever slips into an event, log or span text is redacted before it leaves the process.
const PHONE = /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\w-])/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const BEARER = /Bearer\s+[\w.-]+/gi;
const SENSITIVE_KEYS = /^(authorization|cookie|phone|contact|email|text|freeText|sourceText|minNetCents|maxCents|minCents|bounds?)$/i;
export function redact(value) {
    return value.replace(BEARER, 'Bearer [redacted]').replace(EMAIL, '[email]').replace(PHONE, '[phone]');
}
function scrubValue(value, depth = 0) {
    if (typeof value === 'string')
        return redact(value);
    if (depth > 6 || value === null || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map((v) => scrubValue(v, depth + 1));
    const out = {};
    for (const [key, v] of Object.entries(value)) {
        out[key] = SENSITIVE_KEYS.test(key) ? '[redacted]' : scrubValue(v, depth + 1);
    }
    return out;
}
export function scrubEvent(event) {
    if (event.message)
        event.message = redact(event.message);
    if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        if (event.request.headers) {
            for (const key of Object.keys(event.request.headers)) {
                if (/authorization|cookie/i.test(key))
                    event.request.headers[key] = '[redacted]';
            }
        }
    }
    for (const ex of event.exception?.values ?? [])
        if (ex.value)
            ex.value = redact(ex.value);
    for (const crumb of event.breadcrumbs ?? []) {
        if (crumb.message)
            crumb.message = redact(crumb.message);
        if (crumb.data)
            crumb.data = scrubValue(crumb.data);
    }
    if (event.extra)
        event.extra = scrubValue(event.extra);
    return event;
}
export function scrubAttributes(attributes) {
    return (attributes ? scrubValue(attributes) : attributes);
}
