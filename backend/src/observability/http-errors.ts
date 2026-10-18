import type { Context, MiddlewareHandler } from 'hono';

export type HttpFailure = {
  status: number;
  method: string;
  path: string;
  error?: Error;
};

export function createHttpErrorMiddleware(
  report: (failure: HttpFailure) => void,
  errorForContext: (context: Context) => Error | undefined = () => undefined,
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.status < 400) return;

    report({
      status: c.res.status,
      method: c.req.method,
      path: c.req.path,
      error: errorForContext(c),
    });
  };
}
