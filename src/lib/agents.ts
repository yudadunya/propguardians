/**
 * agents.ts — Multi-Agent Pipeline
 * Structure → Edge → Devil's Advocate → Risk → Synthesis
 * v1.1: instrument-aware position sizing; mssStrong in grading
 */

import { runStructureAgent, inferSetupType, ICT_CORE_VERSION } from './ictCore'
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

/** Risk Agent — per-instrument position sizing */
export function runRiskAgent(
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog,
  _structureScore: number,
  stopDistance: number,
  gradeHint: Grade,
  instrument = 'EURUSD',
) {
  const risk     = getRemainingDailyDD(account, personal, dailyLog)
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
      blockedReason: 'Near max overall drawdown — protect the account',
      recommendedRiskPercent: 0,
      positionSize: 0,
      remainingDailyPct: risk.remainingPersonalPct,
      remainingMaxPct: account.maxOverallDD - overallDD,
    }
  }

  // Grade-scaled risk (A = full, B = 65%, C = 35%, D = 0)
  let riskPct =
    gradeHint === 'A' ? personal.riskPerTrade :
    gradeHint === 'B' ? personal.riskPerTrade * 0.65 :
    gradeHint === 'C' ? personal.riskPerTrade * 0.35 :
    0

  // Never exceed 80% of remaining daily budget in one trade
  const maxFromDaily = risk.remainingPersonalPct * 0.80
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
    stopDistance,
    instrument,  // ← instrument-aware pip value
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

/** Grade Setup — uses mssStrong for hard Grade A gating */
function gradeFinal(
  structure: StructureAgentOutput,
  edge: EdgeAgentOutput,
  devil: DevilAgentOutput,
  riskApproved: boolean,
  rrRatio: number,
  finalScore: number,
): Grade {
  if (!riskApproved)               return 'D'
  if (devil.veto)                  return 'D'
  if (!structure.inKillZone)       return 'D'
  if (!structure.sweepValid || !structure.mssValid) return 'D'
  if (!structure.fvgValid && !structure.displacementValid) return 'D'
  if (edge.expectancy < 0)         return 'D'

  const highSeverityFlags = devil.flags.filter(f => f.severity === 'high' || f.severity === 'critical')

  // Grade A — all agents green + hard CHoCH confirmed
  if (
    finalScore >= 78 &&
    structure.oteBonus &&
    structure.mssStrong &&       // ← must be hard CHoCH, not inferred
    rrRatio >= 2 &&
    edge.expectancy >= 0.45 &&
    highSeverityFlags.length === 0
  ) return 'A'

  // Grade B — solid setup, FVG present, decent edge
  if (finalScore >= 60 && structure.fvgValid && edge.expectancy >= 0.25) return 'B'

  // Grade C — marginal
  if (finalScore >= 42 && edge.expectancy >= 0) return 'C'

  return 'D'
}

/** Main pipeline — Structure → Edge → Devil → Risk → Synthesis */
export function runPhase1Pipeline(
  input: ICTStructureInput,
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog,
  edgeWeights?: EdgeWeights,
): SynthesisOutput {
  // 1. Structure Agent
  const structure = runStructureAgent(input)
  const setupType = inferSetupType(structure, input.killZone)

  // 2. Edge Agent (RSI-learned weights if available)
  const edge  = runEdgeAgent(input, structure, setupType, edgeWeights)
  let score   = combinedScore(structure.structureScore, edge.edgeScore, edge.expectancy)

  // 3. Devil's Advocate
  const devil = runDevilAgent(input, structure, edge, setupType)
  score = applyDevilPenalty(score, devil.totalPenalty)

  // 4. Risk Agent — provisional grade without risk veto
  const provisionalGrade = gradeFinal(structure, edge, devil, true, input.rrRatio, score)
  const risk = runRiskAgent(
    account, personal, dailyLog,
    structure.structureScore,
    input.stopDistance,
    provisionalGrade,
    input.instrument,  // ← instrument-aware
  )

  // 5. Final grade with risk approval
  const grade = gradeFinal(structure, edge, devil, risk.approved, input.rrRatio, score)

  let decision: 'take' | 'skip' | 'blocked' = 'skip'
  if (!risk.approved)              decision = 'blocked'
  else if (devil.veto)             decision = 'skip'
  else if (grade === 'A' || grade === 'B') decision = 'take'
  else                             decision = 'skip'

  const reasons = [
    ...structure.present,
    ...edge.conditionBoosts.filter(b => b.includes('+')),
  ]
  const warnings = [
    ...structure.missing,
    ...edge.conditionBoosts.filter(b => b.includes('−') || b.includes('-')),
    ...devil.flags.map(f => `[${f.severity}] ${f.message}`),
    ...(risk.blockedReason ? [risk.blockedReason] : []),
  ]

  // Advice copy
  let advice = ''
  if (decision === 'blocked') {
    advice = `Risk Guardian veto: ${risk.blockedReason}. Tidak boleh diambil.`
  } else if (devil.veto) {
    advice = `Devil's Advocate veto: ${devil.summary}. SKIP.`
  } else if (grade === 'A') {
    const mssNote = structure.mssStrong ? 'CHoCH hard confirmed.' : ''
    advice = `Semua agent hijau. ICT Core lengkap. ${mssNote} TAKE full risk.`
  } else if (grade === 'B') {
    const mssNote = !structure.mssStrong
      ? ' CHoCH belum hard confirmed — pertimbangkan tunggu close di atas CHoCH level.'
      : ''
    advice = `Core + edge cukup, ada catatan devil.${mssNote} Size kecil atau refine entry.`
  } else if (grade === 'C') {
    advice = `Marginal. ${devil.summary}. Disarankan SKIP atau demo saja.`
  } else {
    advice = edge.expectancy < 0
      ? `Expectancy negatif (${edge.expectancy.toFixed(2)}). Statistically unfavorable. SKIP.`
      : `Tidak lolos multi-agent filter. SKIP.`
  }

  // Entry / stop / target hints
  const entryHint = input.inOTE && input.ote62
    ? `OTE zone ${input.ote79?.toFixed(5) ?? ''}–${input.ote62?.toFixed(5) ?? ''} (62–79% fib)`
    : structure.fvgValid
    ? 'Limit order di FVG midpoint (CE)'
    : 'Tunggu FVG atau OB terbentuk'

  const stopHint = input.sweepExtreme
    ? `Di balik sweep extreme ${input.sweepExtreme.toFixed(5)} + buffer`
    : structure.sweepValid
    ? 'Di balik sweep extreme + 0.5 ATR buffer'
    : 'Di balik structure invalidation level'

  return {
    grade, setupType, decision,
    structure, edge, devil, risk,
    combinedScore: score,
    reasons, warnings, advice,
    entryHint,
    stopHint,
    targetHint: 'Opposing liquidity (minimal 1:2 R:R, ideal 1:3)',
  }
}

export function createDetectedSetup(
  input: ICTStructureInput,
  synthesis: SynthesisOutput,
): DetectedSetup {
  return {
    id: `setup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    instrument:    input.instrument,
    timeframe:     input.timeframe,
    direction:     input.direction,
    setupType:     synthesis.setupType,
    killZone:      input.killZone,
    grade:         synthesis.grade,
    structureScore: synthesis.structure.structureScore,
    edgeScore:     synthesis.edge.edgeScore,
    expectancy:    synthesis.edge.expectancy,
    decision:      synthesis.decision,
    synthesis,
    status: synthesis.decision === 'take' ? 'detected' : 'skipped',
    detectedAt: new Date().toISOString(),
  }
}

export { ICT_CORE_VERSION, EDGE_MODEL_VERSION }
