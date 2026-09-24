import { calcPositionSize } from './risk'

interface AnalyzeInput {
  instrument: string
  direction: string
  session: string
  hasLiquiditySweep: boolean
  hasMSS: boolean
  hasFVG: boolean
  rrRatio: number
  stopDistance: number
  inPlanInstruments: boolean
  inAllowedSession: boolean
  equity: number
  riskPercent: number
}

export function analyzeSetup(input: AnalyzeInput) {
  let score = 0
  const reasons: string[] = []
  const warnings: string[] = []

  if (input.inPlanInstruments) {
    score += 15
    reasons.push('Instrument sesuai Trading Plan')
  } else {
    warnings.push('Instrument TIDAK ada di plan kamu')
    score -= 30
  }

  if (input.inAllowedSession) {
    score += 20
    reasons.push(`Session ${input.session} diizinkan di plan`)
  } else {
    warnings.push(`Session ${input.session} di luar filter plan`)
    score -= 25
  }

  if (input.hasLiquiditySweep) {
    score += 20
    reasons.push('Ada Liquidity Sweep')
  } else {
    warnings.push('Tidak ada Liquidity Sweep')
  }

  if (input.hasMSS) {
    score += 20
    reasons.push('Ada Market Structure Shift')
  } else {
    warnings.push('Tidak ada Market Structure Shift')
  }

  if (input.hasFVG) {
    score += 15
    reasons.push('Ada Fair Value Gap')
  } else {
    warnings.push('Tidak ada Fair Value Gap')
  }

  if (input.rrRatio >= 2.5) {
    score += 15
    reasons.push(`R:R bagus (${input.rrRatio.toFixed(1)})`)
  } else if (input.rrRatio >= 2) {
    score += 8
    reasons.push(`R:R acceptable (${input.rrRatio.toFixed(1)})`)
  } else {
    score -= 15
    warnings.push(`R:R terlalu kecil (${input.rrRatio.toFixed(1)}) — minimal 1:2`)
  }

  score = Math.max(0, Math.min(100, score))

  let grade: 'A' | 'B' | 'C' | 'D' = 'D'
  if (score >= 80) grade = 'A'
  else if (score >= 60) grade = 'B'
  else if (score >= 40) grade = 'C'

  if (!input.inPlanInstruments || !input.inAllowedSession) grade = 'D'
  if (!input.hasLiquiditySweep && !input.hasMSS) grade = 'D'

  const recommendedRisk =
    grade === 'A' ? input.riskPercent : grade === 'B' ? input.riskPercent * 0.6 : 0

  const positionSize = calcPositionSize(
    input.equity,
    recommendedRisk,
    input.stopDistance
  )

  let advice = ''
  if (grade === 'A')
    advice = 'Setup berkualitas tinggi. Boleh diambil dengan full risk sesuai plan.'
  else if (grade === 'B')
    advice =
      'Setup cukup bagus tapi ada kekurangan. Pertimbangkan size lebih kecil atau skip.'
  else if (grade === 'C')
    advice = 'Confluence lemah. Disarankan SKIP untuk menjaga disiplin.'
  else advice = 'Setup TIDAK memenuhi kriteria plan atau risk. JANGAN diambil.'

  return {
    grade,
    score,
    reasons,
    warnings,
    recommendedRisk: Math.round(recommendedRisk * 100) / 100,
    positionSize,
    advice,
    direction: input.direction,
    instrument: input.instrument,
    session: input.session,
  }
}
