// Bridge: Next.js API routes → realtime mini-service (socket.io broadcast)
// Fire-and-forget: never blocks or breaks the main request.

const PORT = process.env.REALTIME_PORT || 3003

export function emitEvent(event: string, data: unknown) {
  const url = `http://127.0.0.1:${PORT}/emit`
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, data }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {
    // realtime service may be offline (e.g. serverless) — polling fallback handles it
  })
}
