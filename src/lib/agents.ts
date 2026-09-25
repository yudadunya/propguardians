/**
 * Multi-Agent Phase 3:
 * Structure → Edge → Devil's Advocate → Risk → Synthesis
 */

import {
  runStructureAgent,
  inferSetupType,
  ICT_CORE_VERSION,
} from './ictCore'
import { runEdgeAgent, combinedScore, EDGE_MODEL_VERSION, type EdgeWeights } from './edgeEngine'
import { runDevilAgent, applyDevilPenalty } from './devilAgent'
import { calcPositionSize, getRemainingDailyDD, getOverallDD } from './risk'
import type {
  ICTStructureInput,
  SynthesisOutput,
  DetectedSetup,
  Grade,
  StructureAgentOutput,
  EdgeAgentOutput,
  DevilAgentOutput,
} from '../types/ict'
import type { PropAccount, PersonalRules, DailyLog } from '../types'

export function runRiskAgent(
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog,
  _structureScore: number,
  stopDistance: number,
  gradeHint: Grade
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

  let riskPct = personal.riskPerTrade
  if (gradeHint === 'A') riskPct = personal.riskPerTrade
  else if (gradeHint === 'B') riskPct = personal.riskPerTrade * 0.65
  else if (gradeHint === 'C') riskPct = personal.riskPerTrade * 0.35
  else riskPct = 0

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

function gradeFinal(
  structure: StructureAgentOutput,
  edge: EdgeAgentOutput,
  devil: DevilAgentOutput,
  riskApproved: boolean,
  rrRatio: number,
  finalScore: number
): Grade {
  if (!riskApproved) return 'D'
  if (devil.veto) return 'D'
  if (!structure.inKillZone) return 'D'
  if (!structure.sweepValid || !structure.mssValid) return 'D'
  if (!structure.fvgValid && !structure.displacementValid) return 'D'
  if (edge.expectancy < 0) return 'D'

  if (
    finalScore >= 78 &&
    structure.oteBonus &&
    rrRatio >= 2 &&
    edge.expectancy >= 0.45 &&
    devil.flags.filter((f) => f.severity === 'high').length === 0
  )
    return 'A'
  if (finalScore >= 60 && structure.fvgValid && edge.expectancy >= 0.25) return 'B'
  if (finalScore >= 42 && edge.expectancy >= 0) return 'C'
  return 'D'
}

export function runPhase1Pipeline(
  input: ICTStructureInput,
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog,
  edgeWeights?: EdgeWeights
): SynthesisOutput {
  // 1. Structure
  const structure = runStructureAgent(input)
  const setupType = inferSetupType(structure, input.killZone)

  // 2. Edge (weights from RSI if available)
  const edge = runEdgeAgent(input, structure, setupType, edgeWeights)
  let score = combinedScore(
    structure.structureScore,
    edge.edgeScore,
    edge.expectancy
  )

  // 3. Devil's Advocate
  const devil = runDevilAgent(input, structure, edge, setupType)
  score = applyDevilPenalty(score, devil.totalPenalty)

  // 4. Risk (uses provisional grade without risk veto)
  const provisionalGrade = gradeFinal(
    structure,
    edge,
    devil,
    true,
    input.rrRatio,
    score
  )
  const risk = runRiskAgent(
    account,
    personal,
    dailyLog,
    structure.structureScore,
    input.stopDistance,
    provisionalGrade
  )

  // 5. Synthesis
  const grade = gradeFinal(
    structure,
    edge,
    devil,
    risk.approved,
    input.rrRatio,
    score
  )

  let decision: 'take' | 'skip' | 'blocked' = 'skip'
  if (!risk.approved) decision = 'blocked'
  else if (devil.veto) decision = 'skip'
  else if (grade === 'A' || grade === 'B') decision = 'take'
  else decision = 'skip'

  const reasons = [
    ...structure.present,
    ...edge.conditionBoosts.filter((b) => b.includes('+')),
  ]
  const warnings = [
    ...structure.missing,
    ...edge.conditionBoosts.filter((b) => b.includes('−') || b.includes('-')),
    ...devil.flags.map((f) => `[${f.severity}] ${f.message}`),
  ]
  if (risk.blockedReason) warnings.push(risk.blockedReason)

  let advice = ''
  if (decision === 'blocked') {
    advice = `Risk Guardian veto: ${risk.blockedReason}. Tidak boleh diambil.`
  } else if (devil.veto) {
    advice = `Devil's Advocate veto: ${devil.summary}. Thesis diruntuhkan — SKIP.`
  } else if (grade === 'A') {
    advice = `Semua agent setuju. ICT Core + edge kuat (E[R] ${edge.expectancy}) + devil bersih. TAKE dengan risk penuh.`
  } else if (grade === 'B') {
    advice = `Core + edge cukup, ada catatan devil (${devil.attackCount} flags). Size lebih kecil atau refine.`
  } else if (grade === 'C') {
    advice = `Marginal. Devil: ${devil.summary}. Disarankan SKIP.`
  } else {
    advice =
      edge.expectancy < 0
        ? `Expectancy negatif + devil attack. JANGAN diambil.`
        : 'Tidak lolos filter multi-agent. JANGAN diambil.'
  }

  return {
    grade,
    setupType,
    decision,
    structure,
    edge,
    devil,
    risk,
    combinedScore: score,
    reasons,
    warnings,
    advice,
    entryHint: structure.fvgValid
      ? 'Limit di FVG (prefer CE / midpoint)'
      : 'Tunggu FVG atau OB yang jelas',
    stopHint: structure.sweepValid
      ? 'Di balik extreme sweep (+ buffer kecil)'
      : 'Di balik structure invalidation',
    targetHint: 'Opposing liquidity (minimal 1:2 R:R)',
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
    edgeScore: synthesis.edge.edgeScore,
    expectancy: synthesis.edge.expectancy,
    decision: synthesis.decision,
    synthesis,
    status: synthesis.decision === 'take' ? 'detected' : 'skipped',
    detectedAt: new Date().toISOString(),
  }
}

export { ICT_CORE_VERSION, EDGE_MODEL_VERSION }
