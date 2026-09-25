/**
 * Phase 9 — Historical Backtest Training
 * Walk OHLC → detect ICT setups → simulate R → feed RSI / edge learning
 */

import type { Candle } from './patternDetector'
import { detectICTPattern } from './patternDetector'
import type { FeatureWeights } from './rsiEngine'
import { DEFAULT_WEIGHTS, runRSIUpdate, type Episode } from './rsiEngine'
import { fetchOhlc } from './marketData'

export interface BacktestTrade {
  index: number
  direction: 'long' | 'short'
  entry: number
  stop: number
  tp2: number
  actualR: number
  outcome: string
  killZone: string
  features: Episode['features']
}

export interface BacktestResult {
  symbol: string
  timeframe: string
  bars: number
  trades: BacktestTrade[]
  winrate2R: number
  avgR: number
  expectancy: number
  episodes: Episode[]
  summary: string
}

function simulateR(
  candles: Candle[],
  fromIdx: number,
  direction: 'long' | 'short',
  entry: number,
  stopDist: number
): number {
  const stop =
    direction === 'long' ? entry - stopDist : entry + stopDist
  const risk = Math.abs(entry - stop) || 1
  const tp2 = direction === 'long' ? entry + 2 * risk : entry - 2 * risk

  for (let i = fromIdx + 1; i < candles.length; i++) {
    const c = candles[i]
    if (direction === 'long') {
      if (c.low <= stop) return -1
      if (c.high >= tp2) return 2
    } else {
      if (c.high >= stop) return -1
      if (c.low <= tp2) return 2
    }
  }
  // time exit: mark to last close
  const last = candles[candles.length - 1].close
  const r = direction === 'long' ? (last - entry) / risk : (entry - last) / risk
  return Math.round(r * 100) / 100
}

/**
 * Run backtest on candle series (step every N bars to avoid overlap spam)
 */
export function runBacktestOnCandles(
  candles: Candle[],
  symbol: string,
  timeframe: string,
  step = 8
): BacktestResult {
  const trades: BacktestTrade[] = []
  const episodes: Episode[] = []

  for (let i = 40; i < candles.length - 5; i += step) {
    const window = candles.slice(0, i + 1)
    const pattern = detectICTPattern(window, symbol, timeframe)
    if (!pattern) continue
    if (!pattern.hasLiquiditySweep || !pattern.hasFVG) continue
    if (pattern.killZone === 'outside') continue

    const entry = window[window.length - 1].close
    const stopDist = Math.max(pattern.stopDistance, (window[window.length - 1].high - window[window.length - 1].low) * 1.5)
    const actualR = simulateR(candles, i, pattern.direction, entry, stopDist)

    const features: Episode['features'] = {
      inOTE: pattern.inOTE,
      premiumDiscountOk:
        (pattern.direction === 'long' && pattern.inDiscount) ||
        (pattern.direction === 'short' && pattern.inPremium),
      hasDisplacement: pattern.hasDisplacement,
      hasFVG: pattern.hasFVG,
      fvgPartial: pattern.fvgPartiallyFilled,
      rrRatio: pattern.rrRatio,
      outsideKz: false,
    }

    trades.push({
      index: i,
      direction: pattern.direction,
      entry,
      stop: pattern.direction === 'long' ? entry - stopDist : entry + stopDist,
      tp2: pattern.direction === 'long' ? entry + 2 * stopDist : entry - 2 * stopDist,
      actualR,
      outcome: actualR >= 2 ? 'hit_2r' : actualR >= 1 ? 'hit_1r' : actualR >= 0 ? 'be' : 'stopped',
      killZone: pattern.killZone,
      features,
    })

    episodes.push({
      id: `bt_${symbol}_${i}_${Date.now()}`,
      setupId: `bt_setup_${i}`,
      instrument: symbol,
      timeframe,
      direction: pattern.direction,
      setupType: 'sweep_mss_fvg',
      killZone: pattern.killZone,
      features,
      predictedGrade: 'B',
      predictedExpectancy: 0.4,
      actualR,
      outcome:
        actualR >= 2
          ? 'hit_2r'
          : actualR >= 1
            ? 'hit_1r'
            : actualR === 0
              ? 'be'
              : 'stopped',
      modelVersion: 'backtest',
      processed: false,
      createdAt: new Date().toISOString(),
    })
  }

  const n = trades.length || 1
  const wins2 = trades.filter((t) => t.actualR >= 2).length
  const avgR = trades.reduce((s, t) => s + t.actualR, 0) / n
  const expectancy = avgR

  return {
    symbol,
    timeframe,
    bars: candles.length,
    trades,
    winrate2R: wins2 / n,
    avgR,
    expectancy,
    episodes,
    summary: `Backtest ${symbol} ${timeframe}: ${trades.length} setups, WR≥2R ${((wins2 / n) * 100).toFixed(0)}%, avgR ${avgR.toFixed(2)}, E[R] ${expectancy.toFixed(2)}`,
  }
}

/** Fetch live history from biquote then backtest */
export async function runHistoricalTraining(
  symbol: string,
  timeframe = 'M15',
  limit = 500
): Promise<BacktestResult> {
  const { candles } = await fetchOhlc(symbol, timeframe, Math.min(limit, 1000))
  return runBacktestOnCandles(candles, symbol, timeframe, 6)
}

export function applyBacktestToWeights(
  episodes: Episode[],
  currentWeights: FeatureWeights
): { weights: FeatureWeights; summary: string } {
  const result = runRSIUpdate(episodes, currentWeights, '9.0.0')
  return {
    weights: result.weights,
    summary: result.summary,
  }
}

export { DEFAULT_WEIGHTS }
