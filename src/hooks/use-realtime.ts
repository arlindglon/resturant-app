'use client'
// Realtime hook — socket.io (gateway) with automatic polling fallback.
// Works on sandbox (XTransformPort) AND on Vercel (no socket service → falls back).
import { useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

export function useRealtime(handlers: Record<string, (data: unknown) => void>, pollMs = 5000, onPoll?: () => void) {
  const handlersRef = useRef(handlers)
  const onPollRef = useRef(onPoll)
  const socketRef = useRef<Socket | null>(null)

  // keep latest callbacks without re-subscribing
  useEffect(() => {
    handlersRef.current = handlers
    onPollRef.current = onPoll
  })

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const startPolling = (ms: number) => {
      if (pollTimer || cancelled) return
      pollTimer = setInterval(() => onPollRef.current?.(), ms)
    }

    // Try socket first
    try {
      const socket = io('/?XTransformPort=3003', {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        timeout: 3000,
      })
      socketRef.current = socket

      socket.on('connect', () => {
        // socket live → slow polling as safety net
        startPolling(pollMs * 4)
      })

      for (const ev of Object.keys(handlersRef.current)) {
        socket.on(ev, (data: unknown) => handlersRef.current[ev]?.(data))
      }

      socket.on('connect_error', () => {
        socket.disconnect()
        socketRef.current = null
        startPolling(pollMs) // fast polling fallback
      })
    } catch {
      startPolling(pollMs)
    }

    // initial + safety polling if socket never connects
    startPolling(pollMs * 4)

    return () => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
      socketRef.current?.disconnect()
    }
  }, [])
}
