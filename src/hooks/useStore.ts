import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Trade, SetupAnalysis } from '../types'
import type { DetectedSetup } from '../types/ict'
import { ICT_CORE_VERSION } from '../lib/ictCore'

const defaultState: AppState = {
  account: {
    firmName: 'FTMO',
    accountSize: 100000,
    maxDailyDD: 5,
    maxOverallDD: 10,
    profitTarget: 10,
    currentBalance: 100000,
    highWaterMark: 100000,
    isChallenge: true,
  },
  personalRules: {
    riskPerTrade: 0.75,
    personalDailyLimit: 3,
    maxConsecutiveLoss: 2,
    maxTradesPerDay: 3,
  },
  plan: {
    name: 'ICT Core v1',
    instruments: ['XAUUSD', 'NAS100', 'EURUSD'],
    primaryTF: 'H1',
    confirmationTF: 'M15',
    entryRules: 'Sweep + MSS + Displacement + FVG (ICT Core)',
    stopRules: 'Beyond sweep extreme + buffer',
    targetRules: 'Opposing liquidity, min 1:2 R:R',
    sessions: ['london', 'ny_am', 'silver_bullet'],
    isActive: true,
  },
  trades: [],
  analyses: [],
  detectedSetups: [],
  ictCoreVersion: ICT_CORE_VERSION,
  dailyLog: {
    date: new Date().toISOString().slice(0, 10),
    startingEquity: 100000,
    tradesToday: 0,
    consecutiveLosses: 0,
    dailyPnL: 0,
  },
}

interface Store extends AppState {
  updateAccount: (field: string, value: unknown) => void
  updatePersonal: (field: string, value: unknown) => void
  updatePlan: (field: string, value: unknown) => void
  addTrade: (trade: Trade) => void
  addAnalysis: (analysis: SetupAnalysis) => void
  addDetectedSetup: (setup: DetectedSetup) => void
  resetAll: () => void
  ensureDailyLog: () => void
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...defaultState,

      updateAccount: (field, value) =>
        set((s) => ({
          account: { ...s.account, [field]: value },
        })),

      updatePersonal: (field, value) =>
        set((s) => ({
          personalRules: { ...s.personalRules, [field]: value },
        })),

      updatePlan: (field, value) =>
        set((s) => ({
          plan: { ...s.plan, [field]: value },
        })),

      addTrade: (trade) => {
        const s = get()
        const isWin = trade.result === 'win'
        const newBalance = s.account.currentBalance + trade.pnlMoney
        const newHWM = Math.max(s.account.highWaterMark, newBalance)
        const newConsecutive = isWin ? 0 : s.dailyLog.consecutiveLosses + 1

        set({
          trades: [trade, ...s.trades],
          account: {
            ...s.account,
            currentBalance: newBalance,
            highWaterMark: newHWM,
          },
          dailyLog: {
            ...s.dailyLog,
            tradesToday: s.dailyLog.tradesToday + 1,
            consecutiveLosses: newConsecutive,
            dailyPnL: s.dailyLog.dailyPnL + trade.pnlMoney,
          },
        })
      },

      addAnalysis: (analysis) =>
        set((s) => ({
          analyses: [analysis, ...s.analyses].slice(0, 50),
        })),

      addDetectedSetup: (setup) =>
        set((s) => ({
          detectedSetups: [setup, ...(s.detectedSetups || [])].slice(0, 100),
        })),

      resetAll: () => set({ ...defaultState }),

      ensureDailyLog: () => {
        const today = new Date().toISOString().slice(0, 10)
        const s = get()
        if (s.dailyLog.date !== today) {
          set({
            dailyLog: {
              date: today,
              startingEquity: s.account.currentBalance,
              tradesToday: 0,
              consecutiveLosses: 0,
              dailyPnL: 0,
            },
          })
        }
      },
    }),
    {
      name: 'prop-guardian-storage-v2',
    }
  )
)
