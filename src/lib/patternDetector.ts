/**
 * patternDetector.ts — ICT Pattern Detector v2 (methodologically accurate)
 *
 * Detection sequence (proper ICT order):
 *  1. ATR(14) — scale-aware threshold for every subsequent step
 *  2. Significant swing highs/lows (left=3, right=3 + ATR significance filter)
 *  3. Dealing range → premium / discount (from last 3 swing extremes)
 *  4. Kill Zone (DST-accurate via Intl.DateTimeFormat in killZoneSchedule)
 *  5. Liquidity Sweep — wick beyond prior swing + close back inside + min 0.3×ATR wick
 *  6. MSS / CHoCH — first close beyond internal CHoCH level after sweep
 *     Fallback: strong displacement body (>0.8×ATR) when no CHoCH yet
 *  7. Displacement — strong impulse candle(s) in sweep direction post-sweep
 *  8. FVG — ONLY within post-sweep displacement zone, direction-aligned, not fully mitigated
 *  9. OTE — 62–79% Fibonacci retracement of impulse leg (sweep extreme → post-MSS swing)
 * 10. Stop distance — sweep extreme ± 0.5×ATR buffer, from FVG/OTE entry estimate
 * 11. R:R — distance to opposing liquidity / stop distance
 */

import { getNyNow } from './killZoneSchedule'

/* ────────────────────────────────────────────────────────── types ── */

export interface Candle {
  time: number // unix seconds
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
  mssStrong: boolean        // true = actual CHoCH close; false = displacement-inferred
  hasFVG: boolean
  fvgPartiallyFilled: boolean
  inPremium: boolean
  inDiscount: boolean
  inOTE: boolean
  ote62: number | null      // explicit fib levels for UI display
  ote79: number | null
  stopDistance: number
  rrRatio: number
  sweepLevel: number | null
  sweepExtreme: number | null  // wick extreme of sweep candle (actual stop reference)
  fvgHigh: number | null
  fvgLow: number | null
  avgAtr: number               // exposed for debugging / UI
  notes: string[]
}

/* ──────────────────────────────────────────────── helpers ── */

interface SwingPoint { i: number; price: number }

/** ATR (simplified TR = high−low; prev close skipped since we use in bar context) */
function calcATR(candles: Candle[], period = 14): number {
  const slice = candles.slice(-Math.min(period, candles.length))
  const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0)
  return sum / slice.length || 1e-6
}

/**
 * Significant swing highs/lows.
 * left=3, right=3 → needs 3 lower/higher neighbours on each side.
 * Significance filter: swing must protrude ≥ 0.3×ATR from adjacent candles.
 */
function findSignificantSwings(
  candles: Candle[],
  left = 3,
  right = 3,
): { highs: SwingPoint[]; lows: SwingPoint[]; avgAtr: number } {
  const avgAtr = calcATR(candles)
  const minDist = avgAtr * 0.30
  const highs: SwingPoint[] = []
  const lows: SwingPoint[] = []

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

    if (isH) {
      const neighbours = [
        ...candles.slice(Math.max(0, i - left), i),
        ...candles.slice(i + 1, i + right + 1),
      ].map(c => c.high)
      const maxNeighbour = neighbours.length ? Math.max(...neighbours) : 0
      if (h - maxNeighbour >= minDist) highs.push({ i, price: h })
    }

    if (isL) {
      const neighbours = [
        ...candles.slice(Math.max(0, i - left), i),
        ...candles.slice(i + 1, i + right + 1),
      ].map(c => c.low)
      const minNeighbour = neighbours.length ? Math.min(...neighbours) : Infinity
      if (minNeighbour - l >= minDist) lows.push({ i, price: l })
    }
  }

  return { highs, lows, avgAtr }
}

/* ─────────────────────────────── 1. Sweep detection ── */

interface SweepResult {
  found: boolean
  type: 'bsl' | 'ssl' | 'none'
  level: number          // the swing level swept
  sweepCandleIdx: number // index into candles[]
  sweepExtreme: number   // actual wick extreme (stop reference)
  direction: 'long' | 'short'
  notes: string[]
}

function detectSweep(
  candles: Candle[],
  highs: SwingPoint[],
  lows: SwingPoint[],
  avgAtr: number,
  lookback = 15,
): SweepResult {
  const n = candles.length
  const recentStart = Math.max(0, n - lookback)

  // "Prior" swings = established BEFORE the recent scan window
  const priorHighs = highs.filter(h => h.i < recentStart)
  const priorLows  = lows.filter(l => l.i < recentStart)

  let best: SweepResult = {
    found: false, type: 'none', level: 0, sweepCandleIdx: -1,
    sweepExtreme: 0, direction: 'long', notes: [],
  }

  // SSL sweep → bullish setup (wick below prior swing low, close back above)
  if (priorLows.length > 0) {
    const lvl = priorLows[priorLows.length - 1].price
    for (let i = recentStart; i < n; i++) {
      const c = candles[i]
      if (c.low < lvl && c.close > lvl) {
        const wickSize = lvl - c.low
        if (wickSize >= avgAtr * 0.30 && i >= best.sweepCandleIdx) {
          best = {
            found: true, type: 'ssl', level: lvl,
            sweepCandleIdx: i, sweepExtreme: c.low,
            direction: 'long',
            notes: [`SSL sweep @ ${lvl.toFixed(5)} — wick ${wickSize.toFixed(5)}`],
          }
        }
      }
    }
  }

  // BSL sweep → bearish setup (wick above prior swing high, close back below)
  if (priorHighs.length > 0) {
    const lvl = priorHighs[priorHighs.length - 1].price
    for (let i = recentStart; i < n; i++) {
      const c = candles[i]
      if (c.high > lvl && c.close < lvl) {
        const wickSize = c.high - lvl
        // Prefer most recent sweep; if same index, prefer tighter wick (more decisive)
        if (wickSize >= avgAtr * 0.30 && i >= best.sweepCandleIdx) {
          best = {
            found: true, type: 'bsl', level: lvl,
            sweepCandleIdx: i, sweepExtreme: c.high,
            direction: 'short',
            notes: [`BSL sweep @ ${lvl.toFixed(5)} — wick ${wickSize.toFixed(5)}`],
          }
        }
      }
    }
  }

  return best
}

/* ─────────────────────────── 2. MSS / CHoCH detection ── */

interface MSSResult {
  found: boolean
  chochLevel: number | null
  isStrong: boolean  // true = explicit close beyond CHoCH; false = displacement-inferred
  note: string
}

function detectMSS(
  candles: Candle[],
  sweep: SweepResult,
  highs: SwingPoint[],
  lows: SwingPoint[],
  avgAtr: number,
): MSSResult {
  const none: MSSResult = { found: false, chochLevel: null, isStrong: false, note: '' }
  if (!sweep.found) return none

  const si  = sweep.sweepCandleIdx
  const dir = sweep.direction
  const postSweep = candles.slice(si + 1)
  if (postSweep.length === 0) return { ...none, note: 'No candles post-sweep' }

  if (dir === 'long') {
    // CHoCH level = last internal swing HIGH within the 20 candles leading into the sweep
    // (the internal high price must close above to confirm bullish order flow change)
    const internalHighs = highs.filter(h => h.i > Math.max(0, si - 20) && h.i <= si)
    const chochLevel = internalHighs.length
      ? internalHighs[internalHighs.length - 1].price
      : candles[si].high  // fallback: sweep candle high

    // Strong MSS — actual close above CHoCH
    if (postSweep.some(c => c.close > chochLevel)) {
      return { found: true, chochLevel, isStrong: true,
               note: `Bullish CHoCH confirmed above ${chochLevel.toFixed(5)}` }
    }
    // Soft MSS — strong displacement body (≥0.8×ATR bullish body)
    if (postSweep.some(c => c.close > c.open && (c.close - c.open) >= avgAtr * 0.80)) {
      return { found: true, chochLevel, isStrong: false,
               note: 'Bullish MSS inferred: strong displacement candle' }
    }
    return { found: false, chochLevel, isStrong: false,
             note: `Awaiting close above CHoCH @ ${chochLevel.toFixed(5)}` }
  } else {
    // Bearish CHoCH — last internal swing LOW before sweep
    const internalLows = lows.filter(l => l.i > Math.max(0, si - 20) && l.i <= si)
    const chochLevel = internalLows.length
      ? internalLows[internalLows.length - 1].price
      : candles[si].low

    if (postSweep.some(c => c.close < chochLevel)) {
      return { found: true, chochLevel, isStrong: true,
               note: `Bearish CHoCH confirmed below ${chochLevel.toFixed(5)}` }
    }
    if (postSweep.some(c => c.close < c.open && (c.open - c.close) >= avgAtr * 0.80)) {
      return { found: true, chochLevel, isStrong: false,
               note: 'Bearish MSS inferred: strong displacement candle' }
    }
    return { found: false, chochLevel, isStrong: false,
             note: `Awaiting close below CHoCH @ ${chochLevel.toFixed(5)}` }
  }
}

/* ─────────────────────────── 3. FVG in displacement zone ── */

interface FVGResult {
  found: boolean
  bullish: boolean
  high: number
  low: number
  mid: number
  partiallyFilled: boolean
  hasDisplacement: boolean
}

function detectFVG(
  candles: Candle[],
  sweepCandleIdx: number,
  direction: 'long' | 'short',
  avgAtr: number,
): FVGResult {
  const empty: FVGResult = {
    found: false, bullish: false, high: 0, low: 0, mid: 0,
    partiallyFilled: false, hasDisplacement: false,
  }
  if (sweepCandleIdx < 0) return empty

  // ONLY scan candles AFTER the sweep (displacement zone) — not the whole chart
  const scanFrom = Math.max(2, sweepCandleIdx + 1)
  const minGap = avgAtr * 0.05  // FVG must be at least 5% of ATR to be meaningful

  // Scan newest→oldest within displacement zone to find most recent valid FVG
  for (let i = candles.length - 1; i >= scanFrom + 1; i--) {
    const c1 = candles[i - 2]
    const c2 = candles[i - 1]
    const c3 = candles[i]

    if (direction === 'long' && c1.high < c3.low) {
      const gapSize = c3.low - c1.high
      if (gapSize < minGap) continue
      // FVG is invalid if price fully returned into it (fully mitigated)
      const fullyMitigated = candles.slice(i + 1).some(c => c.low <= c1.high)
      if (fullyMitigated) continue
      const partiallyFilled = candles.slice(i + 1).some(c => c.low < c3.low && c.low > c1.high)
      const bodyC2 = Math.abs(c2.close - c2.open)
      return {
        found: true, bullish: true,
        high: c3.low, low: c1.high, mid: (c3.low + c1.high) / 2,
        partiallyFilled,
        hasDisplacement: bodyC2 >= avgAtr * 0.60,
      }
    }

    if (direction === 'short' && c1.low > c3.high) {
      const gapSize = c1.low - c3.high
      if (gapSize < minGap) continue
      const fullyMitigated = candles.slice(i + 1).some(c => c.high >= c1.low)
      if (fullyMitigated) continue
      const partiallyFilled = candles.slice(i + 1).some(c => c.high > c3.high && c.high < c1.low)
      const bodyC2 = Math.abs(c2.close - c2.open)
      return {
        found: true, bullish: false,
        high: c1.low, low: c3.high, mid: (c1.low + c3.high) / 2,
        partiallyFilled,
        hasDisplacement: bodyC2 >= avgAtr * 0.60,
      }
    }
  }
  return empty
}

/* ─────────────────────────────── 4. OTE (62–79% fib) ── */

interface OTEResult {
  inOTE: boolean
  ote62: number
  ote79: number
}

function calcOTE(
  candles: Candle[],
  sweep: SweepResult,
  highs: SwingPoint[],
  lows: SwingPoint[],
): OTEResult {
  const none: OTEResult = { inOTE: false, ote62: 0, ote79: 0 }
  if (!sweep.found) return none

  const last = candles[candles.length - 1]
  const si   = sweep.sweepCandleIdx

  if (sweep.direction === 'long') {
    // Impulse leg: sweepExtreme (wick low) → highest swing HIGH after sweep
    const impulseLow  = sweep.sweepExtreme
    const postHighs   = highs.filter(h => h.i > si)
    const impulseHigh = postHighs.length
      ? postHighs[postHighs.length - 1].price
      : Math.max(...candles.slice(si + 1).map(c => c.high))
    if (impulseHigh <= impulseLow) return none
    const leg  = impulseHigh - impulseLow
    // Retracement levels (measured DOWN from impulseHigh)
    const ote62 = impulseHigh - leg * 0.62
    const ote79 = impulseHigh - leg * 0.79
    return { inOTE: last.close >= ote79 && last.close <= ote62, ote62, ote79 }
  } else {
    // Bearish: sweepExtreme (wick high) → lowest swing LOW after sweep
    const impulseHigh = sweep.sweepExtreme
    const postLows    = lows.filter(l => l.i > si)
    const impulseLow  = postLows.length
      ? postLows[postLows.length - 1].price
      : Math.min(...candles.slice(si + 1).map(c => c.low))
    if (impulseLow >= impulseHigh) return none
    const leg  = impulseHigh - impulseLow
    // Retracement levels (measured UP from impulseLow)
    const ote62 = impulseLow + leg * 0.62
    const ote79 = impulseLow + leg * 0.79
    return { inOTE: last.close >= ote62 && last.close <= ote79, ote62, ote79 }
  }
}

/* ─────────────────────── 5. Kill Zone (DST-aware) ── */

function inferKillZone(hourNy: number): DetectedPattern['killZone'] {
  if (hourNy >= 2  && hourNy < 5)  return 'london'
  if (hourNy >= 7  && hourNy < 10) return 'ny_am'
  if (hourNy >= 10 && hourNy < 11) return 'silver_bullet'
  if (hourNy >= 13 && hourNy < 16) return 'ny_pm'
  return 'outside'
}

/* ══════════════════════════ MAIN EXPORT ══════════════════════════ */

/**
 * Scan OHLC series → full ICT structure fields for the multi-agent pipeline.
 * @param nowHourNy  Optional override for NY hour (passed explicitly by multiTf
 *                   so both HTF and LTF use the same moment).
 *                   When omitted, falls back to DST-aware Intl.DateTimeFormat.
 */
export function detectICTPattern(
  candles: Candle[],
  instrument: string,
  timeframe: string,
  nowHourNy?: number,
): DetectedPattern | null {
  if (candles.length < 30) return null

  const notes: string[] = []

  /* ── Swings + ATR ── */
  const { highs, lows, avgAtr } = findSignificantSwings(candles)

  /* ── Kill Zone ── */
  const hourNy   = nowHourNy ?? getNyNow().hour
  const killZone = inferKillZone(hourNy)
  notes.push(`Kill Zone: ${killZone} (${hourNy}:xx NY)`)

  /* ── Dealing Range → Premium / Discount ── */
  const last = candles[candles.length - 1]
  const drHigh = highs.length >= 2 ? Math.max(...highs.slice(-3).map(h => h.price))
                                    : Math.max(...candles.slice(-50).map(c => c.high))
  const drLow  = lows.length >= 2  ? Math.min(...lows.slice(-3).map(l => l.price))
                                    : Math.min(...candles.slice(-50).map(c => c.low))
  const equilibrium  = (drHigh + drLow) / 2
  const rawInPremium = last.close > equilibrium
  const rawInDiscount= last.close < equilibrium

  /* ── Liquidity Sweep ── */
  const sweep = detectSweep(candles, highs, lows, avgAtr, 15)
  notes.push(...sweep.notes)

  if (!sweep.found) {
    notes.push('No liquidity sweep in last 15 candles')
    return {
      instrument, timeframe, direction: 'long', killZone,
      hasLiquiditySweep: false, sweepType: 'none',
      hasDisplacement: false, hasMSS: false, mssStrong: false,
      hasFVG: false, fvgPartiallyFilled: false,
      inPremium: rawInPremium, inDiscount: rawInDiscount, inOTE: false,
      ote62: null, ote79: null,
      stopDistance: Math.round(avgAtr * 2 * 1e5) / 1e5,
      rrRatio: 1.5,
      sweepLevel: null, sweepExtreme: null, fvgHigh: null, fvgLow: null,
      avgAtr: Math.round(avgAtr * 1e5) / 1e5,
      notes,
    }
  }

  const dir = sweep.direction

  /* ── MSS / CHoCH ── */
  const mss = detectMSS(candles, sweep, highs, lows, avgAtr)
  if (mss.note) notes.push(mss.note)

  /* ── FVG (displacement zone only) ── */
  const fvg = detectFVG(candles, sweep.sweepCandleIdx, dir, avgAtr)
  if (fvg.found) {
    const fillLabel = fvg.partiallyFilled ? ' [partial]' : ' [fresh]'
    notes.push(`FVG ${fvg.bullish ? '▲' : '▼'}: ${fvg.low.toFixed(5)}–${fvg.high.toFixed(5)}${fillLabel}`)
  }

  /* ── Displacement ── */
  const hasDisplacement = fvg.hasDisplacement || (() => {
    const post = candles.slice(sweep.sweepCandleIdx + 1, sweep.sweepCandleIdx + 6)
    return post.some(c =>
      dir === 'long'
        ? (c.close > c.open && (c.close - c.open) >= avgAtr * 0.60)
        : (c.close < c.open && (c.open - c.close) >= avgAtr * 0.60)
    )
  })()

  /* ── OTE (62–79% fib) ── */
  const ote = calcOTE(candles, sweep, highs, lows)
  if (ote.inOTE) {
    notes.push(`✓ In OTE zone: ${ote.ote79.toFixed(5)}–${ote.ote62.toFixed(5)}`)
  }

  /* ── Premium / Discount aligned to direction ── */
  const inDiscount = dir === 'long' ? rawInDiscount : false
  const inPremium  = dir === 'short' ? rawInPremium : false

  /* ── Stop Distance (from entry estimate to sweep extreme + buffer) ── */
  // Entry estimate: FVG mid > OTE 62% level > current close (best approximation)
  const entryEstimate =
    fvg.found           ? fvg.mid :
    ote.ote62 > 0       ? (dir === 'long' ? ote.ote62 : ote.ote62) :
                          last.close

  const stopLevel = dir === 'long'
    ? sweep.sweepExtreme - avgAtr * 0.50  // stop below wick low - buffer
    : sweep.sweepExtreme + avgAtr * 0.50  // stop above wick high + buffer

  const stopDistance = Math.max(
    avgAtr * 0.50,
    Math.abs(entryEstimate - stopLevel),
  )

  /* ── R:R (to opposing liquidity) ── */
  const opposingLiquidity = dir === 'long'
    ? (highs.length ? highs[highs.length - 1].price : drHigh)
    : (lows.length  ? lows[lows.length - 1].price   : drLow)

  const targetDist = Math.abs(entryEstimate - opposingLiquidity)
  const rrRatio = Math.round(
    Math.min(5, Math.max(1, targetDist / Math.max(stopDistance, 1e-9))) * 10
  ) / 10

  return {
    instrument, timeframe, direction: dir, killZone,
    hasLiquiditySweep: true,
    sweepType: sweep.type,
    hasDisplacement,
    hasMSS: mss.found,
    mssStrong: mss.isStrong,
    hasFVG: fvg.found,
    fvgPartiallyFilled: fvg.partiallyFilled,
    inPremium,
    inDiscount,
    inOTE: ote.inOTE,
    ote62: ote.ote62 || null,
    ote79: ote.ote79 || null,
    stopDistance: Math.round(stopDistance * 1e5) / 1e5,
    rrRatio,
    sweepLevel: sweep.level,
    sweepExtreme: sweep.sweepExtreme,
    fvgHigh: fvg.found ? fvg.high : null,
    fvgLow:  fvg.found ? fvg.low  : null,
    avgAtr: Math.round(avgAtr * 1e5) / 1e5,
    notes,
  }
}

/* ─────────────────────────── Demo candles (testing) ── */

/**
 * Generate synthetic OHLC with a proper ICT sequence:
 * trending phase → swing high/low formation → SSL/BSL sweep → displacement → FVG → pullback to FVG
 */
export function generateDemoCandles(instrument: string): Candle[] {
  const base =
    instrument === 'XAUUSD' ? 2650 :
    instrument === 'NAS100' ? 21000 : 1.08

  const atrFrac = 0.0012   // ~0.12% per bar ATR
  const candles: Candle[] = []
  let t     = Math.floor(Date.now() / 1000) - 100 * 900
  let price = base

  // Phase 1: downtrend (creates sell-side liquidity / prior lows)
  for (let i = 0; i < 35; i++) {
    const drift = (Math.random() - 0.52) * base * atrFrac
    const o = price
    const c = price + drift
    const h = Math.max(o, c) + Math.random() * base * atrFrac * 0.4
    const l = Math.min(o, c) - Math.random() * base * atrFrac * 0.4
    candles.push({ time: t, open: o, high: h, low: l, close: c })
    price = c
    t += 900
  }

  // Phase 2: consolidation (forms clear swing lows for SSL)
  for (let i = 0; i < 15; i++) {
    const drift = (Math.random() - 0.50) * base * atrFrac * 0.5
    const o = price
    const c = price + drift
    const h = Math.max(o, c) + Math.random() * base * atrFrac * 0.3
    const l = Math.min(o, c) - Math.random() * base * atrFrac * 0.3
    candles.push({ time: t, open: o, high: h, low: l, close: c })
    price = c
    t += 900
  }

  // Phase 3: SSL sweep candle (wick far below prior lows, closes back above)
  const priorLow = Math.min(...candles.slice(-10).map(c => c.low))
  const sweepWick = priorLow - base * atrFrac * 1.5
  const sweepCandle: Candle = {
    time: t,
    open: price,
    high: price + base * atrFrac * 0.3,
    low: sweepWick,
    close: priorLow + base * atrFrac * 0.4,  // close ABOVE the swept level
  }
  candles.push(sweepCandle)
  price = sweepCandle.close
  t += 900

  // Phase 4: displacement up (2 strong bullish candles — creates FVG)
  const disp1Open = price
  const disp1Close = price + base * atrFrac * 2.2
  candles.push({ time: t, open: disp1Open, high: disp1Close + base * atrFrac * 0.2,
                 low: disp1Open - base * atrFrac * 0.1, close: disp1Close })
  price = disp1Close
  t += 900

  // FVG candle (gap between disp1.high and disp2.low)
  const disp2Open = price + base * atrFrac * 0.5  // gap up → creates bullish FVG
  const disp2Close = disp2Open + base * atrFrac * 1.8
  candles.push({ time: t, open: disp2Open, high: disp2Close + base * atrFrac * 0.2,
                 low: disp2Open - base * atrFrac * 0.05, close: disp2Close })
  price = disp2Close
  t += 900

  // Phase 5: CHoCH — close above the internal high (MSS confirmation)
  const internalHigh = Math.max(...candles.slice(-8, -3).map(c => c.high))
  const chochCandle: Candle = {
    time: t,
    open: price,
    high: internalHigh + base * atrFrac * 0.8,
    low: price - base * atrFrac * 0.1,
    close: internalHigh + base * atrFrac * 0.5,  // close ABOVE internal high
  }
  candles.push(chochCandle)
  price = chochCandle.close
  t += 900

  // Phase 6: pullback into FVG zone (current price in OTE)
  const fvgHigh = disp2Open
  const fvgLow  = disp1Close
  const fvgMid  = (fvgHigh + fvgLow) / 2
  for (let i = 0; i < 4; i++) {
    const targetClose = fvgMid + base * atrFrac * (0.3 - i * 0.1)
    const o = price
    const c = price + (targetClose - price) * 0.5
    const h = Math.max(o, c) + Math.random() * base * atrFrac * 0.2
    const l = Math.min(o, c) - Math.random() * base * atrFrac * 0.3
    candles.push({ time: t, open: o, high: h, low: l, close: c })
    price = c
    t += 900
  }

  return candles
}
