/** ICT Core Types — Prop Guardian v2 */

import type { TopDownBias } from '../lib/topDown'
import type { KeyLevels }   from '../lib/keyLevels'
import type { NewsStatus }  from '../lib/newsFilter'

export type KillZone  = 'london' | 'ny_am' | 'silver_bullet' | 'ny_pm' | 'outside'
export type SweepType = 'bsl' | 'ssl' | 'none'
export type Direction = 'long' | 'short'
export type SetupType = 'sweep_mss_fvg' | 'silver_bullet' | 'unicorn' | 'other'
export type Grade     = 'A' | 'B' | 'C' | 'D'
export type SetupStatus =
  | 'detected' | 'taken' | 'hit_1r' | 'hit_2r' | 'hit_3r'
  | 'stopped'  | 'expired' | 'skipped'

export interface ICTStructureInput {
  instrument:  string
  timeframe:   string
  direction:   Direction
  killZone:    KillZone
  hasLiquiditySweep: boolean
  sweepType:   SweepType
  hasDisplacement:   boolean
  hasMSS:      boolean
  mssStrong?:  boolean
  hasFVG:      boolean
  fvgPartiallyFilled: boolean
  inPremium:   boolean
  inDiscount:  boolean
  inOTE:       boolean
  ote62?:      number | null
  ote79?:      number | null
  stopDistance: number
  rrRatio:     number
  sweepExtreme?:  number | null
  sweepLevel?:    number | null
  avgAtr?:     number
  /** NEW: full top-down bias (D1+H4) */
  topDown?:    TopDownBias | null
  /** NEW: PDH/PDL/Asian range key levels */
  keyLevels?:  KeyLevels | null
  /** NEW: economic calendar news filter */
  newsStatus?: NewsStatus | null
}

export interface StructureAgentOutput {
  inKillZone:        boolean
  killZone:          KillZone
  sweepValid:        boolean
  sweepType:         SweepType
  mssValid:          boolean
  mssStrong:         boolean
  displacementValid: boolean
  fvgValid:          boolean
  premiumDiscountOk: boolean
  oteBonus:          boolean
  topDownAligned:    boolean
  keyLevelSweep:     boolean
  structureScore:    number
  missing:           string[]
  present:           string[]
  summary:           string
}

export interface RiskAgentOutput {
  approved:               boolean
  blockedReason:          string | null
  recommendedRiskPercent: number
  positionSize:           number
  remainingDailyPct:      number
  remainingMaxPct:        number
}

export interface EdgeAgentOutput {
  matched:           boolean
  setupType:         SetupType
  sampleSize:        number
  winrate2R:         number
  avgR:              number
  expectancy:        number
  edgeScore:         number
  confidence:        'high' | 'medium' | 'low'
  historicalSummary: string
  conditionBoosts:   string[]
  modelVersion:      string
}

export interface DevilFlag {
  severity:     'critical' | 'high' | 'medium' | 'low'
  code:         string
  message:      string
  scorePenalty: number
}

export interface DevilAgentOutput {
  flags:       DevilFlag[]
  totalPenalty: number
  veto:        boolean
  summary:     string
  attackCount: number
}

export interface SynthesisOutput {
  grade:         Grade
  setupType:     SetupType
  decision:      'take' | 'skip' | 'blocked'
  structure:     StructureAgentOutput
  edge:          EdgeAgentOutput
  devil:         DevilAgentOutput
  risk:          RiskAgentOutput
  combinedScore: number
  reasons:       string[]
  warnings:      string[]
  advice:        string
  entryHint:     string
  stopHint:      string
  targetHint:    string
}

export interface DetectedSetup {
  id:            string
  instrument:    string
  timeframe:     string
  direction:     Direction
  setupType:     SetupType
  killZone:      KillZone
  grade:         Grade
  structureScore: number
  edgeScore:     number
  expectancy:    number
  decision:      'take' | 'skip' | 'blocked'
  synthesis:     SynthesisOutput
  status:        SetupStatus
  detectedAt:    string
  actualR?:      number
}
