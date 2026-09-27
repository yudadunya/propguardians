/**
 * ictCore.ts — ICT Structure Agent v1.2
 * 
 * Tambahan dari v1.1:
 *  - Top-down D1+H4 alignment score (+15 strong, +7 partial, -20 conflicting)
 *  - Key level sweep bonus (PDH/PDL/PWH/PWL → +12–20 pts)
 *  - News window downgrade (langsung ke devil agent, tapi noted di structure)
 *  - mssStrong bonus tetap (+18 vs +10)
 */

import type {
  KillZone,
  ICTStructureInput,
  StructureAgentOutput,
  SetupType,
  Grade,
} from '../types/ict'

export const ICT_CORE_VERSION = '1.2.0'

export const KILL_ZONES: { id: KillZone; label: string; highProbability: boolean }[] = [
  { id: 'london',        label: 'London (02:00–05:00 NY)',        highProbability: true  },
  { id: 'ny_am',         label: 'New York AM (07:00–10:00 NY)',   highProbability: true  },
  { id: 'silver_bullet', label: 'Silver Bullet (10:00–11:00 NY)', highProbability: true  },
  { id: 'ny_pm',         label: 'New York PM (13:30–16:00 NY)',   highProbability: false },
  { id: 'outside',       label: 'Outside Kill Zone',              highProbability: false },
]

export function runStructureAgent(input: ICTStructureInput): StructureAgentOutput {
  const present: string[] = []
  const missing: string[] = []
  let score = 0

  /* ── Kill Zone ── */
  const inKillZone = input.killZone !== 'outside'
  if (inKillZone) {
    score += 20
    present.push(`Kill Zone: ${input.killZone}`)
    if (input.killZone === 'silver_bullet') { score += 8;  present.push('Silver Bullet (+8)') }
    else if (input.killZone === 'ny_am')    { score += 5;  present.push('NY AM (+5)') }
    else if (input.killZone === 'london')   { score += 3;  present.push('London (+3)') }
  } else {
    missing.push('Outside Kill Zone — probabilitas rendah')
    score -= 20
  }

  /* ── Sweep ── */
  const sweepValid = input.hasLiquiditySweep && input.sweepType !== 'none'
  if (sweepValid) {
    score += 20
    present.push(`Liquidity Sweep (${input.sweepType.toUpperCase()})`)
  } else {
    missing.push('Tidak ada Liquidity Sweep valid')
    score -= 20
  }

  /* ── Key Level Sweep ── */
  const keyLevelSweep = (input.keyLevels?.matchedBonus ?? 0) > 0
  if (sweepValid && input.keyLevels?.matchedLevel) {
    score += input.keyLevels.matchedBonus
    present.push(`Sweep di ${input.keyLevels.matchedLevel} (+${input.keyLevels.matchedBonus}) — institutional level 🎯`)
  } else if (sweepValid) {
    missing.push('Sweep bukan di PDH/PDL/PWH/PWL — kurang institutional')
    score -= 5
  }

  /* ── Displacement ── */
  if (input.hasDisplacement) {
    score += 12
    present.push('Displacement candle')
  } else {
    missing.push('Tidak ada Displacement')
    score -= 8
  }

  /* ── MSS / CHoCH ── */
  const mssStrong = input.mssStrong ?? false
  if (input.hasMSS) {
    if (mssStrong) {
      score += 18
      present.push('MSS — hard CHoCH confirmed (+18)')
    } else {
      score += 10
      present.push('MSS inferred dari displacement (+10)')
      missing.push('CHoCH belum hard-confirmed (close beyond level)')
    }
  } else {
    missing.push('Tidak ada MSS/CHoCH — do not enter')
    score -= 18
  }

  /* ── FVG ── */
  if (input.hasFVG) {
    score += 15
    present.push('Fair Value Gap (displacement zone)')
    if (input.fvgPartiallyFilled) {
      score -= 5
      missing.push('FVG sebagian terisi — probabilitas berkurang')
    }
  } else {
    missing.push('Tidak ada FVG — cari OB atau tunggu')
    score -= 12
  }

  /* ── Premium / Discount ── */
  let premiumDiscountOk = false
  if (input.direction === 'long' && input.inDiscount) {
    premiumDiscountOk = true; score += 8
    present.push('Long dari Discount zone')
  } else if (input.direction === 'short' && input.inPremium) {
    premiumDiscountOk = true; score += 8
    present.push('Short dari Premium zone')
  } else {
    missing.push('Premium/Discount tidak aligned')
    score -= 5
  }

  /* ── OTE 62–79% ── */
  const oteBonus = input.inOTE
  if (oteBonus) {
    score += 12
    const lvl = input.ote62 && input.ote79
      ? ` (${input.ote79.toFixed(5)}–${input.ote62.toFixed(5)})`
      : ''
    present.push(`OTE 62–79% Fibonacci${lvl}`)
  } else {
    missing.push('Di luar OTE zone — entry kurang optimal')
  }

  /* ── R:R ── */
  if (input.rrRatio >= 2) {
    score += 5
    present.push(`R:R ${input.rrRatio.toFixed(1)}:1 ✓`)
  } else {
    missing.push(`R:R ${input.rrRatio.toFixed(1)} < 2 — minimum violated`)
    score -= 12
  }

  /* ── Top-Down D1+H4 Bias ── */
  let topDownAligned = false
  if (input.topDown) {
    const td = input.topDown
    const matchDir =
      (td.biasDirection === 'long'  && input.direction === 'long') ||
      (td.biasDirection === 'short' && input.direction === 'short')

    if (td.alignment === 'strong_bull' || td.alignment === 'strong_bear') {
      if (matchDir) {
        topDownAligned = true
        score += 15
        present.push(`D1+H4 fully aligned ${td.biasDirection.toUpperCase()} (+15) 🔥`)
      } else {
        score -= 20
        missing.push(`D1+H4 aligned ${td.biasDirection} tapi entry ${input.direction} — COUNTER-TREND (-20)`)
      }
    } else if (td.alignment === 'partial_bull' || td.alignment === 'partial_bear') {
      if (matchDir) {
        topDownAligned = true
        score += 7
        present.push(`D1/H4 partial alignment ${td.biasDirection} (+7)`)
      } else {
        score -= 10
        missing.push(`Partial top-down conflict (-10)`)
      }
    } else if (td.alignment === 'conflicting') {
      score -= 20
      missing.push('D1 vs H4 CONFLICTING — sangat berisiko (-20)')
    }
  }

  score = Math.max(0, Math.min(100, score))

  const summary = `${input.direction.toUpperCase()} | KZ:${inKillZone} Sweep:${sweepValid} MSS:${input.hasMSS}${mssStrong ? '✓' : '~'} FVG:${input.hasFVG} OTE:${oteBonus} TD:${input.topDown?.alignment ?? 'n/a'}`

  return {
    inKillZone,
    killZone:          input.killZone,
    sweepValid,
    sweepType:         input.sweepType,
    mssValid:          input.hasMSS,
    mssStrong,
    displacementValid: input.hasDisplacement,
    fvgValid:          input.hasFVG,
    premiumDiscountOk,
    oteBonus,
    topDownAligned,
    keyLevelSweep,
    structureScore:    score,
    missing,
    present,
    summary,
  }
}

export function inferSetupType(
  structure: StructureAgentOutput,
  killZone:  KillZone,
): SetupType {
  if (killZone === 'silver_bullet' && structure.fvgValid) return 'silver_bullet'
  if (structure.sweepValid && structure.mssValid && structure.fvgValid) return 'sweep_mss_fvg'
  return 'other'
}

export function gradeFromStructure(
  structure:    StructureAgentOutput,
  riskApproved: boolean,
  rrRatio:      number,
): Grade {
  if (!riskApproved)                             return 'D'
  if (!structure.inKillZone)                     return 'D'
  if (!structure.sweepValid || !structure.mssValid) return 'D'
  if (!structure.fvgValid && !structure.displacementValid) return 'D'

  const s = structure.structureScore
  if (s >= 82 && structure.oteBonus && rrRatio >= 2 && structure.mssStrong) return 'A'
  if (s >= 65 && structure.fvgValid)                                         return 'B'
  if (s >= 45)                                                                return 'C'
  return 'D'
}
