/**
 * ictCore.ts — ICT Core Rules (Structure Agent)
 * v1.1: Uses mssStrong bonus; tightened Grade A thresholds.
 */

import type {
  KillZone,
  ICTStructureInput,
  StructureAgentOutput,
  SetupType,
  Grade,
} from '../types/ict'

export const ICT_CORE_VERSION = '1.1.0'

export const KILL_ZONES: { id: KillZone; label: string; highProbability: boolean }[] = [
  { id: 'london',        label: 'London (02:00–05:00 NY)',       highProbability: true },
  { id: 'ny_am',         label: 'New York AM (07:00–10:00 NY)',  highProbability: true },
  { id: 'silver_bullet', label: 'Silver Bullet (10:00–11:00 NY)', highProbability: true },
  { id: 'ny_pm',         label: 'New York PM (13:30–16:00 NY)',  highProbability: false },
  { id: 'outside',       label: 'Outside Kill Zone',             highProbability: false },
]

/**
 * Structure Agent — pure ICT Core checklist.
 * Scores 0–100. Devil/Edge further adjusts in agents.ts.
 */
export function runStructureAgent(input: ICTStructureInput): StructureAgentOutput {
  const present: string[] = []
  const missing: string[] = []
  let score = 0

  /* ── Kill Zone ── */
  const inKillZone = input.killZone !== 'outside'
  if (inKillZone) {
    score += 20
    present.push(`Kill Zone: ${input.killZone}`)
    if (input.killZone === 'silver_bullet') { score += 8; present.push('Silver Bullet window (+8)') }
    else if (input.killZone === 'ny_am')    { score += 5; present.push('NY AM session (+5)') }
    else if (input.killZone === 'london')   { score += 3; present.push('London session (+3)') }
  } else {
    missing.push('Outside Kill Zone — low probability window')
    score -= 25
  }

  /* ── Liquidity Sweep ── */
  const sweepValid = input.hasLiquiditySweep && input.sweepType !== 'none'
  if (sweepValid) {
    score += 20
    present.push(`Liquidity Sweep (${input.sweepType.toUpperCase()})`)
  } else {
    missing.push('No valid Liquidity Sweep — thesis incomplete')
    score -= 20
  }

  /* ── Displacement ── */
  if (input.hasDisplacement) {
    score += 12
    present.push('Displacement present')
  } else {
    missing.push('No Displacement candle')
    score -= 8
  }

  /* ── MSS / CHoCH ── */
  const mssStrong = input.mssStrong ?? false
  if (input.hasMSS) {
    if (mssStrong) {
      score += 18  // Hard CHoCH (close beyond level) = full points
      present.push('MSS — hard CHoCH confirmed (+18)')
    } else {
      score += 10  // Inferred from displacement only = partial
      present.push('MSS inferred (displacement) — await hard CHoCH (+10)')
      missing.push('CHoCH not yet confirmed by close — weaker entry signal')
    }
  } else {
    missing.push('No MSS / CHoCH — do not enter')
    score -= 18
  }

  /* ── FVG ── */
  if (input.hasFVG) {
    score += 15
    present.push('Fair Value Gap (post-sweep displacement zone)')
    if (input.fvgPartiallyFilled) {
      score -= 5
      missing.push('FVG partially filled — reduced probability')
    }
  } else {
    missing.push('No FVG — use OB or wait for FVG formation')
    score -= 12
  }

  /* ── Premium / Discount aligned with direction ── */
  let premiumDiscountOk = false
  if (input.direction === 'long' && input.inDiscount) {
    premiumDiscountOk = true; score += 8
    present.push('Long in Discount zone')
  } else if (input.direction === 'short' && input.inPremium) {
    premiumDiscountOk = true; score += 8
    present.push('Short in Premium zone')
  } else {
    missing.push('Premium/Discount not aligned with direction')
    score -= 5
  }

  /* ── OTE (62–79% fib) ── */
  const oteBonus = input.inOTE
  if (oteBonus) {
    score += 12
    const lvlStr = input.ote62 && input.ote79
      ? ` (${input.ote79.toFixed(5)}–${input.ote62.toFixed(5)})`
      : ''
    present.push(`OTE 62–79% Fibonacci${lvlStr}`)
  } else {
    missing.push('Price not in OTE zone (62–79% fib) — consider waiting')
  }

  /* ── R:R ── */
  if (input.rrRatio >= 2) {
    score += 5
    present.push(`R:R ${input.rrRatio.toFixed(1)}:1 ✓`)
  } else {
    missing.push(`R:R ${input.rrRatio.toFixed(1)} < 2 — minimum violated`)
    score -= 12
  }

  score = Math.max(0, Math.min(100, score))

  const summary = buildSummary({
    inKillZone,
    sweepValid,
    mssValid: input.hasMSS,
    mssStrong,
    fvgValid: input.hasFVG,
    displacementValid: input.hasDisplacement,
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
    mssValid: input.hasMSS,
    mssStrong,
    displacementValid: input.hasDisplacement,
    fvgValid: input.hasFVG,
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
  mssStrong: boolean
  fvgValid: boolean
  displacementValid: boolean
  premiumDiscountOk: boolean
  oteBonus: boolean
  direction: string
  killZone: KillZone
}): string {
  const parts: string[] = []
  if (p.sweepValid)         parts.push('Sweep')
  if (p.mssValid)           parts.push(p.mssStrong ? 'CHoCH✓' : 'MSS~')
  if (p.displacementValid)  parts.push('Disp')
  if (p.fvgValid)           parts.push('FVG')
  if (p.oteBonus)           parts.push('OTE')
  if (p.premiumDiscountOk)  parts.push(p.direction === 'long' ? 'Discount' : 'Premium')

  const core = parts.length ? parts.join('+') : 'Incomplete'
  return `${p.direction.toUpperCase()} | ${core} | ${p.killZone}`
}

export function inferSetupType(
  structure: StructureAgentOutput,
  killZone: KillZone,
): SetupType {
  if (killZone === 'silver_bullet' && structure.fvgValid) return 'silver_bullet'
  if (structure.sweepValid && structure.mssValid && structure.fvgValid) return 'sweep_mss_fvg'
  return 'other'
}

export function gradeFromStructure(
  structure: StructureAgentOutput,
  riskApproved: boolean,
  rrRatio: number,
): Grade {
  if (!riskApproved) return 'D'
  if (!structure.inKillZone) return 'D'
  if (!structure.sweepValid || !structure.mssValid) return 'D'
  if (!structure.fvgValid && !structure.displacementValid) return 'D'

  const s = structure.structureScore
  // Grade A requires hard CHoCH, not just inferred MSS
  if (s >= 82 && structure.oteBonus && rrRatio >= 2 && structure.mssStrong) return 'A'
  if (s >= 65 && structure.fvgValid) return 'B'
  if (s >= 45) return 'C'
  return 'D'
}
