export interface PropAccount {
  firmName: string
  accountSize: number
  maxDailyDD: number
  maxOverallDD: number
  profitTarget: number
  currentBalance: number
  highWaterMark: number
  isChallenge: boolean
}

export interface PersonalRules {
  riskPerTrade: number
  personalDailyLimit: number
  maxConsecutiveLoss: number
  maxTradesPerDay: number
}

export interface TradingPlan {
  name: string
  instruments: string[]
  primaryTF: string
  confirmationTF: string
  entryRules: string
  stopRules: string
  targetRules: string
  sessions: string[]
  isActive: boolean
}

export interface Trade {
  id: string
  instrument: string
  direction: 'long' | 'short'
  result: 'win' | 'loss' | 'be'
  pnlR: number
  pnlMoney: number
  riskPercent: number
  riskAmount: number
  followedPlan: boolean
  notes: string
  grade?: string
  date: string
}

export interface DailyLog {
  date: string
  startingEquity: number
  tradesToday: number
  consecutiveLosses: number
  dailyPnL: number
}

/** Legacy analysis shape (kept for Dashboard compatibility) */
export interface SetupAnalysis {
  grade: 'A' | 'B' | 'C' | 'D'
  score: number
  reasons: string[]
  warnings: string[]
  recommendedRisk: number
  positionSize: number
  advice: string
  instrument: string
  direction: string
  session: string
  timestamp: string
}

export interface AppState {
  account: PropAccount
  personalRules: PersonalRules
  plan: TradingPlan
  trades: Trade[]
  analyses: SetupAnalysis[]
  dailyLog: DailyLog
  detectedSetups: import('./ict').DetectedSetup[]
  ictCoreVersion: string
}
