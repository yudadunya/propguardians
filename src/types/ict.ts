/** ICT Core Types — Prop Guardian RSI */

export type KillZone = 'london' | 'ny_am' | 'silver_bullet' | 'ny_pm' | 'outside'
export type SweepType = 'bsl' | 'ssl' | 'none'
export type Direction = 'long' | 'short'
export type SetupType = 'sweep_mss_fvg' | 'silver_bullet' | 'unicorn' | 'other'
export type Grade = 'A' | 'B' | 'C' | 'D'
export type SetupStatus =
  | 'detected'
  | 'taken'
  | 'hit_1r'
  | 'hit_2r'
  | 'hit_3r'
  | 'stopped'
  | 'expired'
  | 'skipped'

export interface ICTStructureInput {
  instrument: string
  timeframe: string
  direction: Direction
  killZone: KillZone
  hasLiquiditySweep: boolean
  sweepType: SweepType
  hasDisplacement: boolean
  hasMSS: boolean
  hasFVG: boolean
  fvgPartiallyFilled: boolean
  inPremium: boolean
  inDiscount: boolean
  inOTE: boolean
  stopDistance: number
  rrRatio: number
}

export interface StructureAgentOutput {
  inKillZone: boolean
  killZone: KillZone
  sweepValid: boolean
  sweepType: SweepType
  mssValid: boolean
  displacementValid: boolean
  fvgValid: boolean
  premiumDiscountOk: boolean
  oteBonus: boolean
  structureScore: number
  missing: string[]
  present: string[]
  summary: string
}

export interface RiskAgentOutput {
  approved: boolean
  blockedReason: string | null
  recommendedRiskPercent: number
  positionSize: number
  remainingDailyPct: number
  remainingMaxPct: number
}

export interface EdgeAgentOutput {
  matched: boolean
  setupType: SetupType
  sampleSize: number
  winrate2R: number
  avgR: number
  expectancy: number
  edgeScore: number
  confidence: 'high' | 'medium' | 'low'
  historicalSummary: string
  conditionBoosts: string[]
  modelVersion: string
}

export interface DevilFlag {
  severity: 'critical' | 'high' | 'medium' | 'low'
  code: string
  message: string
  scorePenalty: number
}

export interface DevilAgentOutput {
  flags: DevilFlag[]
  totalPenalty: number
  veto: boolean
  summary: string
  attackCount: number
}

export interface SynthesisOutput {
  grade: Grade
  setupType: SetupType
  decision: 'take' | 'skip' | 'blocked'
  structure: StructureAgentOutput
  edge: EdgeAgentOutput
  devil: DevilAgentOutput
  risk: RiskAgentOutput
  combinedScore: number
  reasons: string[]
  warnings: string[]
  advice: string
  entryHint: string
  stopHint: string
  targetHint: string
}

export interface DetectedSetup {
  id: string
  instrument: string
  timeframe: string
  direction: Direction
  setupType: SetupType
  killZone: KillZone
  grade: Grade
  structureScore: number
  edgeScore: number
  expectancy: number
  decision: 'take' | 'skip' | 'blocked'
  synthesis: SynthesisOutput
  status: SetupStatus
  detectedAt: string
  actualR?: number
}
