/**
 * keyLevels.ts — Institutional Key Levels Detector
 *
 * Levels yang paling sering di-sweep institusi:
 *   PDH / PDL   → Previous Day High / Low  (paling sering = daily liquidity pool)
 *   PWH / PWL   → Previous Week High / Low (draw on weekly liquidity)
 *   Asian Range → High/Low sesi Asian (17:00–20:00 NY) untuk London Judas Swing
 *
 * Sweep di key level = jauh lebih signifikan dari swing random di chart.
 * Memberikan bonus score di ictCore dan menjadi prioritas sweep target.
 */

import type { Candle } from './patternDetector'

export interface KeyLevels {
  /* Previous Day */
  pdh: number | null
  pdl: number | null
  /* Previous Week */
  pwh: number | null
  pwl: number | null
  /* Asian Range (H1 candles 20:00–00:00 NY) */
  asianHigh: number | null
  asianLow:  number | null
  asianMid:  number | null
  /* Sweep status — was key level swept recently? */
  sweptPDH: boolean
  sweptPDL: boolean
  sweptPWH: boolean
  sweptPWL: boolean
  sweptAsianHigh: boolean
  sweptAsianLow:  boolean
  /* Which key level matches the pattern's sweep */
  matchedLevel:  string | null
  matchedBonus:  number          // extra score if sweep = key level
  notes: string[]
}

/* ─── DST-aware NY hour from UTC ─── */

function nyHourFromUTC(utcHour: number, utcMs: number): number {
  const d = new Date(utcMs)
  const year = d.getUTCFullYear()
  // DST: 2nd Sunday March → 1st Sunday November
  const marchFirst   = new Date(Date.UTC(year, 2, 1))
  const dstStart     = new Date(Date.UTC(year, 2, 8 + ((7 - marchFirst.getUTCDay()) % 7), 7))
  const novFirst     = new Date(Date.UTC(year, 10, 1))
  const dstEnd       = new Date(Date.UTC(year, 10, 1 + ((7 - novFirst.getUTCDay()) % 7), 6))
  const isDST        = d >= dstStart && d < dstEnd
  return ((utcHour + (isDST ? -4 : -5)) + 24) % 24
}

/* ─── Build PDH/PDL from D1 candles ─── */

function extractDailyLevels(d1Candles: Candle[]): { pdh: number | null; pdl: number | null } {
  if (d1Candles.length < 2) return { pdh: null, pdl: null }
  const prev = d1Candles[d1Candles.length - 2]
  return { pdh: prev.high, pdl: prev.low }
}

/* ─── Build PWH/PWL from last 10 D1 candles (approx 2 weeks) ─── */

function extractWeeklyLevels(d1Candles: Candle[]): { pwh: number | null; pwl: number | null } {
  if (d1Candles.length < 7) return { pwh: null, pwl: null }
  // Last week ≈ candles from index -10 to -5
  const lastWeek = d1Candles.slice(-10, -5)
  if (lastWeek.length === 0) return { pwh: null, pwl: null }
  return {
    pwh: Math.max(...lastWeek.map(c => c.high)),
    pwl: Math.min(...lastWeek.map(c => c.low)),
  }
}

/* ─── Asian Range from H1 candles ─── */
// Asian session = 17:00–20:00 NY (before London open)
// = 21:00–00:00 UTC (EDT) or 22:00–01:00 UTC (EST)

function extractAsianRange(h1Candles: Candle[]): {
  asianHigh: number | null
  asianLow:  number | null
  asianMid:  number | null
} {
  // Filter H1 candles that fall in Asian session
  const asian = h1Candles.filter(c => {
    const utcMs  = c.time * 1000
    const utcH   = new Date(utcMs).getUTCHours()
    const nyH    = nyHourFromUTC(utcH, utcMs)
    // Asian/pre-London: 17:00–20:00 NY
    return nyH >= 17 && nyH < 21
  }).slice(-4)   // last 4 hours of Asian session

  if (asian.length < 2) return { asianHigh: null, asianLow: null, asianMid: null }

  const high = Math.max(...asian.map(c => c.high))
  const low  = Math.min(...asian.map(c => c.low))
  return { asianHigh: high, asianLow: low, asianMid: (high + low) / 2 }
}

/* ─── Main ─── */

export function detectKeyLevels(
  d1Candles: Candle[],
  h1Candles: Candle[],
  sweepLevel: number | null,
  sweepType:  'bsl' | 'ssl' | 'none',
  avgAtr:     number,
): KeyLevels {
  const notes: string[] = []

  const { pdh, pdl }             = extractDailyLevels(d1Candles)
  const { pwh, pwl }             = extractWeeklyLevels(d1Candles)
  const { asianHigh, asianLow, asianMid } = extractAsianRange(h1Candles)

  /* Recent sweep check — last 6 H1 candles */
  const recent = h1Candles.slice(-6)

  const sweptPDH       = pdh  !== null && recent.some(c => c.high > pdh!  && c.close < pdh!)
  const sweptPDL       = pdl  !== null && recent.some(c => c.low  < pdl!  && c.close > pdl!)
  const sweptPWH       = pwh  !== null && recent.some(c => c.high > pwh!  && c.close < pwh!)
  const sweptPWL       = pwl  !== null && recent.some(c => c.low  < pwl!  && c.close > pwl!)
  const sweptAsianHigh = asianHigh !== null && recent.some(c => c.high > asianHigh! && c.close < asianHigh!)
  const sweptAsianLow  = asianLow  !== null && recent.some(c => c.low  < asianLow!  && c.close > asianLow!)

  if (pdh)  notes.push(`PDH: ${pdh.toFixed(5)}${sweptPDH ? ' ✅ swept' : ''}`)
  if (pdl)  notes.push(`PDL: ${pdl.toFixed(5)}${sweptPDL ? ' ✅ swept' : ''}`)
  if (pwh)  notes.push(`PWH: ${pwh.toFixed(5)}${sweptPWH ? ' ✅ swept' : ''}`)
  if (pwl)  notes.push(`PWL: ${pwl.toFixed(5)}${sweptPWL ? ' ✅ swept' : ''}`)
  if (asianHigh && asianLow) {
    notes.push(`Asian Range: ${asianLow.toFixed(5)}–${asianHigh.toFixed(5)}`)
  }

  /* Match sweep to key level */
  let matchedLevel: string | null = null
  let matchedBonus = 0

  if (sweepLevel !== null && sweepType !== 'none') {
    const tol = avgAtr * 0.6

    const candidates = [
      { level: pdh,       name: 'PDH',        type: 'bsl', bonus: 20 },
      { level: pdl,       name: 'PDL',        type: 'ssl', bonus: 20 },
      { level: pwh,       name: 'PWH',        type: 'bsl', bonus: 15 },
      { level: pwl,       name: 'PWL',        type: 'ssl', bonus: 15 },
      { level: asianHigh, name: 'Asian High', type: 'bsl', bonus: 12 },
      { level: asianLow,  name: 'Asian Low',  type: 'ssl', bonus: 12 },
    ]

    for (const c of candidates) {
      if (c.level === null || c.type !== sweepType) continue
      if (Math.abs(sweepLevel - c.level) <= tol) {
        matchedLevel = c.name
        matchedBonus = c.bonus
        notes.push(`🎯 Sweep matches ${c.name} (+${c.bonus} bonus score)`)
        break
      }
    }

    if (!matchedLevel) {
      notes.push('⚠️ Sweep bukan di PDH/PDL/PWH/PWL — kurang institutional')
    }
  }

  return {
    pdh, pdl, pwh, pwl,
    asianHigh, asianLow, asianMid,
    sweptPDH, sweptPDL, sweptPWH, sweptPWL, sweptAsianHigh, sweptAsianLow,
    matchedLevel,
    matchedBonus,
    notes,
  }
}
