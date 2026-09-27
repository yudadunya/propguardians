/**
 * risk.ts — Position sizing dengan pip value per instrument yang akurat.
 * Sebelumnya: pipValue flat $10 untuk semua — salah untuk XAUUSD/NAS100.
 */

import type { PropAccount, PersonalRules, DailyLog } from '../types'

/**
 * Pip size dan pip value (USD) per 1 standard lot.
 * Pip size = smallest meaningful price move untuk instrumen tsb.
 * Pip value = dollar PnL per 1 pip per 1 standard lot.
 *
 * Rumus positionSize:
 *   pips       = stopDistancePriceUnits / pipSize
 *   costPerLot = pips × pipValue
 *   size       = riskAmount / costPerLot
 */
export const INSTRUMENT_SPECS: Record<string, { pipSize: number; pipValue: number }> = {
  // Forex majors — 1 lot = 100,000 units
  EURUSD: { pipSize: 0.0001, pipValue: 10 },
  GBPUSD: { pipSize: 0.0001, pipValue: 10 },
  AUDUSD: { pipSize: 0.0001, pipValue: 10 },
  NZDUSD: { pipSize: 0.0001, pipValue: 10 },
  USDJPY: { pipSize: 0.01,   pipValue: 7  }, // ≈ $7 at 140 USDJPY
  USDCAD: { pipSize: 0.0001, pipValue: 7.5 },
  USDCHF: { pipSize: 0.0001, pipValue: 11  },
  EURGBP: { pipSize: 0.0001, pipValue: 12  },
  // Metals
  XAUUSD: { pipSize: 0.01, pipValue: 1 },   // 100 oz × $0.01/oz = $1/pip
  XAGUSD: { pipSize: 0.001, pipValue: 5 },  // 5000 oz × $0.001 = $5/pip
  // Indices (CFD, 1 lot ≈ 1 contract, $1/point typical retail CFD)
  NAS100:  { pipSize: 1, pipValue: 1 },
  USTEC:   { pipSize: 1, pipValue: 1 },
  US30:    { pipSize: 1, pipValue: 1 },
  SP500:   { pipSize: 0.1, pipValue: 1 },
  UK100:   { pipSize: 1, pipValue: 1 },
  GER40:   { pipSize: 1, pipValue: 1 },
}

/** Fallback spec when instrument not found */
const DEFAULT_SPEC = { pipSize: 0.0001, pipValue: 10 }

/**
 * Hitung lot size dengan pip value yang benar per instrumen.
 * @param equity                 Account balance / equity
 * @param riskPercent            Risk percentage (e.g. 0.75 = 0.75%)
 * @param stopDistancePriceUnits Stop loss dalam price units mentah (bukan pips)
 *                               Contoh: EURUSD 35 pips → 0.0035
 *                                       XAUUSD 25 pts  → 25 (not 2500)
 * @param instrument             Instrument code for lookup
 */
export function calcPositionSize(
  equity: number,
  riskPercent: number,
  stopDistancePriceUnits: number,
  instrument = 'EURUSD',
): number {
  if (stopDistancePriceUnits <= 0 || equity <= 0 || riskPercent <= 0) return 0

  const spec = INSTRUMENT_SPECS[instrument] ?? DEFAULT_SPEC
  const riskAmount = equity * (riskPercent / 100)
  const pips = stopDistancePriceUnits / spec.pipSize
  const costPerLot = pips * spec.pipValue

  if (costPerLot <= 0) return 0
  return Math.max(0.01, Math.round((riskAmount / costPerLot) * 100) / 100)
}

export function getRemainingDailyDD(
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog,
) {
  const firmLimit     = account.accountSize * (account.maxDailyDD / 100)
  const personalLimit = account.accountSize * (personal.personalDailyLimit / 100)
  const used          = Math.abs(Math.min(0, dailyLog.dailyPnL))

  const remainingFirm     = firmLimit - used
  const remainingPersonal = personalLimit - used

  return {
    remainingFirm,
    remainingPersonal,
    remainingFirmPct:     (remainingFirm / account.accountSize) * 100,
    remainingPersonalPct: (remainingPersonal / account.accountSize) * 100,
    isBlocked:
      remainingPersonal <= 0 ||
      dailyLog.consecutiveLosses >= personal.maxConsecutiveLoss,
  }
}

export function getOverallDD(account: PropAccount): number {
  const dd =
    ((account.highWaterMark - account.currentBalance) / account.accountSize) * 100
  return Math.max(0, dd)
}
