import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { analyzeSetup } from '../lib/analyzer'
import type { SetupAnalysis } from '../types'

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    A: 'bg-gradient-to-br from-emerald-600 to-emerald-500',
    B: 'bg-gradient-to-br from-sky-600 to-sky-500',
    C: 'bg-gradient-to-br from-amber-600 to-amber-500',
    D: 'bg-gradient-to-br from-red-600 to-red-500',
  }
  return (
    <span
      className={`inline-flex items-center justify-center w-12 h-12 rounded-xl text-white font-bold text-xl ${
        colors[grade] || 'bg-slate-600'
      }`}
    >
      {grade}
    </span>
  )
}

export default function Analyzer() {
  const { account, personalRules, plan, addAnalysis } = useStore()
  const [result, setResult] = useState<SetupAnalysis | null>(null)

  const [form, setForm] = useState({
    instrument: 'XAUUSD',
    direction: 'long',
    session: 'London',
    hasLiquiditySweep: true,
    hasMSS: true,
    hasFVG: true,
    rrRatio: 2.5,
    stopDistance: 25,
  })

  function run() {
    const analysis = analyzeSetup({
      ...form,
      inPlanInstruments: plan.instruments.includes(form.instrument),
      inAllowedSession: plan.sessions.includes(form.session),
      equity: account.currentBalance,
      riskPercent: personalRules.riskPerTrade,
    })

    const full: SetupAnalysis = {
      ...analysis,
      timestamp: new Date().toISOString(),
    }

    setResult(full)
    addAnalysis(full)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">Setup Quality Analyzer</h2>
      <p className="text-slate-400 text-sm">
        AI menilai setup berdasarkan Trading Plan kamu. Hanya Grade A & B yang
        disarankan.
      </p>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400">Instrument</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.instrument}
              onChange={(e) =>
                setForm((f) => ({ ...f, instrument: e.target.value }))
              }
            >
              {['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30'].map(
                (i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                )
              )}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Direction</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.direction}
              onChange={(e) =>
                setForm((f) => ({ ...f, direction: e.target.value }))
              }
            >
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Session</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.session}
              onChange={(e) =>
                setForm((f) => ({ ...f, session: e.target.value }))
              }
            >
              {['London', 'New York', 'Asia', 'Overlap'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">
              Stop Distance (pips/points)
            </label>
            <input
              type="number"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.stopDistance}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  stopDistance: Number(e.target.value),
                }))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">R:R Ratio</label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.rrRatio}
              onChange={(e) =>
                setForm((f) => ({ ...f, rrRatio: Number(e.target.value) }))
              }
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-2">
          {[
            { key: 'hasLiquiditySweep' as const, label: 'Liquidity Sweep' },
            { key: 'hasMSS' as const, label: 'Market Structure Shift' },
            { key: 'hasFVG' as const, label: 'Fair Value Gap' },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={form[item.key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [item.key]: e.target.checked }))
                }
                className="w-4 h-4 rounded"
              />
              {item.label}
            </label>
          ))}
        </div>

        <button
          onClick={run}
          className="w-full mt-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium text-sm transition-colors"
        >
          Analisa Setup
        </button>
      </div>

      {result && (
        <div className="bg-slate-800/80 border border-emerald-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-4">
            <GradeBadge grade={result.grade} />
            <div>
              <div className="text-xl font-bold">
                Grade {result.grade} · Score {result.score}/100
              </div>
              <div className="text-sm text-slate-400">
                {result.instrument} {result.direction.toUpperCase()} ·{' '}
                {result.session}
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-900/60 rounded-lg text-sm">
            {result.advice}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-slate-400 mb-1">Recommended Risk</div>
              <div className="font-semibold text-emerald-400">
                {result.recommendedRisk}%
              </div>
            </div>
            <div>
              <div className="text-slate-400 mb-1">Position Size (approx)</div>
              <div className="font-semibold">{result.positionSize}</div>
            </div>
          </div>

          {result.reasons.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1">Alasan Positif</div>
              <ul className="text-sm space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="text-emerald-400">
                    ✓ {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1">Peringatan</div>
              <ul className="text-sm space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-amber-400">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
