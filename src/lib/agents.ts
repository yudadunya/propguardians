/**
 * Multi-Agent Phase 1: Structure + Risk + Synthesis
 * Edge Agent + Devil + RSI come in later phases.
 */

import { runStructureAgent, inferSetupType, gradeFromStructure, ICT_CORE_VERSION } from './ictCore'
import { calcPositionSize, getRemainingDailyDD, getOverallDD } from './risk'
import type { ICTStructureInput, SynthesisOutput, DetectedSetup } from '../types/ict'
import type { PropAccount, PersonalRules, DailyLog } from '../types'

export function runRiskAgent(
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog,
  structureScore: number,
  stopDistance: number,
  gradeHint: 'A' | 'B' | 'C' | 'D'
) {
  const risk = getRemainingDailyDD(account, personal, dailyLog)
  const overallDD = getOverallDD(account)

  if (risk.isBlocked) {
    return {
      approved: false,
      blockedReason:
        risk.remainingPersonalPct <= 0
          ? 'Personal daily loss limit reached'
          : 'Max consecutive losses reached',
      recommendedRiskPercent: 0,
      positionSize: 0,
      remainingDailyPct: risk.remainingPersonalPct,
      remainingMaxPct: account.maxOverallDD - overallDD,
    }
  }

  if (overallDD >= account.maxOverallDD * 0.95) {
    return {
      approved: false,
      blockedReason: 'Near max overall drawdown',
      recommendedRiskPercent: 0,
      positionSize: 0,
      remainingDailyPct: risk.remainingPersonalPct,
      remainingMaxPct: account.maxOverallDD - overallDD,
    }
  }

  // Scale risk by grade quality
  let riskPct = personal.riskPerTrade
  if (gradeHint === 'A') riskPct = personal.riskPerTrade
  else if (gradeHint === 'B') riskPct = personal.riskPerTrade * 0.65
  else if (gradeHint === 'C') riskPct = personal.riskPerTrade * 0.35
  else riskPct = 0

  // Cap by remaining personal daily room
  const maxFromDaily = risk.remainingPersonalPct * 0.8
  riskPct = Math.min(riskPct, maxFromDaily)
  if (riskPct < 0.15) {
    return {
      approved: false,
      blockedReason: 'Insufficient daily risk budget for meaningful size',
      recommendedRiskPercent: 0,
      positionSize: 0,
      remainingDailyPct: risk.remainingPersonalPct,
      remainingMaxPct: account.maxOverallDD - overallDD,
    }
  }

  const positionSize = calcPositionSize(
    account.currentBalance,
    riskPct,
    stopDistance
  )

  return {
    approved: true,
    blockedReason: null,
    recommendedRiskPercent: Math.round(riskPct * 100) / 100,
    positionSize,
    remainingDailyPct: risk.remainingPersonalPct,
    remainingMaxPct: account.maxOverallDD - overallDD,
  }
}

/**
 * Full Phase-1 pipeline: Structure → provisional grade → Risk → final Synthesis
 */
export function runPhase1Pipeline(
  input: ICTStructureInput,
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog
): SynthesisOutput {
  const structure = runStructureAgent(input)
  const setupType = inferSetupType(structure, input.killZone)

  // Provisional grade ignoring risk (for risk sizing)
  const provisionalGrade = gradeFromStructure(structure, true, input.rrRatio)
  const risk = runRiskAgent(
    account,
    personal,
    dailyLog,
    structure.structureScore,
    input.stopDistance,
    provisionalGrade
  )

  const grade = gradeFromStructure(structure, risk.approved, input.rrRatio)

  let decision: 'take' | 'skip' | 'blocked' = 'skip'
  if (!risk.approved) decision = 'blocked'
  else if (grade === 'A' || grade === 'B') decision = 'take'
  else decision = 'skip'

  const reasons = [...structure.present]
  const warnings = [...structure.missing]
  if (risk.blockedReason) warnings.push(risk.blockedReason)

  let advice = ''
  if (decision === 'blocked') {
    advice = `Risk Guardian veto: ${risk.blockedReason}. Tidak boleh diambil.`
  } else if (grade === 'A') {
    advice =
      'ICT Core lengkap + session kuat. Setup berkualitas tinggi. Boleh diambil dengan risk penuh sesuai plan.'
  } else if (grade === 'B') {
    advice =
      'Core terpenuhi. Ada sedikit kekurangan confluence. Size lebih kecil atau tunggu refine.'
  } else if (grade === 'C') {
    advice = 'Struktur lemah / kurang konfluensi. Disarankan SKIP.'
  } else {
    advice =
      'Tidak memenuhi ICT Core (Kill Zone / Sweep / MSS / FVG). JANGAN diambil.'
  }

  const entryHint = structure.fvgValid
    ? 'Limit di FVG (prefer CE / midpoint)'
    : 'Tunggu FVG atau OB yang jelas'
  const stopHint =
    structure.sweepValid
      ? 'Di balik extreme sweep (+ buffer kecil)'
      : 'Di balik structure invalidation'
  const targetHint = 'Opposing liquidity (minimal 1:2 R:R)'

  return {
    grade,
    setupType,
    decision,
    structure,
    risk,
    reasons,
    warnings,
    advice,
    entryHint,
    stopHint,
    targetHint,
  }
}

export function createDetectedSetup(
  input: ICTStructureInput,
  synthesis: SynthesisOutput
): DetectedSetup {
  return {
    id: `setup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    instrument: input.instrument,
    timeframe: input.timeframe,
    direction: input.direction,
    setupType: synthesis.setupType,
    killZone: input.killZone,
    grade: synthesis.grade,
    structureScore: synthesis.structure.structureScore,
    decision: synthesis.decision,
    synthesis,
    status: synthesis.decision === 'take' ? 'detected' : 'skipped',
    detectedAt: new Date().toISOString(),
  }
}

export { ICT_CORE_VERSION }
