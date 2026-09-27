/** ICT Core Types — Prop Guardian */

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

/**
 * Full ICT structure input fed to the multi-agent pipeline.
 * Optional fields (?) carry the richer context from patternDetector v2.
 * They degrade gracefully — agents check presence before using.
 */
export interface ICTStructureInput {
  instrument: string
  timeframe: string
  direction: Direction
  killZone: KillZone
  hasLiquiditySweep: boolean
  sweepType: SweepType
  hasDisplacement: boolean
  hasMSS: boolean
  /** true = actual CHoCH close beyond level; false = displacement-inferred only */
  mssStrong?: boolean
  hasFVG: boolean
  fvgPartiallyFilled: boolean
  inPremium: boolean
  inDiscount: boolean
  inOTE: boolean
  /** Precise OTE 62% level (for UI display and agent evaluation) */
  ote62?: number | null
  /** Precise OTE 79% level */
  ote79?: number | null
  stopDistance: number
  rrRatio: number
  /** Actual wick extreme of sweep candle — the real stop reference */
  sweepExtreme?: number | null
  /** Average True Range of the scanned series — for position sizing calibration */
  avgAtr?: number
}

export interface StructureAgentOutput {
  inKillZone: boolean
  killZone: KillZone
  sweepValid: boolean
  sweepType: SweepType
  mssValid: boolean
  /** Indicates if MSS was a hard CHoCH (close beyond level) vs soft inference */
  mssStrong: boolean
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
