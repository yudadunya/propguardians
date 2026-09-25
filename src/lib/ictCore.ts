/**
 * ICT Core Rules — strict, versioned, NOT modified by RSI.
 * RSI only adjusts weights/conditions around these rules.
 */

import type {
  KillZone,
  ICTStructureInput,
  StructureAgentOutput,
  SetupType,
  Grade,
} from '../types/ict'

export const ICT_CORE_VERSION = '1.0.0'

/** Kill Zone windows (conceptual — UI selects zone; live engine will use clock later) */
export const KILL_ZONES: { id: KillZone; label: string; highProbability: boolean }[] = [
  { id: 'london', label: 'London (02:00–05:00 NY)', highProbability: true },
  { id: 'ny_am', label: 'New York AM (07:00–10:00 NY)', highProbability: true },
  { id: 'silver_bullet', label: 'Silver Bullet (10:00–11:00 NY)', highProbability: true },
  { id: 'ny_pm', label: 'New York PM (13:30–16:00 NY)', highProbability: false },
  { id: 'outside', label: 'Outside Kill Zone', highProbability: false },
]

/**
 * Structure Agent — pure ICT Core checklist.
 * No soft opinions. Only rule compliance.
 */
export function runStructureAgent(input: ICTStructureInput): StructureAgentOutput {
  const present: string[] = []
  const missing: string[] = []
  let score = 0

  const inKillZone = input.killZone !== 'outside'
  if (inKillZone) {
    score += 20
    present.push(`Kill Zone: ${input.killZone}`)
    if (input.killZone === 'silver_bullet' || input.killZone === 'ny_am') {
      score += 5
      present.push('High-probability session window')
    }
  } else {
    missing.push('Outside Kill Zone')
    score -= 25
  }

  const sweepValid = input.hasLiquiditySweep && input.sweepType !== 'none'
  if (sweepValid) {
    score += 20
    present.push(`Liquidity Sweep (${input.sweepType.toUpperCase()})`)
  } else {
    missing.push('No valid Liquidity Sweep')
    score -= 20
  }

  const displacementValid = input.hasDisplacement
  if (displacementValid) {
    score += 15
    present.push('Displacement present')
  } else {
    missing.push('No Displacement')
    score -= 10
  }

  const mssValid = input.hasMSS
  if (mssValid) {
    score += 15
    present.push('Market Structure Shift (MSS/CHoCH)')
  } else {
    missing.push('No MSS / CHoCH')
    score -= 15
  }

  const fvgValid = input.hasFVG
  if (fvgValid) {
    score += 15
    present.push('Fair Value Gap')
    if (input.fvgPartiallyFilled) {
      score -= 5
      missing.push('FVG partially filled (weaker)')
    }
  } else {
    missing.push('No Fair Value Gap')
    score -= 15
  }

  // Premium/Discount alignment with direction
  let premiumDiscountOk = false
  if (input.direction === 'long' && input.inDiscount) {
    premiumDiscountOk = true
    score += 8
    present.push('Long in Discount')
  } else if (input.direction === 'short' && input.inPremium) {
    premiumDiscountOk = true
    score += 8
    present.push('Short in Premium')
  } else if (input.inPremium || input.inDiscount) {
    missing.push('Direction vs Premium/Discount mismatch')
    score -= 5
  } else {
    missing.push('Premium/Discount not identified')
  }

  const oteBonus = input.inOTE
  if (oteBonus) {
    score += 10
    present.push('Inside OTE (0.62–0.79)')
  }

  // R:R minimum
  if (input.rrRatio >= 2) {
    score += 5
    present.push(`R:R ${input.rrRatio.toFixed(1)}`)
  } else {
    missing.push(`R:R too low (${input.rrRatio.toFixed(1)} < 2)`)
    score -= 10
  }

  score = Math.max(0, Math.min(100, score))

  const summary = buildSummary({
    inKillZone,
    sweepValid,
    mssValid,
    fvgValid,
    displacementValid,
    premiumDiscountOk,
    oteBonus,
    direction: input.direction,
    killZone: input.killZone,
  })

  return {
    inKillZone,
    killZone: input.killZone,
    sweepValid,
    sweepType: input.sweepType,
    mssValid,
    displacementValid,
    fvgValid,
    premiumDiscountOk,
    oteBonus,
    structureScore: score,
    missing,
    present,
    summary,
  }
}

function buildSummary(p: {
  inKillZone: boolean
  sweepValid: boolean
  mssValid: boolean
  fvgValid: boolean
  displacementValid: boolean
  premiumDiscountOk: boolean
  oteBonus: boolean
  direction: string
  killZone: KillZone
}): string {
  const parts: string[] = []
  if (p.sweepValid) parts.push('Sweep')
  if (p.mssValid) parts.push('MSS')
  if (p.displacementValid) parts.push('Displacement')
  if (p.fvgValid) parts.push('FVG')
  if (p.oteBonus) parts.push('OTE')
  if (p.premiumDiscountOk) parts.push(p.direction === 'long' ? 'Discount' : 'Premium')

  const core = parts.length ? parts.join(' + ') : 'Incomplete structure'
  const kz = p.inKillZone ? p.killZone : 'outside KZ'
  return `${p.direction.toUpperCase()} | ${core} | ${kz}`
}

/** Infer setup type from structure */
export function inferSetupType(
  structure: StructureAgentOutput,
  killZone: KillZone
): SetupType {
  if (killZone === 'silver_bullet' && structure.fvgValid) return 'silver_bullet'
  if (structure.sweepValid && structure.mssValid && structure.fvgValid) return 'sweep_mss_fvg'
  return 'other'
}

/** Grade from structure + risk approval (Phase 1 — no Edge Agent yet) */
export function gradeFromStructure(
  structure: StructureAgentOutput,
  riskApproved: boolean,
  rrRatio: number
): Grade {
  if (!riskApproved) return 'D'
  if (!structure.inKillZone) return 'D'
  if (!structure.sweepValid || !structure.mssValid) return 'D'
  if (!structure.fvgValid && !structure.displacementValid) return 'D'

  const s = structure.structureScore
  if (s >= 80 && structure.oteBonus && rrRatio >= 2) return 'A'
  if (s >= 65 && structure.fvgValid) return 'B'
  if (s >= 45) return 'C'
  return 'D'
}
