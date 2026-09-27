import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { getRemainingDailyDD } from '../lib/risk'
import type { Trade } from '../types'

export default function Journal() {
  const {
    account,
    personalRules,
    dailyLog,
    trades,
    addTrade,
  } = useStore()

  const risk = getRemainingDailyDD(account, personalRules, dailyLog)

  const [form, setForm] = useState({
    instrument: 'XAUUSD',
    direction: 'long' as 'long' | 'short',
    result: 'win' as 'win' | 'loss' | 'be',
    pnlR: '2',
    riskPercent: '0.75',
    notes: '',
    followedPlan: true,
  })

  function handleAdd() {
    if (risk.isBlocked) {
      alert(
        'Risk Guardian memblokir. Kamu sudah mencapai personal daily limit atau max consecutive loss.'
      )
      return
    }

    const isWin = form.result === 'win'
    const pnlR = isWin
      ? Math.abs(Number(form.pnlR) || 0)
      : form.result === 'be'
        ? 0
        : -Math.abs(Number(form.pnlR) || 1)

    const riskAmount =
      account.currentBalance * (Number(form.riskPercent) / 100)
    const pnlMoney = riskAmount * pnlR

    const trade: Trade = {
      id: Date.now().toString(),
      instrument: form.instrument,
      direction: form.direction,
      result: form.result,
      pnlR,
      pnlMoney,
      riskPercent: Number(form.riskPercent),
      riskAmount,
      followedPlan: form.followedPlan,
      notes: form.notes,
      date: new Date().toISOString(),
    }

    addTrade(trade)
    setForm((f) => ({ ...f, notes: '', pnlR: '2' }))
    alert(`Trade dicatat. PnL: ${pnlR > 0 ? '+' : ''}${pnlR.toFixed(1)}R`)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">Trade Journal</h2>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="font-medium">Catat Trade Baru</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Instrument</label>
            <input
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.instrument}
              onChange={(e) =>
                setForm((f) => ({ ...f, instrument: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Direction</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.direction}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  direction: e.target.value as 'long' | 'short',
                }))
              }
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Result</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.result}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  result: e.target.value as 'win' | 'loss' | 'be',
                }))
              }
            >
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="be">Break Even</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">PnL (R-multiple)</label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.pnlR}
              onChange={(e) =>
                setForm((f) => ({ ...f, pnlR: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Risk %</label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.riskPercent}
              onChange={(e) =>
                setForm((f) => ({ ...f, riskPercent: e.target.value }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Followed Plan?</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={String(form.followedPlan)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  followedPlan: e.target.value === 'true',
                }))
              }
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Notes</label>
          <textarea
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm h-20"
            value={form.notes}
            onChange={(e) =>
              setForm((f) => ({ ...f, notes: e.target.value }))
            }
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={risk.isBlocked}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
            risk.isBlocked
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {risk.isBlocked ? 'Blocked by Risk Guardian' : 'Simpan Trade'}
        </button>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
        <h3 className="font-medium mb-3">History ({trades.length})</h3>
        {trades.length === 0 ? (
          <p className="text-slate-500 text-sm">Belum ada trade.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {trades.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 p-3 bg-slate-900/50 rounded-lg text-sm"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    t.pnlR > 0
                      ? 'bg-emerald-400'
                      : t.pnlR < 0
                        ? 'bg-red-400'
                        : 'bg-slate-400'
                  }`}
                />
                <div className="flex-1">
                  <div className="font-medium">
                    {t.instrument} {t.direction}
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(t.date).toLocaleString()} ·{' '}
                    {t.followedPlan ? 'Plan ✓' : 'Off-plan'}
                  </div>
                </div>
                <div
                  className={`font-semibold ${
                    t.pnlR > 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {t.pnlR > 0 ? '+' : ''}
                  {t.pnlR.toFixed(1)}R
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
