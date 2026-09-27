/**
 * Phase 2 — Historical Statistical Engine + Edge Agent
 *
 * Baseline stats are seeded from ICT high-probability research patterns
 * (Sweep→MSS→FVG, Silver Bullet, etc.). RSI Phase 4 will update these
 * from real episode outcomes.
 */

import type {
  SetupType,
  KillZone,
  StructureAgentOutput,
  ICTStructureInput,
} from '../types/ict'

export const EDGE_MODEL_VERSION = '2.0.0-baseline'

/** Optional learned weights from RSI (Phase 4) */
export interface EdgeWeights {
  ote: number
  premiumDiscount: number
  displacementFvg: number
  fvgPartialPenalty: number
  highRR: number
  outsideKzPenalty: number
  killZoneNyAm: number
  killZoneSilver: number
  killZoneLondon: number
  instrumentXau: number
  instrumentNas: number
}

const DEFAULT_EDGE_WEIGHTS: EdgeWeights = {
  ote: 1, premiumDiscount: 1, displacementFvg: 1, fvgPartialPenalty: 1,
  highRR: 1, outsideKzPenalty: 1, killZoneNyAm: 1, killZoneSilver: 1,
  killZoneLondon: 1, instrumentXau: 1, instrumentNas: 1,
}


export interface EdgeStatRow {
  setupType: SetupType
  instrument: string | '*' // * = global
  timeframe: string | '*'
  killZone: KillZone | '*'
  sampleSize: number
  winrate1R: number
  winrate2R: number
  winrate3R: number
  avgR: number
  expectancy: number // E[R]
  notes?: string
}

export interface EdgeAgentOutput {
  matched: boolean
  setupType: SetupType
  sampleSize: number
  winrate2R: number
  avgR: number
  expectancy: number
  edgeScore: number // 0-100
  confidence: 'high' | 'medium' | 'low'
  historicalSummary: string
  conditionBoosts: string[]
  modelVersion: string
}

/** Baseline historical edge table (seed — will be replaced by RSI later) */
const BASELINE_STATS: EdgeStatRow[] = [
  // Global Sweep → MSS → FVG
  {
    setupType: 'sweep_mss_fvg',
    instrument: '*',
    timeframe: '*',
    killZone: '*',
    sampleSize: 420,
    winrate1R: 0.72,
    winrate2R: 0.58,
    winrate3R: 0.34,
    avgR: 1.45,
    expectancy: 0.42,
    notes: 'Core ICT model baseline',
  },
  // NY AM
  {
    setupType: 'sweep_mss_fvg',
    instrument: '*',
    timeframe: '*',
    killZone: 'ny_am',
    sampleSize: 180,
    winrate1R: 0.76,
    winrate2R: 0.63,
    winrate3R: 0.38,
    avgR: 1.62,
    expectancy: 0.55,
    notes: 'NY AM boost',
  },
  // Silver Bullet window
  {
    setupType: 'silver_bullet',
    instrument: '*',
    timeframe: '*',
    killZone: 'silver_bullet',
    sampleSize: 95,
    winrate1R: 0.74,
    winrate2R: 0.66,
    winrate3R: 0.41,
    avgR: 1.71,
    expectancy: 0.61,
    notes: 'Silver Bullet 10-11 NY',
  },
  {
    setupType: 'sweep_mss_fvg',
    instrument: '*',
    timeframe: '*',
    killZone: 'silver_bullet',
    sampleSize: 70,
    winrate1R: 0.73,
    winrate2R: 0.64,
    winrate3R: 0.39,
    avgR: 1.68,
    expectancy: 0.58,
  },
  // London
  {
    setupType: 'sweep_mss_fvg',
    instrument: '*',
    timeframe: '*',
    killZone: 'london',
    sampleSize: 150,
    winrate1R: 0.70,
    winrate2R: 0.56,
    winrate3R: 0.32,
    avgR: 1.38,
    expectancy: 0.38,
    notes: 'London / Judas context',
  },
  // Outside KZ — weak
  {
    setupType: 'sweep_mss_fvg',
    instrument: '*',
    timeframe: '*',
    killZone: 'outside',
    sampleSize: 200,
    winrate1R: 0.52,
    winrate2R: 0.35,
    winrate3R: 0.15,
    avgR: 0.55,
    expectancy: -0.12,
    notes: 'Outside kill zone — negative edge',
  },
  // Gold specific
  {
    setupType: 'sweep_mss_fvg',
    instrument: 'XAUUSD',
    timeframe: '*',
    killZone: 'ny_am',
    sampleSize: 85,
    winrate1R: 0.78,
    winrate2R: 0.67,
    winrate3R: 0.42,
    avgR: 1.75,
    expectancy: 0.64,
    notes: 'XAUUSD + NY AM strong',
  },
  {
    setupType: 'silver_bullet',
    instrument: 'XAUUSD',
    timeframe: '*',
    killZone: 'silver_bullet',
    sampleSize: 40,
    winrate1R: 0.75,
    winrate2R: 0.68,
    winrate3R: 0.45,
    avgR: 1.82,
    expectancy: 0.68,
  },
  // NAS100
  {
    setupType: 'sweep_mss_fvg',
    instrument: 'NAS100',
    timeframe: '*',
    killZone: 'ny_am',
    sampleSize: 60,
    winrate1R: 0.74,
    winrate2R: 0.61,
    winrate3R: 0.36,
    avgR: 1.55,
    expectancy: 0.50,
  },
  // Other / incomplete
  {
    setupType: 'other',
    instrument: '*',
    timeframe: '*',
    killZone: '*',
    sampleSize: 300,
    winrate1R: 0.48,
    winrate2R: 0.28,
    winrate3R: 0.10,
    avgR: 0.35,
    expectancy: -0.25,
    notes: 'Incomplete ICT core',
  },
]

function specificityScore(row: EdgeStatRow): number {
  let s = 0
  if (row.instrument !== '*') s += 4
  if (row.timeframe !== '*') s += 2
  if (row.killZone !== '*') s += 3
  return s
}

/** Find best matching historical row (most specific match wins) */
export function lookupEdgeStats(
  setupType: SetupType,
  instrument: string,
  timeframe: string,
  killZone: KillZone
): EdgeStatRow {
  const candidates = BASELINE_STATS.filter((r) => r.setupType === setupType)

  const scored = candidates
    .map((row) => {
      const instOk = row.instrument === '*' || row.instrument === instrument
      const tfOk = row.timeframe === '*' || row.timeframe === timeframe
      const kzOk = row.killZone === '*' || row.killZone === killZone
      if (!instOk || !tfOk || !kzOk) return null
      return { row, spec: specificityScore(row) }
    })
    .filter(Boolean) as { row: EdgeStatRow; spec: number }[]

  if (scored.length === 0) {
    // fallback other
    return (
      BASELINE_STATS.find((r) => r.setupType === 'other') || {
        setupType: 'other',
        instrument: '*',
        timeframe: '*',
        killZone: '*',
        sampleSize: 0,
        winrate1R: 0.5,
        winrate2R: 0.3,
        winrate3R: 0.1,
        avgR: 0.3,
        expectancy: -0.2,
      }
    )
  }

  scored.sort((a, b) => b.spec - a.spec || b.row.sampleSize - a.row.sampleSize)
  return scored[0].row
}

/**
 * Edge Agent — compares live structure to historical edge model
 */
export function runEdgeAgent(
  input: ICTStructureInput,
  structure: StructureAgentOutput,
  setupType: SetupType,
  weights: EdgeWeights = DEFAULT_EDGE_WEIGHTS
): EdgeAgentOutput {
  const row = lookupEdgeStats(
    setupType,
    input.instrument,
    input.timeframe,
    input.killZone
  )

  const conditionBoosts: string[] = []
  let expectancyAdj = row.expectancy
  let winrateAdj = row.winrate2R

  // Confluence boosts scaled by RSI-learned weights
  if (structure.oteBonus) {
    expectancyAdj += 0.08 * weights.ote
    winrateAdj += 0.04 * weights.ote
    conditionBoosts.push(`OTE overlap (+edge, w=${weights.ote.toFixed(2)})`)
  }
  if (structure.premiumDiscountOk) {
    expectancyAdj += 0.05 * weights.premiumDiscount
    winrateAdj += 0.03 * weights.premiumDiscount
    conditionBoosts.push(`Premium/Discount aligned (w=${weights.premiumDiscount.toFixed(2)})`)
  }
  if (structure.displacementValid && structure.fvgValid) {
    expectancyAdj += 0.04 * weights.displacementFvg
    conditionBoosts.push(`Clean displacement + FVG (w=${weights.displacementFvg.toFixed(2)})`)
  }
  if (input.fvgPartiallyFilled) {
    expectancyAdj -= 0.08 * weights.fvgPartialPenalty
    winrateAdj -= 0.05 * weights.fvgPartialPenalty
    conditionBoosts.push(`FVG partially filled (−edge, w=${weights.fvgPartialPenalty.toFixed(2)})`)
  }
  if (input.rrRatio >= 2.5) {
    expectancyAdj += 0.03 * weights.highRR
    conditionBoosts.push(`R:R ≥ 2.5 (w=${weights.highRR.toFixed(2)})`)
  }
  if (!structure.inKillZone) {
    expectancyAdj -= 0.25 * weights.outsideKzPenalty
    winrateAdj -= 0.15 * weights.outsideKzPenalty
    conditionBoosts.push(`Outside Kill Zone (−edge, w=${weights.outsideKzPenalty.toFixed(2)})`)
  }
  // Session / instrument learned boosts
  if (input.killZone === 'ny_am') expectancyAdj += 0.02 * (weights.killZoneNyAm - 1)
  if (input.killZone === 'silver_bullet') expectancyAdj += 0.02 * (weights.killZoneSilver - 1)
  if (input.killZone === 'london') expectancyAdj += 0.02 * (weights.killZoneLondon - 1)
  if (input.instrument === 'XAUUSD') expectancyAdj += 0.03 * (weights.instrumentXau - 1)
  if (input.instrument === 'NAS100') expectancyAdj += 0.03 * (weights.instrumentNas - 1)

  winrateAdj = Math.max(0.05, Math.min(0.95, winrateAdj))
  expectancyAdj = Math.round(expectancyAdj * 100) / 100

  // Edge score 0-100 from expectancy + sample confidence
  let edgeScore = 50 + expectancyAdj * 40
  if (row.sampleSize >= 100) edgeScore += 5
  if (row.sampleSize < 40) edgeScore -= 8
  edgeScore = Math.max(0, Math.min(100, Math.round(edgeScore)))

  const confidence: 'high' | 'medium' | 'low' =
    row.sampleSize >= 100 ? 'high' : row.sampleSize >= 40 ? 'medium' : 'low'

  const historicalSummary = [
    `n=${row.sampleSize}`,
    `WR≥2R ${(winrateAdj * 100).toFixed(0)}%`,
    `avgR ${row.avgR.toFixed(2)}`,
    `E[R] ${expectancyAdj.toFixed(2)}`,
    row.notes || '',
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    matched: true,
    setupType,
    sampleSize: row.sampleSize,
    winrate2R: Math.round(winrateAdj * 1000) / 1000,
    avgR: row.avgR,
    expectancy: expectancyAdj,
    edgeScore,
    confidence,
    historicalSummary,
    conditionBoosts,
    modelVersion: EDGE_MODEL_VERSION,
  }
}

/** Combine structure score + edge score for richer grading */
export function combinedScore(
  structureScore: number,
  edgeScore: number,
  edgeExpectancy: number
): number {
  // 55% structure compliance, 45% historical edge
  let c = structureScore * 0.55 + edgeScore * 0.45
  if (edgeExpectancy < 0) c -= 15
  return Math.max(0, Math.min(100, Math.round(c)))
}
