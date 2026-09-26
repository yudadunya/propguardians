/**
 * marketData.ts — biquote.io REST client
 * Docs: https://biquote.io/docs/
 * Free tier, no API key required.
 *
 * Endpoints used:
 *   GET /api/{symbol}                              → current tick (bid/ask/mid)
 *   GET /api/{symbol}/ohlc?interval=…&limit=…     → OHLC bars
 */

import type { Candle } from './patternDetector'

const BASE = 'https://biquote.io/api'

/** App symbol → biquote symbol name */
export const SYMBOL_MAP: Record<string, string> = {
  XAUUSD:  'XAUUSD',
  EURUSD:  'EURUSD',
  GBPUSD:  'GBPUSD',
  USDJPY:  'USDJPY',
  NAS100:  'USTEC',   // Nasdaq 100 CFD on biquote
  US30:    'US30',
  US100:   'USTEC',
}

export type BiquoteInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

const TF_TO_INTERVAL: Record<string, BiquoteInterval> = {
  M1:  '1m',
  M5:  '5m',
  M15: '15m',
  M30: '30m',
  H1:  '1h',
  H4:  '4h',
  D1:  '1d',
}

interface BiquoteBar {
  openTime: string
  open: number
  high: number
  low: number
  close: number
  volume?: number
  tickVolume?: number
  isOpen?: boolean
}

interface BiquoteOhlcResponse {
  symbol: string
  interval: string
  bars: BiquoteBar[]
}

interface BiquoteTickResponse {
  symbol?: string
  bid?: number
  ask?: number
  mid?: number
  last?: number
  spread?: number
  timestamp?: string | number
}

export function resolveSymbol(appSymbol: string): string {
  return SYMBOL_MAP[appSymbol] ?? appSymbol
}

export function resolveInterval(timeframe: string): BiquoteInterval {
  return TF_TO_INTERVAL[timeframe] ?? '15m'
}

function barToCandle(b: BiquoteBar): Candle {
  return {
    time: Math.floor(new Date(b.openTime).getTime() / 1000),
    open:  b.open,
    high:  b.high,
    low:   b.low,
    close: b.close,
  }
}

/** Shared fetch wrapper with timeout + friendly error */
async function bqFetch(url: string, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`biquote HTTP ${res.status} ${res.statusText} — ${url}`)
    }
    return res
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`biquote timeout (${timeoutMs}ms) — ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch OHLC candles from biquote.io.
 * Returns oldest→newest (reversed from API default), open bar filtered out.
 */
export async function fetchOhlc(
  appSymbol: string,
  timeframe: string,
  limit = 120,
): Promise<{ candles: Candle[]; sourceSymbol: string; interval: string }> {
  const symbol   = resolveSymbol(appSymbol)
  const interval = resolveInterval(timeframe)
  const url = `${BASE}/${encodeURIComponent(symbol)}/ohlc?interval=${interval}&limit=${limit}`

  const res  = await bqFetch(url)
  const data = (await res.json()) as BiquoteOhlcResponse

  if (!Array.isArray(data.bars) || data.bars.length === 0) {
    throw new Error(`biquote: no OHLC bars for ${symbol} (${interval})`)
  }

  // API returns newest-first → reverse to oldest-first for pattern detector
  const ordered = [...data.bars].reverse()

  // Drop the still-open bar for structure stability
  const closed = ordered.filter((b) => !b.isOpen)
  const use    = closed.length >= 20 ? closed : ordered   // fallback: include open bar if too few closed

  return {
    candles:      use.map(barToCandle),
    sourceSymbol: data.symbol ?? symbol,
    interval:     data.interval ?? interval,
  }
}

/**
 * Fetch current tick (bid/ask/mid) for a symbol.
 * Used by liveFeed.ts for real-time price polling.
 */
export async function fetchTick(
  appSymbol: string,
): Promise<{ mid: number; bid?: number; ask?: number }> {
  const symbol = resolveSymbol(appSymbol)
  const url    = `${BASE}/${encodeURIComponent(symbol)}`

  const res  = await bqFetch(url, 8_000)
  const data = (await res.json()) as BiquoteTickResponse

  const mid  = data.mid ?? data.last ?? ((data.bid ?? 0) + (data.ask ?? 0)) / 2
  if (!mid) throw new Error(`biquote: no price in tick response for ${symbol}`)

  return {
    mid,
    bid: data.bid,
    ask: data.ask,
  }
}
