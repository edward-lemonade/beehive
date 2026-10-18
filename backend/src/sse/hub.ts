export type HubEvent = {
  type: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
};

export const PUBLIC_CHANNEL = 'public';
const HEARTBEAT_MS = 15_000;

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
    for (const listener of [...listeners]) {
      listener({ ...event, createdAt: event.createdAt ?? Date.now() });
    }
  }

  publishToUser(userId: string, event: HubEvent): void {
    this.publish(`user:${userId}`, event);
  }

  publishPublic(event: HubEvent): void {
    this.publish(PUBLIC_CHANNEL, event);
  }

  /** One stream per client: its own user channel plus the shared public channel. */
  streamForUser(userId: string, signal?: AbortSignal): Response {
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start: (controller) => {
        let closed = false;
        const write = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        const listener = (event: HubEvent) =>
          write(`event: ${event.type}\ndata: ${JSON.stringify({ ...event.payload, createdAt: event.createdAt })}\n\n`);

        const unsubscribers = [this.subscribe(`user:${userId}`, listener), this.subscribe(PUBLIC_CHANNEL, listener)];
        const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
        write(`event: connected\ndata: {"userId":"${userId}"}\n\n`);

        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          for (const off of unsubscribers) off();
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        signal?.addEventListener('abort', cleanup);
      },
      cancel: () => cleanup(),
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
