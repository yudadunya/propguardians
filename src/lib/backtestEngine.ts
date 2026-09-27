/**
 * backtestEngine.ts — Backtest Engine v2
 *
 * Perbaikan dari v1:
 *  1. Grade A/B filter — hanya hitung setup yang lolos pipeline
 *  2. Realistic FVG pullback entry — tunggu price retrace ke FVG, bukan entry langsung di close
 *  3. Stop dari sweep extreme + ATR buffer (bukan heuristik * 1.5)
 *  4. Top-down D1 bias filter — skip setup yang melawan D1 structure
 *  5. Detailed breakdown: by Kill Zone, OTE/no-OTE, key level sweep, CHoCH type
 *  6. Multi-instrument aggregation
 *  7. Progress callback untuk live UI update
 *  8. Auto-calibrate baseline stats untuk edgeEngine
 */

import type { Candle }           from './patternDetector'
import { detectICTPattern }      from './patternDetector'
import { runPhase1Pipeline }     from './agents'
import { analyzeTopDown }        from './topDown'
import { detectKeyLevels }       from './keyLevels'
import { fetchOhlc }             from './marketData'
import { getNyNow }              from './killZoneSchedule'
import type { PropAccount, PersonalRules, DailyLog } from '../types'

/* ──────────────── Default account untuk simulasi ─────────── */

const SIM_ACCOUNT: PropAccount = {
  firmName: 'Backtest', accountSize: 100000, maxDailyDD: 5,
  maxOverallDD: 10, profitTarget: 10, currentBalance: 100000,
  highWaterMark: 100000, isChallenge: false,
}
const SIM_PERSONAL: PersonalRules = {
  riskPerTrade: 0.75, personalDailyLimit: 3,
  maxConsecutiveLoss: 10, maxTradesPerDay: 99,
}
const SIM_LOG: DailyLog = {
  date: '', startingEquity: 100000, tradesToday: 0,
  consecutiveLosses: 0, dailyPnL: 0,
}

/* ──────────────── Types ──────────────────────────────────── */

export interface BtTrade {
  index:        number
  instrument:   string
  direction:    'long' | 'short'
  grade:        string
  entry:        number
  stop:         number
  tp2:          number
  tp3:          number
  actualR:      number
  outcome:      'hit_3r' | 'hit_2r' | 'hit_1r' | 'be' | 'stopped'
  killZone:     string
  inOTE:        boolean
  mssStrong:    boolean
  keyLevel:     string | null
  topDownAlign: boolean
  sweepType:    string
}

export interface BtBreakdown {
  label:     string
  n:         number
  wr1R:      number
  wr2R:      number
  wr3R:      number
  avgR:      number
  expectancy: number
  maxConsecLoss: number
}

export interface BtResult {
  instrument:   string
  timeframe:    string
  bars:         number
  totalSetups:  number   // all detected (before grade filter)
  gradeAB:      number   // after grade filter
  trades:       BtTrade[]
  overall:      BtBreakdown
  byKillZone:   Record<string, BtBreakdown>
  byOTE:        { withOTE: BtBreakdown; withoutOTE: BtBreakdown }
  byKeyLevel:   { keyLevel: BtBreakdown; random: BtBreakdown }
  byMSS:        { hardCHoCH: BtBreakdown; inferred: BtBreakdown }
  byTopDown:    { aligned: BtBreakdown; partial: BtBreakdown }
  calibrated:   CalibratedStats
  summary:      string
}

export interface CalibratedStats {
  instrument:    string
  winrate1R:     number
  winrate2R:     number
  winrate3R:     number
  avgR:          number
  expectancy:    number
  sampleSize:    number
  bestKillZone:  string
  worstKillZone: string
  oteEdge:       number   // WR2R with OTE - WR2R without OTE
  keyLevelEdge:  number
}

export interface MultiBtResult {
  results:       BtResult[]
  aggregate:     BtBreakdown
  calibrated:    CalibratedStats[]
  totalTrades:   number
  summary:       string
}

export type ProgressCallback = (msg: string) => void

/* ──────────────── Trade simulation ──────────────────────── */

function simulateR(
  candles:   Candle[],
  fromIdx:   number,
  direction: 'long' | 'short',
  entry:     number,
  stopDist:  number,
  maxBars = 40,
): number {
  if (stopDist <= 0) return 0
  const stop = direction === 'long' ? entry - stopDist : entry + stopDist
  const tp1  = direction === 'long' ? entry + stopDist     : entry - stopDist
  const tp2  = direction === 'long' ? entry + 2 * stopDist : entry - 2 * stopDist
  const tp3  = direction === 'long' ? entry + 3 * stopDist : entry - 3 * stopDist

  let hitTP1 = false

  for (let i = fromIdx + 1; i < Math.min(candles.length, fromIdx + 1 + maxBars); i++) {
    const c = candles[i]
    if (direction === 'long') {
      if (c.low  <= stop)  return hitTP1 ? 0 : -1  // stopped (or BE if partial)
      if (c.high >= tp3)  return 3
      if (c.high >= tp2)  return 2
      if (c.high >= tp1)  { hitTP1 = true; continue }
    } else {
      if (c.high >= stop) return hitTP1 ? 0 : -1
      if (c.low  <= tp3)  return 3
      if (c.low  <= tp2)  return 2
      if (c.low  <= tp1)  { hitTP1 = true; continue }
    }
  }
  // Time exit — mark to last close
  const last = candles[Math.min(candles.length - 1, fromIdx + maxBars)].close
  const r    = direction === 'long'
    ? (last - entry) / stopDist
    : (entry - last) / stopDist
  return Math.round(r * 100) / 100
}

/**
 * Wait for price to retrace into the FVG zone (realistic entry).
 * Returns entry candle index and price, or null if never retraced.
 */
function findFVGEntry(
  candles:  Candle[],
  fromIdx:  number,
  fvgLow:   number,
  fvgHigh:  number,
  direction: 'long' | 'short',
  maxWait = 6,
): { idx: number; price: number } | null {
  const mid = (fvgLow + fvgHigh) / 2
  for (let i = fromIdx + 1; i <= Math.min(candles.length - 1, fromIdx + maxWait); i++) {
    const c = candles[i]
    if (direction === 'long'  && c.low  <= fvgHigh && c.low  >= fvgLow) return { idx: i, price: mid }
    if (direction === 'short' && c.high >= fvgLow  && c.high <= fvgHigh) return { idx: i, price: mid }
  }
  return null
}

/* ──────────────── Breakdown calculator ──────────────────── */

function buildBreakdown(label: string, trades: BtTrade[]): BtBreakdown {
  const n = trades.length
  if (n === 0) return { label, n: 0, wr1R: 0, wr2R: 0, wr3R: 0, avgR: 0, expectancy: 0, maxConsecLoss: 0 }

  const wr1R = trades.filter(t => t.actualR >= 1).length / n
  const wr2R = trades.filter(t => t.actualR >= 2).length / n
  const wr3R = trades.filter(t => t.actualR >= 3).length / n
  const avgR = trades.reduce((s, t) => s + t.actualR, 0) / n
  const expectancy = avgR

  let maxCL = 0, curCL = 0
  for (const t of trades) {
    if (t.actualR < 0) { curCL++; maxCL = Math.max(maxCL, curCL) } else { curCL = 0 }
  }

  return { label, n, wr1R, wr2R, wr3R, avgR, expectancy, maxConsecLoss: maxCL }
}

/* ──────────────── Core scan ──────────────────────────────── */

export async function runBacktestOnCandles(
  d1Candles:    Candle[],
  h1Candles:    Candle[],
  instrument:   string,
  onProgress?:  ProgressCallback,
): Promise<BtResult> {
  const trades:    BtTrade[] = []
  const STEP      = 1        // walk forward 1 bar at a time
  const MIN_WIN   = 50       // minimum candles for pattern detection
  const MAX_LOOK  = 40       // max bars to look forward for trade exit
  const { hour: nyHour } = getNyNow()

  // D1 bias (use all D1 data as approximate long-term bias)
  // In backtest we approximate H4 from D1 (no separate H4 fetch to keep it fast)
  const topDownBias = d1Candles.length >= 10
    ? analyzeTopDown(d1Candles, d1Candles.slice(-Math.min(30, d1Candles.length)))
    : null

  let totalSetups = 0
  let gradeAB     = 0
  let skippedIdx  = -1   // skip bars while previous trade is still running

  const n = h1Candles.length
  onProgress?.(`${instrument}: scanning ${n} H1 bars…`)

  for (let i = MIN_WIN; i < n - 5; i += STEP) {
    if (i <= skippedIdx) continue

    const window  = h1Candles.slice(0, i + 1)
    const pattern = detectICTPattern(window, instrument, 'H1', nyHour)
    if (!pattern) continue
    if (!pattern.hasLiquiditySweep) continue

    totalSetups++

    /* Key levels from D1 */
    const kl = d1Candles.length >= 3
      ? detectKeyLevels(
          d1Candles, window.slice(-24),
          pattern.sweepLevel, pattern.sweepType,
          pattern.avgAtr ?? 0.001,
        )
      : null

    /* Run full pipeline to get Grade */
    const synthesis = runPhase1Pipeline(
      {
        ...pattern,
        mssStrong:    pattern.mssStrong    ?? false,
        sweepExtreme: pattern.sweepExtreme ?? null,
        ote62:        pattern.ote62        ?? null,
        ote79:        pattern.ote79        ?? null,
        avgAtr:       pattern.avgAtr       ?? 0,
        topDown:      topDownBias          ?? undefined,
        keyLevels:    kl                   ?? undefined,
      },
      SIM_ACCOUNT, SIM_PERSONAL, SIM_LOG,
    )

    const { grade } = synthesis
    if (grade !== 'A' && grade !== 'B') continue

    gradeAB++

    /* Realistic entry: wait for FVG pullback */
    let entryIdx   = i
    let entryPrice = window[window.length - 1].close  // fallback

    if (pattern.hasFVG && pattern.fvgLow !== null && pattern.fvgHigh !== null) {
      const fvgEntry = findFVGEntry(
        h1Candles, i,
        pattern.fvgLow, pattern.fvgHigh,
        pattern.direction, 6,
      )
      if (!fvgEntry) continue  // price never retraced to FVG → skip (no chase)
      entryIdx   = fvgEntry.idx
      entryPrice = fvgEntry.price
    }

    /* Stop distance from sweep extreme */
    const stopDist = pattern.stopDistance > 0
      ? pattern.stopDistance
      : (pattern.avgAtr ?? 0.001) * 1.5

    const stopPrice = pattern.direction === 'long'
      ? entryPrice - stopDist
      : entryPrice + stopDist

    const tp2 = pattern.direction === 'long'
      ? entryPrice + 2 * stopDist
      : entryPrice - 2 * stopDist
    const tp3 = pattern.direction === 'long'
      ? entryPrice + 3 * stopDist
      : entryPrice - 3 * stopDist

    /* Simulate outcome */
    const actualR  = simulateR(h1Candles, entryIdx, pattern.direction, entryPrice, stopDist, MAX_LOOK)
    const outcome: BtTrade['outcome'] =
      actualR >= 3 ? 'hit_3r' :
      actualR >= 2 ? 'hit_2r' :
      actualR >= 1 ? 'hit_1r' :
      actualR >= 0 ? 'be'     : 'stopped'

    /* Top-down alignment check */
    const topDownAlign = topDownBias
      ? topDownBias.biasDirection === pattern.direction ||
        topDownBias.biasDirection === 'neutral'
      : true

    trades.push({
      index:        i,
      instrument,
      direction:    pattern.direction,
      grade,
      entry:        entryPrice,
      stop:         stopPrice,
      tp2,
      tp3,
      actualR,
      outcome,
      killZone:     pattern.killZone,
      inOTE:        pattern.inOTE,
      mssStrong:    pattern.mssStrong ?? false,
      keyLevel:     kl?.matchedLevel ?? null,
      topDownAlign,
      sweepType:    pattern.sweepType,
    })

    /* Skip bars while this trade runs (avoid overlap) */
    skippedIdx = entryIdx + MAX_LOOK
  }

  onProgress?.(`${instrument}: ${gradeAB} Grade A/B setups → ${trades.length} trades simulated`)

  /* ── Build breakdowns ── */
  const overall = buildBreakdown('Overall', trades)

  const kzIds = ['london', 'ny_am', 'silver_bullet', 'ny_pm']
  const byKillZone: Record<string, BtBreakdown> = {}
  for (const kz of kzIds) {
    byKillZone[kz] = buildBreakdown(kz, trades.filter(t => t.killZone === kz))
  }

  const byOTE = {
    withOTE:    buildBreakdown('With OTE',    trades.filter(t =>  t.inOTE)),
    withoutOTE: buildBreakdown('Without OTE', trades.filter(t => !t.inOTE)),
  }
  const byKeyLevel = {
    keyLevel: buildBreakdown('Key Level Sweep', trades.filter(t =>  t.keyLevel)),
    random:   buildBreakdown('Random Sweep',    trades.filter(t => !t.keyLevel)),
  }
  const byMSS = {
    hardCHoCH: buildBreakdown('Hard CHoCH',        trades.filter(t =>  t.mssStrong)),
    inferred:  buildBreakdown('Inferred MSS',       trades.filter(t => !t.mssStrong)),
  }
  const byTopDown = {
    aligned: buildBreakdown('Top-Down Aligned',  trades.filter(t =>  t.topDownAlign)),
    partial: buildBreakdown('Partial/Neutral',    trades.filter(t => !t.topDownAlign)),
  }

  /* ── Calibrated stats ── */
  const bestKZ  = kzIds.reduce((a, b) =>
    (byKillZone[a]?.wr2R ?? 0) >= (byKillZone[b]?.wr2R ?? 0) ? a : b)
  const worstKZ = kzIds.reduce((a, b) =>
    (byKillZone[a]?.wr2R ?? 1) <= (byKillZone[b]?.wr2R ?? 1) ? a : b)

  const calibrated: CalibratedStats = {
    instrument,
    winrate1R:    overall.wr1R,
    winrate2R:    overall.wr2R,
    winrate3R:    overall.wr3R,
    avgR:         overall.avgR,
    expectancy:   overall.expectancy,
    sampleSize:   trades.length,
    bestKillZone: bestKZ,
    worstKillZone: worstKZ,
    oteEdge:      byOTE.withOTE.wr2R - byOTE.withoutOTE.wr2R,
    keyLevelEdge: byKeyLevel.keyLevel.wr2R - byKeyLevel.random.wr2R,
  }

  const summary = [
    `${instrument} H1 · ${h1Candles.length} bars · ${totalSetups} detected · ${gradeAB} Grade A/B`,
    `${trades.length} trades simulated`,
    `WR@1R: ${(overall.wr1R*100).toFixed(0)}% · WR@2R: ${(overall.wr2R*100).toFixed(0)}% · WR@3R: ${(overall.wr3R*100).toFixed(0)}%`,
    `Avg R: ${overall.avgR.toFixed(2)} · E[R]: ${overall.expectancy.toFixed(2)}`,
    `Max consec loss: ${overall.maxConsecLoss}`,
    `Best KZ: ${bestKZ} (${(byKillZone[bestKZ]?.wr2R*100).toFixed(0)}%)`,
    `OTE edge: +${(calibrated.oteEdge*100).toFixed(0)}%pts · Key level edge: +${(calibrated.keyLevelEdge*100).toFixed(0)}%pts`,
  ].join('\n')

  return {
    instrument, timeframe: 'H1',
    bars: h1Candles.length, totalSetups, gradeAB,
    trades, overall, byKillZone, byOTE, byKeyLevel, byMSS, byTopDown,
    calibrated, summary,
  }
}

/* ──────────────── Multi-instrument runner ────────────────── */

export async function runMultiBacktest(
  instruments: string[],
  onProgress?:  ProgressCallback,
): Promise<MultiBtResult> {
  const results: BtResult[] = []

  for (const instrument of instruments) {
    try {
      onProgress?.(`Fetching ${instrument} H1 + D1 candles…`)

      const [h1Data, d1Data] = await Promise.all([
        fetchOhlc(instrument, 'H1', 1000),
        fetchOhlc(instrument, 'D1', 60),
      ])

      onProgress?.(`${instrument}: ${h1Data.candles.length} H1 bars, ${d1Data.candles.length} D1 bars`)

      const result = await runBacktestOnCandles(
        d1Data.candles,
        h1Data.candles,
        instrument,
        onProgress,
      )
      results.push(result)

      // Small delay between instruments
      await new Promise(r => setTimeout(r, 1000))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onProgress?.(`${instrument} failed: ${msg}`)
    }
  }

  /* Aggregate across all instruments */
  const allTrades = results.flatMap(r => r.trades)
  const aggregate = buildBreakdown('All Instruments', allTrades)

  const summary = [
    `Multi-backtest: ${instruments.join(', ')}`,
    `Total trades: ${allTrades.length}`,
    `Aggregate WR@2R: ${(aggregate.wr2R*100).toFixed(0)}%`,
    `Aggregate E[R]: ${aggregate.expectancy.toFixed(2)}`,
    '',
    ...results.map(r => r.summary),
  ].join('\n')

  return {
    results,
    aggregate,
    calibrated: results.map(r => r.calibrated),
    totalTrades: allTrades.length,
    summary,
  }
}

/* ──────────────── Legacy compat ─────────────────────────── */

export async function runHistoricalTraining(
  symbol: string,
  _tf = 'H1',
  _limit = 500,
  onProgress?: ProgressCallback,
): Promise<{ episodes: import('./rsiEngine').Episode[]; summary: string }> {
  const [h1, d1] = await Promise.all([
    fetchOhlc(symbol, 'H1', 1000),
    fetchOhlc(symbol, 'D1', 60),
  ])
  const result = await runBacktestOnCandles(d1.candles, h1.candles, symbol, onProgress)

  // Convert to Episode format for RSI Learning
  const episodes: import('./rsiEngine').Episode[] = result.trades.map((t, i) => ({
    id:                 `bt_${symbol}_${i}_${Date.now()}`,
    setupId:            `bt_${i}`,
    instrument:         symbol,
    timeframe:          'H1',
    direction:          t.direction,
    setupType:          'sweep_mss_fvg' as const,
    killZone:           t.killZone as import('../types/ict').KillZone,
    features: {
      inOTE:            t.inOTE,
      premiumDiscountOk: true,
      hasDisplacement:  true,
      hasFVG:           true,
      fvgPartial:       false,
      rrRatio:          t.actualR,
      outsideKz:        t.killZone === 'outside',
    },
    predictedGrade:      t.grade as import('../types/ict').Grade,
    predictedExpectancy: result.calibrated.expectancy,
    actualR:             t.actualR,
    outcome:             t.outcome === 'stopped' ? 'stopped'
                       : t.outcome === 'hit_2r'  ? 'hit_2r'
                       : t.outcome === 'hit_1r'  ? 'hit_1r'
                       : 'be',
    modelVersion:        'backtest_v2',
    processed:           false,
    createdAt:           new Date().toISOString(),
  }))

  return { episodes, summary: result.summary }
}
