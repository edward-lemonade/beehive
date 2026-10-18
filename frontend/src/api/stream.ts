export type StreamEvent = { type: string; data: Record<string, unknown> }

export type StreamHandlers = {
  onEvent: (event: StreamEvent) => void
  onStatus: (up: boolean) => void
}

/** Parses SSE blocks out of a growing text buffer. Returns the unparsed remainder. */
export function parseSse(buffer: string, emit: (event: StreamEvent) => void): string {
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let type = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) type = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length === 0) continue
    try {
      emit({ type, data: JSON.parse(data.join('\n')) as Record<string, unknown> })
    } catch {
      // ignore malformed frames
    }
  }
  return rest
}

/**
 * Fetch-based SSE so the Authorization header can be sent (EventSource cannot).
 * Reconnects with backoff. Returns an unsubscribe function.
 */
export function openStream(
  url: string,
  getToken: () => Promise<string | null>,
  { onEvent, onStatus }: StreamHandlers,
): () => void {
  let stopped = false
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0

  const schedule = () => {
    if (stopped) return
    onStatus(false)
    const delay = Math.min(15_000, 1000 * 2 ** attempt)
    attempt += 1
    timer = setTimeout(connect, delay)
  }

  async function connect() {
    if (stopped) return
    controller = new AbortController()
    try {
      const token = await getToken()
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`)
      attempt = 0
      onStatus(true)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer = parseSse(buffer + decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n'), onEvent)
      }
    } catch {
      // fall through to reconnect
    }
    schedule()
  }

  void connect()
  return () => {
    stopped = true
    clearTimeout(timer)
    controller?.abort()
  }
}
