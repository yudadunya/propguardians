/**
 * Phase 4 — Recursive Self-Improvement Engine
 *
 * Learns ONLY from price-setup outcomes (not user psychology).
 * ICT Core rules stay fixed; weights & conditional edge adjust.
 */

export const RSI_VERSION = '4.0.0'

export interface FeatureWeights {
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

export const DEFAULT_WEIGHTS: FeatureWeights = {
  ote: 1.0,
  premiumDiscount: 1.0,
  displacementFvg: 1.0,
  fvgPartialPenalty: 1.0,
  highRR: 1.0,
  outsideKzPenalty: 1.0,
  killZoneNyAm: 1.0,
  killZoneSilver: 1.0,
  killZoneLondon: 1.0,
  instrumentXau: 1.0,
  instrumentNas: 1.0,
}

export interface Episode {
  id: string
  setupId: string
  instrument: string
  timeframe: string
  direction: string
  setupType: string
  killZone: string
  features: {
    inOTE: boolean
    premiumDiscountOk: boolean
    hasDisplacement: boolean
    hasFVG: boolean
    fvgPartial: boolean
    rrRatio: number
    outsideKz: boolean
  }
  predictedGrade: string
  predictedExpectancy: number
  actualR: number
  outcome: 'hit_1r' | 'hit_2r' | 'hit_3r' | 'stopped' | 'be'
  modelVersion: string
  processed: boolean
  createdAt: string
}

export interface ModelVersion {
  version: string
  parentVersion: string | null
  weights: FeatureWeights
  episodeCount: number
  avgActualR: number
  winrate2R: number
  createdAt: string
  notes: string
}

export interface RSIResult {
  processed: number
  newVersion: string
  weightChanges: { feature: string; from: number; to: number }[]
  summary: string
  weights: FeatureWeights
}

function clampWeight(w: number): number {
  return Math.max(0.4, Math.min(2.5, Math.round(w * 100) / 100))
}

/**
 * Update weights from unprocessed episodes.
 * Positive actualR → reinforce features that were present.
 * Negative actualR → penalize features that were present.
 */
export function runRSIUpdate(
  episodes: Episode[],
  currentWeights: FeatureWeights,
  currentVersion: string
): RSIResult {
  const pending = episodes.filter((e) => !e.processed)
  if (pending.length < 3) {
    return {
      processed: 0,
      newVersion: currentVersion,
      weightChanges: [],
      summary: `Butuh minimal 3 episode belum diproses (ada ${pending.length}).`,
      weights: currentWeights,
    }
  }

  const next = { ...currentWeights }
  const deltas: Record<keyof FeatureWeights, number> = {
    ote: 0,
    premiumDiscount: 0,
    displacementFvg: 0,
    fvgPartialPenalty: 0,
    highRR: 0,
    outsideKzPenalty: 0,
    killZoneNyAm: 0,
    killZoneSilver: 0,
    killZoneLondon: 0,
    instrumentXau: 0,
    instrumentNas: 0,
  }

  for (const ep of pending) {
    // signal: positive R strengthens features present; negative weakens them
    const signal = ep.actualR >= 2 ? 0.08 : ep.actualR >= 1 ? 0.04 : ep.actualR > 0 ? 0.01 : ep.actualR === 0 ? 0 : -0.06

    if (ep.features.inOTE) deltas.ote += signal
    if (ep.features.premiumDiscountOk) deltas.premiumDiscount += signal
    if (ep.features.hasDisplacement && ep.features.hasFVG) deltas.displacementFvg += signal
    if (ep.features.fvgPartial) deltas.fvgPartialPenalty += signal < 0 ? 0.05 : -0.03 // partial is bad → increase penalty weight when losses
    if (ep.features.rrRatio >= 2.5) deltas.highRR += signal
    if (ep.features.outsideKz) deltas.outsideKzPenalty += signal < 0 ? 0.08 : -0.02

    if (ep.killZone === 'ny_am') deltas.killZoneNyAm += signal
    if (ep.killZone === 'silver_bullet') deltas.killZoneSilver += signal
    if (ep.killZone === 'london') deltas.killZoneLondon += signal
    if (ep.instrument === 'XAUUSD') deltas.instrumentXau += signal
    if (ep.instrument === 'NAS100') deltas.instrumentNas += signal
  }

  // average deltas by count for stability
  const n = pending.length
  const changes: RSIResult['weightChanges'] = []
  ;(Object.keys(deltas) as (keyof FeatureWeights)[]).forEach((key) => {
    const adj = deltas[key] / Math.max(1, n * 0.5)
    if (Math.abs(adj) < 0.005) return
    const from = next[key]
    next[key] = clampWeight(from + adj)
    if (next[key] !== from) {
      changes.push({ feature: key, from, to: next[key] })
    }
  })

  const verNum = parseFloat(currentVersion.replace(/[^\d.]/g, '')) || 4.0
  const newVersion = `4.${Math.floor(verNum * 10 + 1) / 10}`.replace(/\.(\d)$/, '.$10') // simple bump
  // cleaner version bump
  const parts = currentVersion.split('.')
  let patch = parseInt(parts[2] || '0', 10) + 1
  const bumped = `${parts[0] || '4'}.${parts[1] || '0'}.${patch}`

  const wins2 = pending.filter((e) => e.actualR >= 2).length
  const avgR = pending.reduce((s, e) => s + e.actualR, 0) / n

  return {
    processed: pending.length,
    newVersion: bumped,
    weightChanges: changes,
    summary:
      changes.length === 0
        ? `Diproses ${n} episode — bobot stabil (belum ada perubahan signifikan).`
        : `Diproses ${n} episode → model ${bumped}. ${changes.length} bobot disesuaikan. Avg R episode: ${avgR.toFixed(2)}, WR≥2R: ${((wins2 / n) * 100).toFixed(0)}%.`,
    weights: next,
  }
}

export function createEpisodeFromSetup(
  setup: {
    id: string
    instrument: string
    timeframe: string
    direction: string
    setupType: string
    killZone: string
    grade: string
    expectancy: number
    synthesis: {
      structure: {
        oteBonus: boolean
        premiumDiscountOk: boolean
        displacementValid: boolean
        fvgValid: boolean
      }
      edge: { modelVersion?: string }
    }
  },
  inputFeatures: {
    fvgPartial: boolean
    rrRatio: number
    outsideKz: boolean
  },
  actualR: number,
  modelVersion: string
): Episode {
  let outcome: Episode['outcome'] = 'stopped'
  if (actualR >= 3) outcome = 'hit_3r'
  else if (actualR >= 2) outcome = 'hit_2r'
  else if (actualR >= 1) outcome = 'hit_1r'
  else if (actualR === 0) outcome = 'be'
  else outcome = 'stopped'

  return {
    id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    setupId: setup.id,
    instrument: setup.instrument,
    timeframe: setup.timeframe,
    direction: setup.direction,
    setupType: setup.setupType,
    killZone: setup.killZone,
    features: {
      inOTE: setup.synthesis.structure.oteBonus,
      premiumDiscountOk: setup.synthesis.structure.premiumDiscountOk,
      hasDisplacement: setup.synthesis.structure.displacementValid,
      hasFVG: setup.synthesis.structure.fvgValid,
      fvgPartial: inputFeatures.fvgPartial,
      rrRatio: inputFeatures.rrRatio,
      outsideKz: inputFeatures.outsideKz,
    },
    predictedGrade: setup.grade,
    predictedExpectancy: setup.expectancy,
    actualR,
    outcome,
    modelVersion,
    processed: false,
    createdAt: new Date().toISOString(),
  }
}
