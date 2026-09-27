/**
 * LivePriceTicker — displays live biquote.io prices for multiple symbols.
 * Supports two layouts:
 *   variant="row"  → horizontal strip (sidebar / header)
 *   variant="grid" → 2-col card grid (Dashboard)
 */

import { useState, useEffect } from 'react'
import { useMultiPrice } from '../hooks/useLivePrice'
import type { LivePrice } from '../lib/liveFeed'

const DEFAULT_SYMBOLS = ['XAUUSD', 'EURUSD', 'NAS100', 'GBPUSD']

function formatPrice(price: number, symbol: string): string {
  if (symbol === 'XAUUSD') return price.toFixed(2)
  if (symbol.includes('NAS') || symbol.includes('US')) return price.toFixed(1)
  return price.toFixed(5)
}

function PriceDot({ tick, errorCount }: { tick: LivePrice['tick']; errorCount: number }) {
  if (errorCount >= 3) return <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" title="Degraded" />
  if (tick === 'up') return <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
  if (tick === 'down') return <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
  return <span className="w-2 h-2 rounded-full bg-slate-500" />
}

function ChangeLabel({ change, pctChange }: { change: number; pctChange: number }) {
  const positive = change >= 0
  const color = positive ? 'text-emerald-400' : 'text-red-400'
  const sign = positive ? '+' : ''
  return (
    <span className={`text-xs font-medium ${color}`}>
      {sign}{change.toFixed(2)} ({sign}{pctChange.toFixed(2)}%)
    </span>
  )
}

/** Blink animation hook — triggers on each price update */
function useFlash(updatedAt: number | undefined) {
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!updatedAt) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 400)
    return () => clearTimeout(t)
  }, [updatedAt])
  return flash
}

/* ------------------------------------------------------------------ */
/* Single price card (used in grid variant)                            */
/* ------------------------------------------------------------------ */
function PriceCard({ symbol, state }: { symbol: string; state: { data: import('../lib/liveFeed').LivePrice | null; loading: boolean; error: string | null } }) {
  const { data, loading } = state
  const flash = useFlash(data?.updatedAt)

  return (
    <div
      className={`bg-slate-800/80 border rounded-xl p-4 transition-all duration-200 ${
        flash ? 'border-emerald-500/60 bg-slate-700/80' : 'border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-slate-400 tracking-widest uppercase">
          {symbol}
        </span>
        <div className="flex items-center gap-1.5">
          {data && <PriceDot tick={data.tick} errorCount={data.errorCount} />}
          {loading && <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />}
        </div>
      </div>

      {loading && !data && (
        <div className="h-7 w-24 bg-slate-700 rounded animate-pulse" />
      )}

      {data && (
        <>
          <div className={`text-2xl font-bold font-mono transition-colors ${
            data.tick === 'up' ? 'text-emerald-300' :
            data.tick === 'down' ? 'text-red-300' : 'text-white'
          }`}>
            {formatPrice(data.price, symbol)}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <ChangeLabel change={data.change} pctChange={data.pctChange} />
          </div>
          {data.bid && data.ask && (
            <div className="mt-1.5 flex gap-2 text-xs text-slate-500">
              <span>B: {formatPrice(data.bid, symbol)}</span>
              <span>A: {formatPrice(data.ask, symbol)}</span>
            </div>
          )}
          <div className="mt-1 text-[10px] text-slate-600">
            {new Date(data.updatedAt).toLocaleTimeString()}
          </div>
        </>
      )}

      {state.error && !data && (
        <div className="text-xs text-yellow-500 mt-1">⚠ {state.error}</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Single price row (used in row / sidebar variant)                    */
/* ------------------------------------------------------------------ */
function PriceRow({ symbol, state }: { symbol: string; state: { data: import('../lib/liveFeed').LivePrice | null; loading: boolean; error: string | null } }) {
  const { data, loading } = state
  const flash = useFlash(data?.updatedAt)

  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors ${
      flash ? 'bg-slate-700' : 'hover:bg-slate-800/60'
    }`}>
      <div className="flex items-center gap-2">
        {data
          ? <PriceDot tick={data.tick} errorCount={data.errorCount} />
          : <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
        }
        <span className="text-xs font-semibold text-slate-400 tracking-wider w-16">{symbol}</span>
      </div>

      {loading && !data && (
        <div className="h-3.5 w-16 bg-slate-700 rounded animate-pulse" />
      )}

      {data && (
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono font-bold ${
            data.tick === 'up' ? 'text-emerald-400' :
            data.tick === 'down' ? 'text-red-400' : 'text-slate-200'
          }`}>
            {formatPrice(data.price, symbol)}
          </span>
          <ChangeLabel change={data.change} pctChange={data.pctChange} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Connection status badge                                              */
/* ------------------------------------------------------------------ */
function ConnectionBadge({ states }: { states: Record<string, { data: import('../lib/liveFeed').LivePrice | null; loading: boolean; error: string | null }> }) {
  const values = Object.values(states)
  const hasAny = values.some((s) => s.data !== null)
  const hasError = values.some((s) => s.error !== null && s.data !== null)
  const allLoading = values.every((s) => s.loading)

  if (allLoading) return (
    <span className="flex items-center gap-1 text-[10px] text-slate-500">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
      Connecting…
    </span>
  )
  if (hasError) return (
    <span className="flex items-center gap-1 text-[10px] text-yellow-500">
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
      Degraded
    </span>
  )
  if (hasAny) return (
    <span className="flex items-center gap-1 text-[10px] text-emerald-500">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Live · biquote.io
    </span>
  )
  return null
}

/* ------------------------------------------------------------------ */
/* Public components                                                    */
/* ------------------------------------------------------------------ */

/** Grid variant — for Dashboard main area */
export function LivePriceGrid({ symbols = DEFAULT_SYMBOLS }: { symbols?: string[] }) {
  const states = useMultiPrice(symbols)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Live Market</h3>
        <ConnectionBadge states={states} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {symbols.map((sym) => (
          <PriceCard key={sym} symbol={sym} state={states[sym] ?? { data: null, loading: true, error: null }} />
        ))}
      </div>
    </div>
  )
}

/** Row variant — for sidebar */
export function LivePriceRows({ symbols = DEFAULT_SYMBOLS }: { symbols?: string[] }) {
  const states = useMultiPrice(symbols)

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between px-3 mb-1">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Live Prices</span>
        <ConnectionBadge states={states} />
      </div>
      {symbols.map((sym) => (
        <PriceRow key={sym} symbol={sym} state={states[sym] ?? { data: null, loading: true, error: null }} />
      ))}
    </div>
  )
}

/** Inline price — single symbol, compact (for Analyzer header) */
export function InlinePrice({ symbol }: { symbol: string }) {
  const states = useMultiPrice([symbol])
  const state = states[symbol]
  const data = state?.data
  const flash = useFlash(data?.updatedAt)

  if (!state || (state.loading && !data)) {
    return <span className="text-xs text-slate-500 animate-pulse">Loading…</span>
  }
  if (!data) return <span className="text-xs text-slate-500">–</span>

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-mono transition-colors ${
      flash ? 'text-emerald-300' : 'text-slate-200'
    }`}>
      <PriceDot tick={data.tick} errorCount={data.errorCount} />
      <span className="font-bold">{formatPrice(data.price, symbol)}</span>
      <ChangeLabel change={data.change} pctChange={data.pctChange} />
    </span>
  )
}
