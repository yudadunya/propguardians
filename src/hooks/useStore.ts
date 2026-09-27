import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Trade, SetupAnalysis } from '../types'
import type { DetectedSetup } from '../types/ict'
import { ICT_CORE_VERSION } from '../lib/ictCore'
import {
  DEFAULT_WEIGHTS,
  runRSIUpdate,
  createEpisodeFromSetup,
  type FeatureWeights,
  type Episode,
  type ModelVersion,
  RSI_VERSION,
} from '../lib/rsiEngine'
import type { TelegramConfig } from '../lib/telegramAlert'
import type { ScannerConfig } from '../lib/autoScanner'

interface Store extends AppState {
  featureWeights: FeatureWeights
  episodes: Episode[]
  modelVersions: ModelVersion[]
  rsiModelVersion: string
  lastRsiSummary: string | null
  telegramConfig: TelegramConfig
  scannerConfig: ScannerConfig
  updateAccount: (field: string, value: unknown) => void
  updatePersonal: (field: string, value: unknown) => void
  updatePlan: (field: string, value: unknown) => void
  updateTelegram: (patch: Partial<TelegramConfig>) => void
  updateScanner: (patch: Partial<ScannerConfig>) => void
  addTrade: (trade: Trade) => void
  addAnalysis: (analysis: SetupAnalysis) => void
  addDetectedSetup: (setup: DetectedSetup) => void
  recordOutcome: (
    setupId: string,
    actualR: number,
    features: { fvgPartial: boolean; rrRatio: number; outsideKz: boolean }
  ) => void
  runRSI: () => string
  ingestBacktest: (episodes: Episode[], summary: string) => string
  resetAll: () => void
  ensureDailyLog: () => void
}

const defaultState = {
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
  trades: [] as Trade[],
  analyses: [] as SetupAnalysis[],
  detectedSetups: [] as DetectedSetup[],
  ictCoreVersion: ICT_CORE_VERSION,
  featureWeights: { ...DEFAULT_WEIGHTS },
  episodes: [] as Episode[],
  modelVersions: [] as ModelVersion[],
  rsiModelVersion: RSI_VERSION,
  lastRsiSummary: null as string | null,
  telegramConfig: {
    botToken:    '',
    chatId:      '',
    enabled:     false,
    alertGrades: ['A', 'B'] as ('A' | 'B')[],
  },
  scannerConfig: {
    enabled:         false,
    intervalMinutes: 15,
    instruments:     ['XAUUSD', 'NAS100', 'EURUSD'],
    alertGrades:     ['A', 'B'] as ('A' | 'B')[],
    onlyInKillZone:  true,
    cooldownMinutes: 30,
  },
  dailyLog: {
    date: new Date().toISOString().slice(0, 10),
    startingEquity: 100000,
    tradesToday: 0,
    consecutiveLosses: 0,
    dailyPnL: 0,
  },
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...defaultState,

      updateAccount: (field, value) =>
        set((s) => ({ account: { ...s.account, [field]: value } })),

      updatePersonal: (field, value) =>
        set((s) => ({ personalRules: { ...s.personalRules, [field]: value } })),

      updatePlan: (field, value) =>
        set((s) => ({ plan: { ...s.plan, [field]: value } })),

      updateTelegram: (patch) =>
        set((s) => ({ telegramConfig: { ...s.telegramConfig, ...patch } })),

      updateScanner: (patch) =>
        set((s) => ({ scannerConfig: { ...s.scannerConfig, ...patch } })),

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

      recordOutcome: (setupId, actualR, features) => {
        const s = get()
        const setup = s.detectedSetups.find((x) => x.id === setupId)
        if (!setup) return

        const ep = createEpisodeFromSetup(
          setup,
          features,
          actualR,
          s.rsiModelVersion
        )

        set({
          episodes: [ep, ...s.episodes].slice(0, 500),
          detectedSetups: s.detectedSetups.map((x) =>
            x.id === setupId
              ? {
                  ...x,
                  actualR,
                  status:
                    actualR >= 2
                      ? 'hit_2r'
                      : actualR >= 1
                        ? 'hit_1r'
                        : actualR > 0
                          ? 'hit_1r'
                          : actualR === 0
                            ? 'expired'
                            : 'stopped',
                }
              : x
          ),
        })
      },

      ingestBacktest: (newEpisodes, summary) => {
        const s = get()
        const merged = [...newEpisodes, ...s.episodes].slice(0, 500)
        const result = runRSIUpdate(merged.filter(e => !e.processed), s.featureWeights, s.rsiModelVersion)
        if (result.processed === 0) {
          // still store episodes for later
          set({
            episodes: merged,
            lastRsiSummary: summary + ' | ' + result.summary,
          })
          return summary + ' — ' + result.summary
        }
        set({
          episodes: merged.map(e => ({ ...e, processed: true })),
          featureWeights: result.weights,
          rsiModelVersion: result.newVersion,
          lastRsiSummary: summary + ' | ' + result.summary,
          modelVersions: [
            {
              version: result.newVersion,
              parentVersion: s.rsiModelVersion,
              weights: result.weights,
              episodeCount: result.processed,
              avgActualR: 0,
              winrate2R: 0,
              createdAt: new Date().toISOString(),
              notes: summary,
            },
            ...s.modelVersions,
          ].slice(0, 20),
        })
        return summary + ' | ' + result.summary
      },

      runRSI: () => {
        const s = get()
        const result = runRSIUpdate(
          s.episodes,
          s.featureWeights,
          s.rsiModelVersion
        )
        if (result.processed === 0) {
          set({ lastRsiSummary: result.summary })
          return result.summary
        }

        const version: ModelVersion = {
          version: result.newVersion,
          parentVersion: s.rsiModelVersion,
          weights: result.weights,
          episodeCount: result.processed,
          avgActualR:
            s.episodes
              .filter((e) => !e.processed)
              .reduce((a, e) => a + e.actualR, 0) / result.processed,
          winrate2R:
            s.episodes.filter((e) => !e.processed && e.actualR >= 2).length /
            result.processed,
          createdAt: new Date().toISOString(),
          notes: result.summary,
        }

        set({
          featureWeights: result.weights,
          rsiModelVersion: result.newVersion,
          lastRsiSummary: result.summary,
          modelVersions: [version, ...s.modelVersions].slice(0, 20),
          episodes: s.episodes.map((e) =>
            e.processed ? e : { ...e, processed: true }
          ),
        })
        return result.summary
      },

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
    { name: 'prop-guardian-storage-v5' }
  )
)
