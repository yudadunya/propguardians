/**
 * useLivePrice — subscribe to a live price from liveFeed singleton.
 * Returns stable state: { data, loading, error }
 * Cleans up subscription automatically on unmount or symbol change.
 */

import { useState, useEffect, useRef } from 'react'
import { liveFeed, type LivePrice } from '../lib/liveFeed'

export interface LivePriceState {
  data: LivePrice | null
  loading: boolean
  error: string | null
}

const TIMEOUT_MS = 12_000

export function useLivePrice(symbol: string | null): LivePriceState {
  const [data, setData] = useState<LivePrice | null>(() =>
    symbol ? liveFeed.getSnapshot(symbol) : null
  )
  const [loading, setLoading] = useState(() =>
    symbol ? liveFeed.getSnapshot(symbol) === null : false
  )
  const [error, setError] = useState<string | null>(null)

  // Stable ref for the timeout so it survives re-renders
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!symbol) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }

    // Snapshot replay before subscribing
    const snap = liveFeed.getSnapshot(symbol)
    if (snap) {
      setData(snap)
      setLoading(false)
      setError(null)
    } else {
      setLoading(true)
      setError(null)
    }

    const unsub = liveFeed.subscribe(symbol, (lp) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      setData(lp)
      setLoading(false)
      // Show error state if consecutive errors > 3
      if (lp.errorCount >= 3) {
        setError(`Data degraded (${lp.errorCount} errors) — retrying…`)
      } else {
        setError(null)
      }
    })

    // Timeout fallback: if no price arrives after 12s, show error
    timeoutRef.current = setTimeout(() => {
      setLoading((prev) => {
        if (prev) setError('Tidak bisa connect ke biquote.io — cek koneksi internet')
        return false
      })
    }, TIMEOUT_MS)

    return () => {
      unsub()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [symbol])

  return { data, loading, error }
}

/**
 * useMultiPrice — subscribe to multiple symbols at once.
 * Returns a Record<symbol, LivePriceState> so the caller can render a grid.
 */
export function useMultiPrice(symbols: string[]): Record<string, LivePriceState> {
  const [states, setStates] = useState<Record<string, LivePriceState>>(() => {
    const init: Record<string, LivePriceState> = {}
    for (const s of symbols) {
      const snap = liveFeed.getSnapshot(s)
      init[s] = { data: snap, loading: snap === null, error: null }
    }
    return init
  })

  useEffect(() => {
    if (symbols.length === 0) return
    const unsubs: (() => void)[] = []

    for (const sym of symbols) {
      const unsub = liveFeed.subscribe(sym, (lp) => {
        setStates((prev) => ({
          ...prev,
          [sym]: {
            data: lp,
            loading: false,
            error: lp.errorCount >= 3
              ? `Data degraded (${lp.errorCount} errors)`
              : null,
          },
        }))
      })
      unsubs.push(unsub)
    }

    return () => unsubs.forEach((u) => u())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')])

  return states
}
