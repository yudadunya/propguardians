/**
 * Phase 6 — Live market data via biquote.io (free, no API key)
 * Docs: https://biquote.io/docs/
 */

import type { Candle } from './patternDetector'

const BASE = 'https://biquote.io/api'

/** Map app symbols → biquote symbol names */
export const SYMBOL_MAP: Record<string, string> = {
  XAUUSD: 'XAUUSD',
  EURUSD: 'EURUSD',
  GBPUSD: 'GBPUSD',
  USDJPY: 'USDJPY',
  NAS100: 'USTEC', // Nasdaq 100 CFD on biquote
  US30: 'US30',
  US100: 'USTEC',
}

export type BiquoteInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

const TF_TO_INTERVAL: Record<string, BiquoteInterval> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  H4: '4h',
  D1: '1d',
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

export function resolveSymbol(appSymbol: string): string {
  return SYMBOL_MAP[appSymbol] || appSymbol
}

export function resolveInterval(timeframe: string): BiquoteInterval {
  return TF_TO_INTERVAL[timeframe] || '15m'
}

function barToCandle(b: BiquoteBar): Candle {
  return {
    time: Math.floor(new Date(b.openTime).getTime() / 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }
}

/**
 * Fetch OHLC from biquote. Returns oldest→newest, closed bars preferred.
 */
export async function fetchOhlc(
  appSymbol: string,
  timeframe: string,
  limit = 120
): Promise<{ candles: Candle[]; sourceSymbol: string; interval: string }> {
  const symbol = resolveSymbol(appSymbol)
  const interval = resolveInterval(timeframe)
  const url = `${BASE}/${encodeURIComponent(symbol)}/ohlc?interval=${interval}&limit=${limit}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`biquote HTTP ${res.status} for ${symbol}`)
  }

  const data = (await res.json()) as BiquoteOhlcResponse
  if (!data.bars || data.bars.length === 0) {
    throw new Error(`No OHLC bars for ${symbol} (${interval})`)
  }

  // API returns newest first; reverse to oldest→newest for detector
  const ordered = [...data.bars].reverse()
  // Drop currently open bar for structure stability (optional keep last)
  const closed = ordered.filter((b) => !b.isOpen)
  const use = closed.length >= 20 ? closed : ordered

  return {
    candles: use.map(barToCandle),
    sourceSymbol: data.symbol || symbol,
    interval: data.interval || interval,
  }
}

export async function fetchTick(appSymbol: string): Promise<{ mid: number; bid?: number; ask?: number }> {
  const symbol = resolveSymbol(appSymbol)
  const res = await fetch(`${BASE}/${encodeURIComponent(symbol)}`)
  if (!res.ok) throw new Error(`biquote tick HTTP ${res.status}`)
  const data = await res.json()
  return {
    mid: data.mid ?? data.last ?? 0,
    bid: data.bid,
    ask: data.ask,
  }
}
