/**
 * multiTf.ts — Multi-Timeframe AI
 * HTF (H1) = directional bias + premium/discount context
 * LTF (M15/M5) = entry structure + precise ICT patterns
 *
 * v1.1: DST-aware NY hour passed explicitly to both TF scans
 *       so both use the exact same moment (avoids edge case race conditions).
 *       New fields (mssStrong, sweepExtreme, ote62/ote79) forwarded through merged.
 */

import type { Candle } from './patternDetector'
import { detectICTPattern, type DetectedPattern } from './patternDetector'
import { fetchOhlc } from './marketData'
import { selectAiTimeframe, getScheduleStatus, getNyNow, type KillZoneId } from './killZoneSchedule'

export interface MultiTfResult {
  htf: DetectedPattern | null
  ltf: DetectedPattern | null
  aligned: boolean
  direction: 'long' | 'short'
  entryTf: string
  biasTf: string
  notes: string[]
  merged: DetectedPattern
}

export async function fetchMultiTf(instrument: string): Promise<{
  htfCandles: Candle[]
  ltfCandles: Candle[]
  entryTf: string
  biasTf: string
}> {
  const sched   = getScheduleStatus()
  const entryTf = selectAiTimeframe(sched.activeZone as KillZoneId, instrument)
  const biasTf  = 'H1'

  const [htf, ltf] = await Promise.all([
    fetchOhlc(instrument, biasTf, 100),
    fetchOhlc(instrument, entryTf, 120),
  ])

  return {
    htfCandles: htf.candles,
    ltfCandles: ltf.candles,
    entryTf,
    biasTf,
  }
}

/**
 * HTF sets directional bias. LTF provides entry structure.
 * Both scans use the same DST-aware NY hour captured once.
 */
export function analyzeMultiTf(
  instrument: string,
  htfCandles: Candle[],
  ltfCandles: Candle[],
  biasTf: string,
  entryTf: string,
): MultiTfResult {
  const notes: string[] = []

  // Capture DST-accurate NY hour ONCE — both TFs use the same moment
  const { hour: nyHour } = getNyNow()

  const htf = detectICTPattern(htfCandles, instrument, biasTf,   nyHour)
  const ltf = detectICTPattern(ltfCandles, instrument, entryTf,  nyHour)

  let direction: 'long' | 'short' = ltf?.direction || htf?.direction || 'long'
  let aligned = false

  if (htf && ltf) {
    if (htf.direction === ltf.direction) {
      aligned   = true
      direction = ltf.direction
      notes.push(`Multi-TF aligned ${direction.toUpperCase()} (H1 + ${entryTf})`)
    } else {
      notes.push(`HTF bias ${htf.direction} ≠ LTF ${ltf.direction} — divergence`)
      // Conservative: follow HTF bias for prop accounts
      direction = htf.direction
      notes.push(`Conservative: using HTF bias (${direction})`)
    }
  } else if (ltf) {
    direction = ltf.direction
    notes.push('LTF only — HTF data insufficient')
  } else if (htf) {
    direction = htf.direction
    notes.push('HTF only — LTF data insufficient')
  }

  if (htf) {
    notes.push(
      `HTF ${biasTf}: ${htf.direction} | ${htf.inDiscount ? 'Discount' : htf.inPremium ? 'Premium' : 'Mid'} | ATR=${htf.avgAtr}`
    )
  }
  if (ltf) {
    notes.push(...ltf.notes.map(n => `LTF: ${n}`))
  }

  if (!aligned && htf && ltf) {
    notes.push('⚠ Multi-TF confluence lemah — Devil/Edge akan lebih ketat')
  }

  /* ── Empty fallback ── */
  const emptyPattern: DetectedPattern = {
    instrument, timeframe: entryTf, direction, killZone: 'outside',
    hasLiquiditySweep: false, sweepType: 'none',
    hasDisplacement: false, hasMSS: false, mssStrong: false,
    hasFVG: false, fvgPartiallyFilled: false,
    inPremium: false, inDiscount: false, inOTE: false,
    ote62: null, ote79: null,
    stopDistance: 20, rrRatio: 2,
    sweepLevel: null, sweepExtreme: null, fvgHigh: null, fvgLow: null,
    avgAtr: 0,
    notes,
  }

  if (!htf && !ltf) {
    return { htf, ltf, aligned: false, direction, entryTf, biasTf, notes, merged: emptyPattern }
  }

  /* ── Merge: LTF structure (primary) + HTF premium/discount context ── */
  const base = ltf || htf!

  const merged: DetectedPattern = {
    ...base,
    direction,
    timeframe: entryTf,
    // HTF premium/discount overrides LTF when available (bigger picture)
    inPremium:  direction === 'short' ? (htf?.inPremium  ?? base.inPremium)  : false,
    inDiscount: direction === 'long'  ? (htf?.inDiscount ?? base.inDiscount) : false,
    // OTE: LTF primary, HTF as fallback
    inOTE: base.inOTE || (htf?.inOTE ?? false),
    // Prefer LTF levels if present; else keep base
    ote62:         ltf?.ote62         ?? base.ote62,
    ote79:         ltf?.ote79         ?? base.ote79,
    sweepExtreme:  ltf?.sweepExtreme  ?? base.sweepExtreme,
    avgAtr:        ltf?.avgAtr        ?? base.avgAtr,
    mssStrong:     ltf?.mssStrong     ?? base.mssStrong ?? false,
    notes,
  }

  return { htf, ltf, aligned, direction, entryTf, biasTf, notes, merged }
}
