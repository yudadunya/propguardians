/**
 * Phase 11 — Multi-timeframe AI
 * HTF (H1) for bias / premium-discount context
 * LTF (M15/M5) for entry structure
 */

import type { Candle } from './patternDetector'
import { detectICTPattern, type DetectedPattern } from './patternDetector'
import { fetchOhlc } from './marketData'
import { selectAiTimeframe, getScheduleStatus, type KillZoneId } from './killZoneSchedule'

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
  const sched = getScheduleStatus()
  const entryTf = selectAiTimeframe(sched.activeZone as KillZoneId, instrument)
  const biasTf = 'H1'

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
 * HTF sets directional bias; LTF must agree for aligned setup
 */
export function analyzeMultiTf(
  instrument: string,
  htfCandles: Candle[],
  ltfCandles: Candle[],
  biasTf: string,
  entryTf: string
): MultiTfResult {
  const notes: string[] = []
  const htf = detectICTPattern(htfCandles, instrument, biasTf)
  const ltf = detectICTPattern(ltfCandles, instrument, entryTf)

  let direction: 'long' | 'short' = ltf?.direction || htf?.direction || 'long'
  let aligned = false

  if (htf && ltf) {
    if (htf.direction === ltf.direction) {
      aligned = true
      direction = ltf.direction
      notes.push(`Multi-TF aligned ${direction.toUpperCase()} (H1 + ${entryTf})`)
    } else {
      notes.push(
        `HTF bias ${htf.direction} ≠ LTF ${ltf.direction} — weaken / skip preference`
      )
      // Prefer HTF bias for conservative prop
      direction = htf.direction
      notes.push(`Using HTF bias: ${direction}`)
    }
  } else if (ltf) {
    direction = ltf.direction
    notes.push('LTF only (HTF weak)')
  } else if (htf) {
    direction = htf.direction
    notes.push('HTF only')
  }

  if (htf) {
    notes.push(
      `HTF ${biasTf}: ${htf.direction} · PD ${htf.inDiscount ? 'discount' : htf.inPremium ? 'premium' : 'mid'}`
    )
  }
  if (ltf) {
    notes.push(...ltf.notes.map((n) => `LTF: ${n}`))
  }

  // Merge: LTF structure + HTF premium/discount when available
  const base = ltf || htf
  if (!base) {
    // minimal empty
    const empty: DetectedPattern = {
      instrument,
      timeframe: entryTf,
      direction,
      killZone: 'outside',
      hasLiquiditySweep: false,
      sweepType: 'none',
      hasDisplacement: false,
      hasMSS: false,
      hasFVG: false,
      fvgPartiallyFilled: false,
      inPremium: false,
      inDiscount: false,
      inOTE: false,
      stopDistance: 20,
      rrRatio: 2,
      sweepLevel: null,
      fvgHigh: null,
      fvgLow: null,
      notes,
    }
    return {
      htf,
      ltf,
      aligned: false,
      direction,
      entryTf,
      biasTf,
      notes,
      merged: empty,
    }
  }

  const merged: DetectedPattern = {
    ...base,
    direction,
    timeframe: entryTf,
    inPremium:
      direction === 'short'
        ? htf?.inPremium ?? base.inPremium
        : base.inPremium,
    inDiscount:
      direction === 'long'
        ? htf?.inDiscount ?? base.inDiscount
        : base.inDiscount,
    inOTE: base.inOTE || (htf?.inOTE ?? false),
    notes,
  }

  // If not aligned, soften structure confidence flags slightly via notes only
  if (!aligned && htf && ltf) {
    notes.push('Confluence multi-TF lemah — Devil/Edge akan lebih ketat')
  }

  return {
    htf,
    ltf,
    aligned,
    direction,
    entryTf,
    biasTf,
    notes,
    merged,
  }
}
