/**
 * multiTf.ts — Multi-Timeframe AI v2
 *
 * Full top-down stack:
 *   D1  → Weekly DOL + overall structure (new)
 *   H4  → Intermediate structure + sweep context (new)
 *   H1  → Bias + premium/discount
 *   LTF → Entry structure (M15/M5)
 *
 * Also fetches:
 *   - Economic calendar (news filter)
 *   - Key levels (PDH/PDL/Asian range)
 */

import type { Candle }                        from './patternDetector'
import { detectICTPattern, type DetectedPattern } from './patternDetector'
import { fetchOhlc }                           from './marketData'
import { selectAiTimeframe, getScheduleStatus, getNyNow, type KillZoneId } from './killZoneSchedule'
import { analyzeTopDown, type TopDownBias }    from './topDown'
import { detectKeyLevels, type KeyLevels }     from './keyLevels'
import { checkNewsStatus, newsStatusClear, type NewsStatus } from './newsFilter'

export interface MultiTfResult {
  htf:        DetectedPattern | null
  ltf:        DetectedPattern | null
  aligned:    boolean
  direction:  'long' | 'short'
  entryTf:    string
  biasTf:     string
  notes:      string[]
  merged:     DetectedPattern
  topDown:    TopDownBias | null
  keyLevels:  KeyLevels | null
  newsStatus: NewsStatus | null
}

/* ─── Fetch all candles ─── */

export async function fetchMultiTf(instrument: string): Promise<{
  d1Candles:   Candle[]
  h4Candles:   Candle[]
  htfCandles:  Candle[]
  ltfCandles:  Candle[]
  entryTf:     string
  biasTf:      string
}> {
  const sched   = getScheduleStatus()
  const entryTf = selectAiTimeframe(sched.activeZone as KillZoneId, instrument)
  const biasTf  = 'H1'

  // Fetch all 4 timeframes + news in parallel
  const [d1, h4, htf, ltf] = await Promise.all([
    fetchOhlc(instrument, 'D1', 30),    // 30 daily bars → ~6 weeks
    fetchOhlc(instrument, 'H4', 60),    // 60 H4 bars   → ~10 days
    fetchOhlc(instrument, biasTf, 100),
    fetchOhlc(instrument, entryTf, 120),
  ])

  return {
    d1Candles:  d1.candles,
    h4Candles:  h4.candles,
    htfCandles: htf.candles,
    ltfCandles: ltf.candles,
    entryTf,
    biasTf,
  }
}

/* ─── Analyze all timeframes ─── */

export async function analyzeMultiTf(
  instrument:  string,
  d1Candles:   Candle[],
  h4Candles:   Candle[],
  htfCandles:  Candle[],
  ltfCandles:  Candle[],
  biasTf:      string,
  entryTf:     string,
): Promise<MultiTfResult> {
  const notes: string[] = []

  // DST-accurate NY hour — captured once, shared across all TF scans
  const { hour: nyHour } = getNyNow()

  // ICT pattern detection (H1 + LTF)
  const htf = detectICTPattern(htfCandles, instrument, biasTf,  nyHour)
  const ltf = detectICTPattern(ltfCandles, instrument, entryTf, nyHour)

  // Top-down D1+H4 bias
  const topDown = analyzeTopDown(d1Candles, h4Candles)

  // Key levels from D1 + H1
  const merged_pattern_base = ltf ?? htf
  const keyLevels = merged_pattern_base
    ? detectKeyLevels(
        d1Candles,
        htfCandles,
        merged_pattern_base.sweepLevel,
        merged_pattern_base.sweepType,
        merged_pattern_base.avgAtr ?? 0.001,
      )
    : null

  // Economic calendar (non-blocking — won't fail the scan)
  let newsStatus: NewsStatus | null = null
  try {
    newsStatus = await checkNewsStatus(instrument)
  } catch {
    newsStatus = newsStatusClear()
  }

  /* ─── Directional confluence ─── */

  // Priority: D1+H4 bias > H1 > LTF
  let direction: 'long' | 'short' = ltf?.direction ?? htf?.direction ?? 'long'
  let aligned = false

  if (topDown.biasDirection !== 'neutral') {
    direction = topDown.biasDirection
    notes.push(`Top-down bias: ${direction.toUpperCase()} (${topDown.alignment})`)
  }

  if (htf && ltf) {
    if (htf.direction === ltf.direction && ltf.direction === direction) {
      aligned = true
      notes.push(`✅ Full confluence: D1/H4/H1/LTF all ${direction.toUpperCase()}`)
    } else if (htf.direction !== ltf.direction) {
      notes.push(`⚠ H1 ${htf.direction} ≠ LTF ${ltf.direction}`)
    }
  }

  notes.push(...topDown.notes)
  if (keyLevels) notes.push(...keyLevels.notes)
  if (newsStatus?.recommendation !== 'clear') notes.push(`📰 NEWS: ${newsStatus?.reason}`)

  /* ─── Empty fallback ─── */

  const emptyPattern: DetectedPattern = {
    instrument, timeframe: entryTf, direction, killZone: 'outside',
    hasLiquiditySweep: false, sweepType: 'none',
    hasDisplacement: false, hasMSS: false, mssStrong: false,
    hasFVG: false, fvgPartiallyFilled: false,
    inPremium: false, inDiscount: false, inOTE: false,
    ote62: null, ote79: null, stopDistance: 20, rrRatio: 2,
    sweepLevel: null, sweepExtreme: null, fvgHigh: null, fvgLow: null,
    avgAtr: 0, notes,
  }

  if (!htf && !ltf) {
    return { htf, ltf, aligned, direction, entryTf, biasTf, notes,
             merged: emptyPattern, topDown, keyLevels, newsStatus }
  }

  /* ─── Merge: LTF structure + HTF P/D context + top-down DOL ─── */

  const base = ltf ?? htf!

  const merged: DetectedPattern = {
    ...base,
    direction,
    timeframe: entryTf,
    // P/D from H1 (bigger picture)
    inPremium:  direction === 'short' ? (htf?.inPremium  ?? base.inPremium)  : false,
    inDiscount: direction === 'long'  ? (htf?.inDiscount ?? base.inDiscount) : false,
    inOTE:      base.inOTE || (htf?.inOTE ?? false),
    ote62:      ltf?.ote62        ?? base.ote62,
    ote79:      ltf?.ote79        ?? base.ote79,
    sweepExtreme: ltf?.sweepExtreme ?? base.sweepExtreme,
    avgAtr:     ltf?.avgAtr       ?? base.avgAtr,
    mssStrong:  ltf?.mssStrong    ?? base.mssStrong ?? false,
    notes,
  }

  return { htf, ltf, aligned, direction, entryTf, biasTf, notes,
           merged, topDown, keyLevels, newsStatus }
}
