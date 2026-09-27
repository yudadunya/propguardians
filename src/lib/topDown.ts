/**
 * topDown.ts — D1 + H4 Bias Analyzer (ICT Top-Down Methodology)
 *
 * Sequence:
 *  D1 → Weekly Draw on Liquidity + overall bullish/bearish structure
 *  H4 → Intermediate structure + has H4 sweep happened?
 *
 * Result feeds into ictCore (score bonus) and devilAgent (conflict flag).
 */

import type { Candle } from './patternDetector'

export type StructureBias = 'bullish' | 'bearish' | 'ranging' | 'unknown'
export type PriceZone     = 'premium' | 'discount' | 'equilibrium'
export type DrawOn        = 'targeting_highs' | 'targeting_lows' | 'unknown'

export interface TFBias {
  tf:            string
  structure:     StructureBias
  zone:          PriceZone
  recentSweep:   boolean
  sweepSide:     'high' | 'low' | 'none'
  drawOn:        DrawOn
  rangeHigh:     number
  rangeLow:      number
  equilibrium:   number
  notes:         string[]
}

export interface TopDownBias {
  d1:             TFBias | null
  h4:             TFBias | null
  alignment:      'strong_bull' | 'strong_bear' | 'partial_bull' | 'partial_bear' | 'conflicting' | 'unknown'
  biasDirection:  'long' | 'short' | 'neutral'
  confluenceScore: number   // 0–100 (feeds into ictCore bonus)
  notes:          string[]
}

/* ─── helpers ─── */

function calcATR(candles: Candle[], period = 10): number {
  const s = candles.slice(-period)
  return s.reduce((a, c) => a + (c.high - c.low), 0) / s.length || 1e-6
}

function detectStructure(candles: Candle[]): {
  structure: StructureBias
  rangeHigh: number
  rangeLow: number
  recentSweep: boolean
  sweepSide: 'high' | 'low' | 'none'
  drawOn: DrawOn
} {
  if (candles.length < 10) {
    return { structure: 'unknown', rangeHigh: 0, rangeLow: 0,
             recentSweep: false, sweepSide: 'none', drawOn: 'unknown' }
  }

  const look = candles.slice(-20)
  const atr  = calcATR(look)

  const rangeHigh = Math.max(...look.map(c => c.high))
  const rangeLow  = Math.min(...look.map(c => c.low))

  /* Trend: compare close of first third vs last third */
  const third  = Math.ceil(look.length / 3)
  const early  = look.slice(0, third).reduce((a, c) => a + c.close, 0) / third
  const late   = look.slice(-third).reduce((a, c) => a + c.close, 0) / third
  const change = (late - early) / Math.max(atr, 1e-9)

  const structure: StructureBias =
    change >  1.5 ? 'bullish' :
    change < -1.5 ? 'bearish' :
                    'ranging'

  /* Sweep detection: last 4 candles wicked beyond prior range then closed back */
  const lookback      = candles.slice(-15, -4)
  const priorHigh     = Math.max(...lookback.map(c => c.high))
  const priorLow      = Math.min(...lookback.map(c => c.low))
  const recent4       = candles.slice(-4)

  let recentSweep = false
  let sweepSide: 'high' | 'low' | 'none' = 'none'

  for (const c of recent4) {
    if (c.high > priorHigh && c.close < priorHigh) { recentSweep = true; sweepSide = 'high'; break }
    if (c.low  < priorLow  && c.close > priorLow)  { recentSweep = true; sweepSide = 'low';  break }
  }

  const lastClose  = candles[candles.length - 1].close
  const equilibrium = (rangeHigh + rangeLow) / 2

  /* Draw on Liquidity */
  let drawOn: DrawOn = 'unknown'
  if (recentSweep) {
    drawOn = sweepSide === 'low' ? 'targeting_highs' : 'targeting_lows'
  } else if (structure === 'bullish' && lastClose < equilibrium) {
    drawOn = 'targeting_highs'
  } else if (structure === 'bearish' && lastClose > equilibrium) {
    drawOn = 'targeting_lows'
  }

  return { structure, rangeHigh, rangeLow, recentSweep, sweepSide, drawOn }
}

function buildTFBias(candles: Candle[], tf: string): TFBias {
  const notes: string[] = []
  const r     = detectStructure(candles)
  const last  = candles[candles.length - 1]?.close ?? 0
  const eq    = (r.rangeHigh + r.rangeLow) / 2
  const span  = r.rangeHigh - r.rangeLow

  const zone: PriceZone =
    Math.abs(last - eq) < span * 0.10 ? 'equilibrium' :
    last > eq                          ? 'premium'     :
                                         'discount'

  notes.push(`${tf}: ${r.structure} | ${zone}${r.recentSweep ? ` | Swept ${r.sweepSide}s → ${r.drawOn}` : ''}`)

  return {
    tf, structure: r.structure, zone,
    recentSweep: r.recentSweep, sweepSide: r.sweepSide,
    drawOn: r.drawOn,
    rangeHigh: r.rangeHigh, rangeLow: r.rangeLow, equilibrium: eq,
    notes,
  }
}

/* ─── main export ─── */

export function analyzeTopDown(
  d1Candles: Candle[],
  h4Candles: Candle[],
): TopDownBias {
  const notes: string[] = []

  const d1 = d1Candles.length >= 8  ? buildTFBias(d1Candles, 'D1') : null
  const h4 = h4Candles.length >= 10 ? buildTFBias(h4Candles, 'H4') : null

  if (d1) notes.push(...d1.notes)
  if (h4) notes.push(...h4.notes)

  if (!d1 && !h4) {
    return { d1, h4, alignment: 'unknown', biasDirection: 'neutral', confluenceScore: 50, notes }
  }

  const d1Up   = d1?.structure === 'bullish' || d1?.drawOn === 'targeting_highs'
  const d1Down = d1?.structure === 'bearish' || d1?.drawOn === 'targeting_lows'
  const h4Up   = h4?.structure === 'bullish' || h4?.drawOn === 'targeting_highs'
  const h4Down = h4?.structure === 'bearish' || h4?.drawOn === 'targeting_lows'

  let alignment:      TopDownBias['alignment'] = 'unknown'
  let biasDirection:  TopDownBias['biasDirection'] = 'neutral'
  let confluenceScore = 50

  if (d1Up && h4Up) {
    alignment      = 'strong_bull'
    biasDirection  = 'long'
    confluenceScore = 90
    notes.push('✅ D1+H4 BULLISH ALIGNED → prefer LONG setups')
  } else if (d1Down && h4Down) {
    alignment      = 'strong_bear'
    biasDirection  = 'short'
    confluenceScore = 90
    notes.push('✅ D1+H4 BEARISH ALIGNED → prefer SHORT setups')
  } else if (d1Up && !h4Down) {
    alignment      = 'partial_bull'
    biasDirection  = 'long'
    confluenceScore = 65
    notes.push('🟡 D1 bullish, H4 neutral → lean LONG')
  } else if (d1Down && !h4Up) {
    alignment      = 'partial_bear'
    biasDirection  = 'short'
    confluenceScore = 65
    notes.push('🟡 D1 bearish, H4 neutral → lean SHORT')
  } else if ((d1Up && h4Down) || (d1Down && h4Up)) {
    alignment      = 'conflicting'
    biasDirection  = 'neutral'
    confluenceScore = 20
    notes.push('⚠️ D1 vs H4 CONFLICTING — sangat berisiko, tunggu resolusi')
  }

  /* Bonus: H4 swept against D1 DOL → ideal entry context */
  if (d1?.drawOn === 'targeting_highs' && h4?.sweepSide === 'low') {
    confluenceScore = Math.min(100, confluenceScore + 10)
    notes.push('🔥 H4 swept lows while D1 targets highs → ideal long context')
  }
  if (d1?.drawOn === 'targeting_lows' && h4?.sweepSide === 'high') {
    confluenceScore = Math.min(100, confluenceScore + 10)
    notes.push('🔥 H4 swept highs while D1 targets lows → ideal short context')
  }

  return { d1, h4, alignment, biasDirection, confluenceScore, notes }
}
