/**
 * mt5Import.ts — MT5 / MetaTrader CSV Parser + Resampler
 *
 * Mendukung format MT5 export yang umum:
 *
 * Format 1 (tab-separated dengan header bracket):
 *   <DATE>	<TIME>	<OPEN>	<HIGH>	<LOW>	<CLOSE>	<TICKVOL>	<VOL>	<SPREAD>
 *   2024.01.02	00:00	2063.43	2063.43	2057.75	2062.75	1234	0	0
 *
 * Format 2 (comma-separated):
 *   Date,Time,Open,High,Low,Close,Volume
 *   2024.01.02,00:00,2063.43,2063.43,2057.75,2062.75,1234
 *
 * Format 3 (datetime combined):
 *   2024.01.02 00:00:00,2063.43,2063.43,2057.75,2062.75,1234
 *
 * Format 4 (semicolon-separated, some EU brokers):
 *   2024.01.02;00:00;2063.43;2063.43;2057.75;2062.75;1234
 */

import type { Candle } from './patternDetector'

export type ImportedTF = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'unknown'

export interface ImportResult {
  candles:       Candle[]
  d1Candles:     Candle[]   // resampled to D1 for top-down bias
  h1Candles:     Candle[]   // resampled to H1 (for backtest engine)
  rawTimeframe:  ImportedTF
  totalRows:     number
  validCandles:  number
  dateFrom:      string
  dateTo:        string
  instrument:    string     // parsed from filename or empty
  warnings:      string[]
}

/* ─── Date parsers ─── */

function parseDate(dateStr: string, timeStr = '00:00'): number | null {
  // Normalize: replace dots with dashes
  const d = dateStr.trim().replace(/\./g, '-')
  const t = timeStr.trim()

  const formats = [
    // 2024-01-02 + 00:00
    () => new Date(`${d}T${t}:00Z`),
    // 2024-01-02 00:00:00 (combined)
    () => new Date(`${d.replace(' ', 'T')}Z`),
    // MM/DD/YYYY
    () => {
      const [m, day, y] = d.split('/')
      return new Date(`${y}-${m?.padStart(2, '0')}-${day?.padStart(2, '0')}T${t}:00Z`)
    },
  ]

  for (const fmt of formats) {
    try {
      const dt = fmt()
      if (!isNaN(dt.getTime())) return Math.floor(dt.getTime() / 1000)
    } catch { /* try next */ }
  }
  return null
}

/* ─── Separator detector ─── */

function detectSeparator(line: string): string {
  const counts = { '\t': 0, ',': 0, ';': 0 }
  for (const ch of line) {
    if (ch in counts) counts[ch as keyof typeof counts]++
  }
  const [sep] = Object.entries(counts).sort(([, a], [, b]) => b - a)
  return sep?.[0] ?? ','
}

/* ─── Strip angle brackets from MT5 headers ─── */

function cleanHeader(h: string): string {
  return h.replace(/[<>]/g, '').trim().toLowerCase()
}

/* ─── Timeframe detector ─── */

function detectTF(candles: Candle[]): ImportedTF {
  if (candles.length < 3) return 'unknown'

  const diffs: number[] = []
  // Scan more candles (up to 100) to get better sample
  for (let i = 1; i < Math.min(100, candles.length); i++) {
    const d = candles[i].time - candles[i - 1].time
    // Filter out weekend gaps (> 4 days) and negative diffs
    if (d > 0 && d < 4 * 24 * 3600) diffs.push(d)
  }

  if (diffs.length === 0) return 'unknown'

  // Use MEDIAN not mean — weekend gaps skew the average badly
  diffs.sort((a, b) => a - b)
  const median = diffs[Math.floor(diffs.length / 2)]

  if (median < 90)    return 'M1'
  if (median < 450)   return 'M5'
  if (median < 1200)  return 'M15'
  if (median < 2400)  return 'M30'
  if (median < 10800) return 'H1'
  if (median < 25200) return 'H4'
  return 'D1'
}

/* ─── Resamplers ─── */

function groupOHLC(bars: Candle[], groupStart: number): Candle {
  return {
    time:  groupStart,
    open:  bars[0].open,
    high:  Math.max(...bars.map(b => b.high)),
    low:   Math.min(...bars.map(b => b.low)),
    close: bars[bars.length - 1].close,
  }
}

/** Resample any TF → H1 */
function resampleToH1(candles: Candle[], sourceTF: ImportedTF): Candle[] {
  if (sourceTF === 'H1') return candles
  if (sourceTF === 'D1') return candles  // D1 → H1 upsample not meaningful, skip

  // Group into 1-hour buckets by floor(time / 3600)
  const H1_SEC = 3600
  const buckets = new Map<number, Candle[]>()

  for (const c of candles) {
    const bucket = Math.floor(c.time / H1_SEC) * H1_SEC
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket)!.push(c)
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, bars]) => groupOHLC(bars, t))
}

/** Resample H1 → D1 */
function resampleToD1(h1Candles: Candle[]): Candle[] {
  const D1_SEC = 86400
  const buckets = new Map<number, Candle[]>()

  for (const c of h1Candles) {
    const bucket = Math.floor(c.time / D1_SEC) * D1_SEC
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket)!.push(c)
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, bars]) => groupOHLC(bars, t))
}

/* ─── Instrument name from filename ─── */

function guessInstrumentFromFilename(filename: string): string {
  const upper = filename.toUpperCase()
  const known = ['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY',
                 'AUDUSD', 'USDCAD', 'USDCHF', 'US30', 'USTEC',
                 'NZDUSD', 'XAGUSD', 'UK100', 'GER40', 'JP225']
  return known.find(s => upper.includes(s)) ?? ''
}

/* ─── Main parser ─── */

export function parseMT5CSV(
  content:  string,
  filename = '',
): ImportResult {
  const warnings: string[] = []
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  if (lines.length < 3) {
    return {
      candles: [], d1Candles: [], h1Candles: [],
      rawTimeframe: 'unknown', totalRows: 0, validCandles: 0,
      dateFrom: '', dateTo: '',
      instrument: guessInstrumentFromFilename(filename),
      warnings: ['File terlalu pendek atau kosong'],
    }
  }

  const sep    = detectSeparator(lines[0])
  const header = lines[0].split(sep).map(cleanHeader)

  /* Detect column indices */
  const idx = {
    date:   header.findIndex(h => h.includes('date')),
    time:   header.findIndex(h => h === 'time' || h === '<time>'),
    open:   header.findIndex(h => h.includes('open')),
    high:   header.findIndex(h => h.includes('high')),
    low:    header.findIndex(h => h.includes('low')),
    close:  header.findIndex(h => h.includes('close')),
  }

  /* Fallback: positional (date/time combined, or OHLC starts at 0) */
  const hasHeader = idx.open >= 0 && idx.close >= 0
  const dataLines = hasHeader ? lines.slice(1) : lines

  if (!hasHeader) {
    warnings.push('Header tidak terdeteksi — menggunakan posisi kolom default')
    // Guess: col 0 = date, col 1 = time or open, etc.
    const cols = lines[0].split(sep)
    if (cols.length >= 5) {
      idx.date  = 0
      idx.time  = cols[1].includes(':') ? 1 : -1
      const off = idx.time >= 0 ? 2 : 1
      idx.open  = off; idx.high = off + 1; idx.low = off + 2; idx.close = off + 3
    }
  }

  const candles: Candle[] = []
  let totalRows = 0

  for (const line of dataLines) {
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    totalRows++

    const cols = line.split(sep)

    const dateStr  = idx.date >= 0 ? cols[idx.date] : ''
    const timeStr  = idx.time >= 0 ? cols[idx.time] : '00:00'
    const openStr  = idx.open >= 0 ? cols[idx.open] : ''
    const highStr  = idx.high >= 0 ? cols[idx.high] : ''
    const lowStr   = idx.low  >= 0 ? cols[idx.low]  : ''
    const closeStr = idx.close>= 0 ? cols[idx.close]: ''

    const ts    = parseDate(dateStr ?? '', timeStr)
    const open  = parseFloat(openStr  ?? '')
    const high  = parseFloat(highStr  ?? '')
    const low   = parseFloat(lowStr   ?? '')
    const close = parseFloat(closeStr ?? '')

    if (!ts || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue
    if (high < low || open <= 0 || close <= 0) continue

    candles.push({ time: ts, open, high, low, close })
  }

  /* Sort oldest → newest */
  candles.sort((a, b) => a.time - b.time)

  /* Remove duplicates */
  const unique: Candle[] = []
  let lastT = -1
  for (const c of candles) {
    if (c.time !== lastT) { unique.push(c); lastT = c.time }
  }

  const rawTF    = detectTF(unique)
  const h1       = resampleToH1(unique, rawTF)
  const d1       = resampleToD1(h1)

  const fromTs   = unique[0]?.time ?? 0
  const toTs     = unique[unique.length - 1]?.time ?? 0
  const dateFrom = fromTs ? new Date(fromTs * 1000).toISOString().slice(0, 10) : ''
  const dateTo   = toTs   ? new Date(toTs   * 1000).toISOString().slice(0, 10) : ''

  if (unique.length < 50) {
    warnings.push(`Hanya ${unique.length} candle valid — mungkin terlalu sedikit untuk backtest akurat`)
  }
  if (rawTF === 'unknown') {
    warnings.push('Timeframe tidak terdeteksi — pastikan data terurut dan konsisten')
  }
  if (rawTF === 'H4' || rawTF === 'D1') {
    warnings.push(`TF ${rawTF} — backtest akan berjalan di ${rawTF} langsung, sample mungkin sedikit`)
  }

  return {
    candles:       unique,
    d1Candles:     d1,
    h1Candles:     rawTF === 'H4' || rawTF === 'D1' ? unique : h1,
    rawTimeframe:  rawTF,
    totalRows,
    validCandles:  unique.length,
    dateFrom,
    dateTo,
    instrument:    guessInstrumentFromFilename(filename),
    warnings,
  }
}
