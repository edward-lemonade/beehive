export type HubEvent = {
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
};

class SseHub {
  private channels = new Map<string, Set<(event: HubEvent) => void>>();

  subscribe(channel: string, listener: (event: HubEvent) => void): () => void {
    const listeners = this.channels.get(channel) ?? new Set();
    listeners.add(listener);
    this.channels.set(channel, listeners);

    return () => {
      const next = this.channels.get(channel);
      if (!next) return;
      next.delete(listener);
      if (next.size === 0) this.channels.delete(channel);
    };
  }

  publish(channel: string, event: HubEvent): void {
    const listeners = this.channels.get(channel);
    if (!listeners) return;
    for (const listener of listeners) {
      listener({ ...event, createdAt: event.createdAt ?? Date.now() });
    }
  }

  streamForUser(userId: string): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const listener = (event: HubEvent) => {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload ?? {})}\n\n`),
          );
        };

        const unsubscribe = SseHub.instance.subscribe(`user:${userId}`, listener);
        controller.enqueue(encoder.encode(`event: connected\ndata: {"userId":"${userId}"}\n\n`));

        const cleanup = () => {
          unsubscribe();
          controller.close();
        };

        (globalThis as typeof globalThis & { __sse_cleanup?: () => void }).__sse_cleanup = cleanup;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  static instance = new SseHub();
}

export const sseHub = SseHub.instance;
