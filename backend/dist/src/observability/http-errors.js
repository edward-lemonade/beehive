export function createHttpErrorMiddleware(report, errorForContext = () => undefined) {
    return async (c, next) => {
        await next();
        if (c.res.status < 400)
            return;
        report({
            status: c.res.status,
            method: c.req.method,
            path: c.req.path,
            error: errorForContext(c),
        });
    };
}
