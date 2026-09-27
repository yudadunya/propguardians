import { useEffect } from 'react'
import { useStore } from '../hooks/useStore'
import { getRemainingDailyDD, getOverallDD } from '../lib/risk'
import { LivePriceGrid } from '../components/LivePriceTicker'

function StatCard({
  label,
  value,
  sub,
  danger,
}: {
  label: string
  value: string
  sub?: string
  danger?: boolean
}) {
  return (
    <div
      className={`bg-slate-800/80 border rounded-xl p-5 ${
        danger ? 'border-red-500/50 bg-red-950/30' : 'border-slate-700'
      }`}
    >
      <div className="text-xs text-slate-400 uppercase tracking-wider">{label}</div>
      <div
        className={`text-2xl font-bold mt-1 ${
          danger ? 'text-red-400' : 'text-white'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: 'bg-gradient-to-br from-emerald-600 to-emerald-500',
    B: 'bg-gradient-to-br from-sky-600 to-sky-500',
    C: 'bg-gradient-to-br from-amber-600 to-amber-500',
    D: 'bg-gradient-to-br from-red-600 to-red-500',
  }
  return (
    <span
      className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-white font-bold ${
        colors[grade] || 'bg-slate-600'
      }`}
    >
      {grade}
    </span>
  )
}

export default function Dashboard() {
  const state = useStore()
  const { account, personalRules, dailyLog, plan, analyses, ensureDailyLog } = state

  useEffect(() => {
    ensureDailyLog()
  }, [ensureDailyLog])

  const risk     = getRemainingDailyDD(account, personalRules, dailyLog)
  const overallDD = getOverallDD(account)

  // Instruments to show live prices for (from trading plan + extras)
  const watchSymbols = [...new Set([...plan.instruments, 'EURUSD'])]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Risk Dashboard</h2>
        {risk.isBlocked && (
          <span className="px-3 py-1 bg-red-600/20 text-red-400 border border-red-500/40 rounded-full text-sm font-medium">
            ⛔ TRADING BLOCKED
          </span>
        )}
      </div>

      {/* ── Live Market Prices ───────────────────────────────────────── */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
        <LivePriceGrid symbols={watchSymbols} />
      </div>

      {/* ── Risk Stats ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Balance"
          value={`$${account.currentBalance.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}`}
          sub={`HWM: $${account.highWaterMark.toLocaleString()}`}
        />
        <StatCard
          label="Daily PnL"
          value={`${dailyLog.dailyPnL >= 0 ? '+' : ''}$${dailyLog.dailyPnL.toFixed(0)}`}
          danger={dailyLog.dailyPnL < 0}
        />
        <StatCard
          label="Sisa Daily DD (Personal)"
          value={`${risk.remainingPersonalPct.toFixed(2)}%`}
          sub={`$${risk.remainingPersonal.toFixed(0)} remaining`}
          danger={risk.remainingPersonalPct < 1}
        />
        <StatCard
          label="Overall Drawdown"
          value={`${overallDD.toFixed(2)}%`}
          sub={`Limit firm: ${account.maxOverallDD}%`}
          danger={overallDD > account.maxOverallDD * 0.7}
        />
      </div>

      {/* ── Session Counters ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
          <div className="text-sm text-slate-400 mb-2">Trades Hari Ini</div>
          <div className="text-3xl font-bold">
            {dailyLog.tradesToday}{' '}
            <span className="text-base text-slate-500">
              / {personalRules.maxTradesPerDay}
            </span>
          </div>
        </div>
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
          <div className="text-sm text-slate-400 mb-2">Consecutive Losses</div>
          <div
            className={`text-3xl font-bold ${
              dailyLog.consecutiveLosses >= personalRules.maxConsecutiveLoss
                ? 'text-red-400'
                : ''
            }`}
          >
            {dailyLog.consecutiveLosses}{' '}
            <span className="text-base text-slate-500">
              / {personalRules.maxConsecutiveLoss}
            </span>
          </div>
        </div>
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
          <div className="text-sm text-slate-400 mb-2">Risk per Trade</div>
          <div className="text-3xl font-bold">{personalRules.riskPerTrade}%</div>
        </div>
      </div>

      {risk.isBlocked && (
        <div className="bg-red-950/40 border border-red-500/50 rounded-xl p-5">
          <h3 className="font-semibold text-red-400 mb-2">Risk Guardian Active</h3>
          <p className="text-sm text-slate-300">
            Kamu sudah mencapai batas personal. Trading dihentikan sampai besok
            atau sampai consecutive loss reset. Ini fitur paling penting untuk
            lolos challenge.
          </p>
        </div>
      )}

      {/* ── Recent Analyses ──────────────────────────────────────────── */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Recent Analyses</h3>
        {analyses.length === 0 ? (
          <p className="text-slate-500 text-sm">
            Belum ada analisa. Pergi ke Setup Analyzer.
          </p>
        ) : (
          <div className="space-y-2">
            {analyses.slice(0, 5).map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-2 bg-slate-900/50 rounded-lg"
              >
                <GradeBadge grade={a.grade} />
                <div className="flex-1 text-sm">
                  <span className="font-medium">{a.instrument}</span> ·{' '}
                  {a.direction} · Score {a.score}
                </div>
                <div className="text-xs text-slate-500">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
