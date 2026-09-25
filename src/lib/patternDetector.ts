/**
 * Phase 5 — ICT Pattern Detector from OHLC
 * Detects swings, liquidity sweeps, FVG, simple MSS hints from candle data.
 * Demo-ready; swap feed for live API later.
 */

export interface Candle {
  time: number // unix sec
  open: number
  high: number
  low: number
  close: number
}

export interface DetectedPattern {
  instrument: string
  timeframe: string
  direction: 'long' | 'short'
  killZone: 'london' | 'ny_am' | 'silver_bullet' | 'ny_pm' | 'outside'
  hasLiquiditySweep: boolean
  sweepType: 'bsl' | 'ssl' | 'none'
  hasDisplacement: boolean
  hasMSS: boolean
  hasFVG: boolean
  fvgPartiallyFilled: boolean
  inPremium: boolean
  inDiscount: boolean
  inOTE: boolean
  stopDistance: number
  rrRatio: number
  sweepLevel: number | null
  fvgHigh: number | null
  fvgLow: number | null
  notes: string[]
}

function swingHighsLows(candles: Candle[], left = 2, right = 2) {
  const highs: { i: number; price: number }[] = []
  const lows: { i: number; price: number }[] = []
  for (let i = left; i < candles.length - right; i++) {
    const h = candles[i].high
    const l = candles[i].low
    let isH = true
    let isL = true
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue
      if (candles[j].high >= h) isH = false
      if (candles[j].low <= l) isL = false
    }
    if (isH) highs.push({ i, price: h })
    if (isL) lows.push({ i, price: l })
  }
  return { highs, lows }
}

/** 3-candle FVG: bullish if c1.high < c3.low */
function findRecentFVG(candles: Candle[]) {
  for (let i = candles.length - 1; i >= 2; i--) {
    const c1 = candles[i - 2]
    const c2 = candles[i - 1]
    const c3 = candles[i]
    // bullish FVG
    if (c1.high < c3.low) {
      const filled = candles.slice(i + 1).some((c) => c.low <= c1.high)
      return {
        bullish: true as const,
        high: c3.low,
        low: c1.high,
        mid: (c3.low + c1.high) / 2,
        partial: filled,
        index: i,
        displacement: Math.abs(c2.close - c2.open) > Math.abs(c1.close - c1.open) * 1.2,
      }
    }
    // bearish FVG
    if (c1.low > c3.high) {
      const filled = candles.slice(i + 1).some((c) => c.high >= c1.low)
      return {
        bullish: false as const,
        high: c1.low,
        low: c3.high,
        mid: (c1.low + c3.high) / 2,
        partial: filled,
        index: i,
        displacement: Math.abs(c2.close - c2.open) > Math.abs(c1.close - c1.open) * 1.2,
      }
    }
  }
  return null
}

function inferKillZone(hourNy: number): DetectedPattern['killZone'] {
  if (hourNy >= 2 && hourNy < 5) return 'london'
  if (hourNy >= 7 && hourNy < 10) return 'ny_am'
  if (hourNy >= 10 && hourNy < 11) return 'silver_bullet'
  if (hourNy >= 13 && hourNy < 16) return 'ny_pm'
  return 'outside'
}

/**
 * Scan OHLC series → ICT structure fields for the multi-agent pipeline
 */
export function detectICTPattern(
  candles: Candle[],
  instrument: string,
  timeframe: string,
  nowHourNy?: number
): DetectedPattern | null {
  if (candles.length < 20) return null

  const notes: string[] = []
  const { highs, lows } = swingHighsLows(candles)
  const last = candles[candles.length - 1]
  const fvg = findRecentFVG(candles)

  // Recent sweep: price wicked beyond last swing then closed back
  let hasLiquiditySweep = false
  let sweepType: 'bsl' | 'ssl' | 'none' = 'none'
  let sweepLevel: number | null = null
  let direction: 'long' | 'short' = 'long'

  const recent = candles.slice(-8)
  const priorHighs = highs.filter((h) => h.i < candles.length - 3)
  const priorLows = lows.filter((l) => l.i < candles.length - 3)

  if (priorHighs.length) {
    const lvl = priorHighs[priorHighs.length - 1].price
    const swept = recent.some((c) => c.high > lvl)
    const closedBack = last.close < lvl
    if (swept && closedBack) {
      hasLiquiditySweep = true
      sweepType = 'bsl'
      sweepLevel = lvl
      direction = 'short'
      notes.push(`BSL sweep @ ${lvl.toFixed(2)}`)
    }
  }
  if (priorLows.length) {
    const lvl = priorLows[priorLows.length - 1].price
    const swept = recent.some((c) => c.low < lvl)
    const closedBack = last.close > lvl
    if (swept && closedBack) {
      // prefer most recent clear sweep; if both, use closer extreme
      if (!hasLiquiditySweep || (sweepLevel !== null && Math.abs(last.close - lvl) < Math.abs(last.close - sweepLevel))) {
        hasLiquiditySweep = true
        sweepType = 'ssl'
        sweepLevel = lvl
        direction = 'long'
        notes.push(`SSL sweep @ ${lvl.toFixed(2)}`)
      }
    }
  }

  // FVG direction alignment
  let hasFVG = false
  let fvgPartiallyFilled = false
  let fvgHigh: number | null = null
  let fvgLow: number | null = null
  let hasDisplacement = false

  if (fvg) {
    hasFVG = true
    fvgPartiallyFilled = fvg.partial
    fvgHigh = fvg.high
    fvgLow = fvg.low
    hasDisplacement = fvg.displacement
    if (fvg.bullish) {
      direction = 'long'
      if (sweepType === 'none') {
        hasLiquiditySweep = true
        sweepType = 'ssl'
        notes.push('Bias long from bullish FVG')
      }
    } else {
      direction = 'short'
      if (sweepType === 'none') {
        hasLiquiditySweep = true
        sweepType = 'bsl'
        notes.push('Bias short from bearish FVG')
      }
    }
    notes.push(`FVG ${fvg.bullish ? 'bull' : 'bear'} ${fvg.low.toFixed(2)}–${fvg.high.toFixed(2)}`)
  }

  // Simple MSS: last close beyond prior swing opposite to sweep
  let hasMSS = false
  if (direction === 'long' && priorHighs.length) {
    const sh = priorHighs[priorHighs.length - 1].price
    if (last.close > sh) {
      hasMSS = true
      notes.push('Bullish MSS (close above swing high)')
    }
  }
  if (direction === 'short' && priorLows.length) {
    const sl = priorLows[priorLows.length - 1].price
    if (last.close < sl) {
      hasMSS = true
      notes.push('Bearish MSS (close below swing low)')
    }
  }
  // Soft MSS: displacement candle in direction
  if (!hasMSS && hasDisplacement) {
    hasMSS = true
    notes.push('MSS inferred from displacement')
  }

  // Dealing range premium/discount from recent window
  const window = candles.slice(-30)
  const rangeHigh = Math.max(...window.map((c) => c.high))
  const rangeLow = Math.min(...window.map((c) => c.low))
  const eq = (rangeHigh + rangeLow) / 2
  const inPremium = last.close > eq
  const inDiscount = last.close < eq

  // OTE approx: price in 62-79% retracement of last impulse leg
  let inOTE = false
  if (fvg && sweepLevel !== null) {
    const leg = Math.abs(fvg.mid - sweepLevel)
    if (leg > 0) {
      const retrace = direction === 'long'
        ? (rangeHigh - last.close) / (rangeHigh - rangeLow || 1)
        : (last.close - rangeLow) / (rangeHigh - rangeLow || 1)
      // simplified: mid of FVG in discount/premium zone counts as OTE-ish
      inOTE = direction === 'long' ? inDiscount : inPremium
      if (inOTE) notes.push('OTE-like (FVG in discount/premium)')
    }
  } else if (direction === 'long' && inDiscount) {
    inOTE = true
  } else if (direction === 'short' && inPremium) {
    inOTE = true
  }

  const stopDistance =
    sweepLevel !== null
      ? Math.max(5, Math.abs(last.close - sweepLevel) * 0.15 + (last.high - last.low))
      : Math.max(10, (last.high - last.low) * 2)

  const targetDist = Math.abs(rangeHigh - rangeLow) * 0.5
  const rrRatio = stopDistance > 0 ? Math.max(1, targetDist / stopDistance) : 2

  const hour = nowHourNy ?? new Date().getUTCHours() - 4 // rough NY
  const killZone = inferKillZone(((hour % 24) + 24) % 24)

  return {
    instrument,
    timeframe,
    direction,
    killZone,
    hasLiquiditySweep,
    sweepType,
    hasDisplacement,
    hasMSS,
    hasFVG,
    fvgPartiallyFilled,
    inPremium: direction === 'short' ? inPremium : inPremium && !inDiscount,
    inDiscount: direction === 'long' ? inDiscount : false,
    inOTE,
    stopDistance: Math.round(stopDistance * 10) / 10,
    rrRatio: Math.round(Math.min(4, Math.max(1.2, rrRatio)) * 10) / 10,
    sweepLevel,
    fvgHigh,
    fvgLow,
    notes,
  }
}

/** Generate demo OHLC with a synthetic SSL sweep + bullish FVG for testing */
export function generateDemoCandles(instrument: string): Candle[] {
  const base =
    instrument === 'XAUUSD' ? 2650 : instrument === 'NAS100' ? 21000 : 1.08
  const candles: Candle[] = []
  let t = Math.floor(Date.now() / 1000) - 80 * 900
  let price = base

  for (let i = 0; i < 60; i++) {
    const drift = (Math.random() - 0.48) * base * 0.001
    const o = price
    const c = price + drift
    const h = Math.max(o, c) + Math.random() * base * 0.0004
    const l = Math.min(o, c) - Math.random() * base * 0.0004
    candles.push({ time: t, open: o, high: h, low: l, close: c })
    price = c
    t += 900
  }

  // Inject SSL sweep + displacement + bullish FVG near end
  const n = candles.length
  const swingLow = candles[n - 12].low
  // sweep bar
  candles[n - 6] = {
    ...candles[n - 6],
    low: swingLow - base * 0.0012,
    close: swingLow + base * 0.0003,
    high: candles[n - 6].open + base * 0.0005,
  }
  // displacement up
  const mid = candles[n - 5].open
  candles[n - 5] = {
    time: candles[n - 5].time,
    open: mid,
    low: mid - base * 0.0002,
    high: mid + base * 0.0025,
    close: mid + base * 0.0022,
  }
  // gap candle 3
  candles[n - 4] = {
    time: candles[n - 4].time,
    open: candles[n - 5].close,
    high: candles[n - 5].close + base * 0.0008,
    low: candles[n - 5].close - base * 0.0001,
    close: candles[n - 5].close + base * 0.0005,
  }
  // pullback into FVG
  candles[n - 2] = {
    time: candles[n - 2].time,
    open: candles[n - 3].close,
    high: candles[n - 3].close,
    low: candles[n - 5].open + base * 0.0003,
    close: candles[n - 5].open + base * 0.0005,
  }
  candles[n - 1] = {
    time: candles[n - 1].time,
    open: candles[n - 2].close,
    high: candles[n - 2].close + base * 0.0004,
    low: candles[n - 2].close - base * 0.0002,
    close: candles[n - 2].close + base * 0.0002,
  }

  return candles
}
