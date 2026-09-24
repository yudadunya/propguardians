import type { PropAccount, PersonalRules, DailyLog } from '../types'

export function calcPositionSize(
  equity: number,
  riskPercent: number,
  stopDistancePips: number,
  pipValue = 10
): number {
  const riskAmount = equity * (riskPercent / 100)
  if (stopDistancePips <= 0) return 0
  const size = riskAmount / (stopDistancePips * pipValue)
  return Math.max(0.01, Math.round(size * 100) / 100)
}

export function getRemainingDailyDD(
  account: PropAccount,
  personal: PersonalRules,
  dailyLog: DailyLog
) {
  const firmLimit = account.accountSize * (account.maxDailyDD / 100)
  const personalLimit = account.accountSize * (personal.personalDailyLimit / 100)
  const used = Math.abs(Math.min(0, dailyLog.dailyPnL))

  const remainingFirm = firmLimit - used
  const remainingPersonal = personalLimit - used

  return {
    remainingFirm,
    remainingPersonal,
    remainingFirmPct: (remainingFirm / account.accountSize) * 100,
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
