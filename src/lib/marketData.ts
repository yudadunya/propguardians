/**
 * marketData.ts — Market Data Client
 *
 * Priority:
 *  1. MT5 Bridge (localhost:8765) — data dari broker kamu sendiri
 *  2. biquote.io — fallback kalau bridge tidak aktif
 *
 * Bridge URL dikonfigurasi via Settings → MT5 Bridge.
 * Auto-fallback transparan, tidak perlu intervensi user.
 */

import type { Candle } from './patternDetector'

/* ─── biquote symbol map ─── */
const BIQUOTE_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: 'XAUUSD', EURUSD: 'EURUSD', GBPUSD: 'GBPUSD',
  USDJPY: 'USDJPY', NAS100: 'USTEC',  US30:   'US30',
  USTEC:  'USTEC',  AUDUSD: 'AUDUSD', USDCAD: 'USDCAD',
}

const BIQUOTE_TF: Record<string, string> = {
  M1: '1m', M5: '5m', M15: '15m', M30: '30m',
  H1: '1h', H4: '4h', D1:  '1d',
}

/* ─── MT5 Bridge URL (set dari Settings) ─── */

const BRIDGE_KEY = 'pg_mt5_bridge_url'

export function getMT5BridgeURL(): string {
  try { return localStorage.getItem(BRIDGE_KEY) ?? '' } catch { return '' }
}

export function setMT5BridgeURL(url: string) {
  try {
    if (url) localStorage.setItem(BRIDGE_KEY, url.replace(/\/$/, ''))
    else     localStorage.removeItem(BRIDGE_KEY)
  } catch { /* ignore */ }
}

/* ─── Bridge availability cache ─── */

let bridgeAvailable: boolean | null = null
let lastBridgeCheck = 0
const BRIDGE_CACHE_MS = 30_000  // re-check setiap 30 detik

async function isBridgeAvailable(): Promise<boolean> {
  const url = getMT5BridgeURL()
  if (!url) return false

  const now = Date.now()
  if (bridgeAvailable !== null && now - lastBridgeCheck < BRIDGE_CACHE_MS) {
    return bridgeAvailable
  }

  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    const ok = res.ok
    bridgeAvailable = ok
    lastBridgeCheck = now
    return ok
  } catch {
    bridgeAvailable = false
    lastBridgeCheck = now
    return false
  }
}

export async function testBridgeConnection(
  url: string,
): Promise<{ ok: boolean; server?: string; account?: string; error?: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return {
      ok:      true,
      server:  data?.mt5?.server  ?? data?.account?.server,
      account: data?.account?.name ?? String(data?.account?.login ?? ''),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/* ─── Shared fetch helper ─── */

async function apiFetch(url: string, timeoutMs = 10_000): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`)
  return res
}

interface BiquoteBar {
  openTime: string; open: number; high: number
  low: number; close: number; isOpen?: boolean
}

function barToCandle(b: BiquoteBar): Candle {
  return {
    time:  Math.floor(new Date(b.openTime).getTime() / 1000),
    open:  b.open, high: b.high, low: b.low, close: b.close,
  }
}

/* ─── Fetch OHLC ─── */

async function fetchOhlcFromBridge(
  appSymbol: string, timeframe: string, limit: number,
): Promise<{ candles: Candle[]; source: string }> {
  const url = getMT5BridgeURL()
  const res  = await apiFetch(`${url}/ohlc/${appSymbol}/${timeframe}?limit=${limit}`, 12_000)
  const data = await res.json() as { bars: BiquoteBar[]; symbol: string; interval: string }

  if (!Array.isArray(data.bars) || data.bars.length === 0) {
    throw new Error(`MT5 Bridge: no bars for ${appSymbol} ${timeframe}`)
  }

  const closed  = data.bars.filter(b => !b.isOpen)
  const candles = (closed.length >= 20 ? closed : data.bars).map(barToCandle)
  candles.sort((a, b) => a.time - b.time)

  return { candles, source: 'MT5' }
}

async function fetchOhlcFromBiquote(
  appSymbol: string, timeframe: string, limit: number,
): Promise<{ candles: Candle[]; source: string }> {
  const symbol   = BIQUOTE_SYMBOL_MAP[appSymbol] ?? appSymbol
  const interval = BIQUOTE_TF[timeframe] ?? '1h'
  const url      = `https://biquote.io/api/${encodeURIComponent(symbol)}/ohlc?interval=${interval}&limit=${limit}`

  const res  = await apiFetch(url)
  const data = await res.json() as { bars: BiquoteBar[] }

  if (!Array.isArray(data.bars) || data.bars.length === 0) {
    throw new Error(`biquote: no bars for ${symbol} (${interval})`)
  }

  const closed  = data.bars.filter(b => !b.isOpen)
  const candles = (closed.length >= 20 ? closed : data.bars).map(barToCandle)
  candles.sort((a, b) => a.time - b.time)

  return { candles, source: 'biquote' }
}

/** Fetch OHLC — try MT5 bridge first, fallback to biquote */
export async function fetchOhlc(
  appSymbol: string,
  timeframe: string,
  limit = 120,
): Promise<{ candles: Candle[]; sourceSymbol: string; interval: string; source: string }> {
  if (await isBridgeAvailable()) {
    try {
      const { candles, source } = await fetchOhlcFromBridge(appSymbol, timeframe, limit)
      return { candles, sourceSymbol: appSymbol, interval: timeframe, source }
    } catch (e) {
      console.warn(`[MT5] OHLC fallback to biquote: ${e}`)
      bridgeAvailable = false  // mark bridge as down
    }
  }

  const { candles, source } = await fetchOhlcFromBiquote(appSymbol, timeframe, limit)
  return { candles, sourceSymbol: appSymbol, interval: timeframe, source }
}

/* ─── Fetch tick ─── */

async function fetchTickFromBridge(
  appSymbol: string,
): Promise<{ mid: number; bid?: number; ask?: number }> {
  const url = getMT5BridgeURL()
  const res  = await apiFetch(`${url}/tick/${appSymbol}`, 6_000)
  const data = await res.json() as { mid: number; bid?: number; ask?: number }
  if (!data.mid) throw new Error('Bridge: no mid price')
  return data
}

async function fetchTickFromBiquote(
  appSymbol: string,
): Promise<{ mid: number; bid?: number; ask?: number }> {
  const symbol = BIQUOTE_SYMBOL_MAP[appSymbol] ?? appSymbol
  const res    = await apiFetch(`https://biquote.io/api/${encodeURIComponent(symbol)}`, 8_000)
  const data   = await res.json() as { mid?: number; bid?: number; ask?: number; last?: number }
  const mid    = data.mid ?? data.last ?? ((data.bid ?? 0) + (data.ask ?? 0)) / 2
  if (!mid) throw new Error(`biquote: no price for ${symbol}`)
  return { mid, bid: data.bid, ask: data.ask }
}

/** Fetch current tick — try MT5 bridge first, fallback to biquote */
export async function fetchTick(
  appSymbol: string,
): Promise<{ mid: number; bid?: number; ask?: number }> {
  if (await isBridgeAvailable()) {
    try {
      return await fetchTickFromBridge(appSymbol)
    } catch {
      bridgeAvailable = false
    }
  }
  return fetchTickFromBiquote(appSymbol)
}

export function resolveSymbol(s: string): string { return s }
export function resolveInterval(tf: string): string { return BIQUOTE_TF[tf] ?? '1h' }
