import { useState } from 'react'
import { useStore } from '../hooks/useStore'

export default function Learning() {
  const {
    detectedSetups,
    episodes,
    featureWeights,
    modelVersions,
    rsiModelVersion,
    lastRsiSummary,
    recordOutcome,
    runRSI,
  } = useStore()

  const pending = episodes.filter((e) => !e.processed).length
  const [outcomeR, setOutcomeR] = useState<Record<string, string>>({})

  function submitOutcome(setupId: string) {
    const r = Number(outcomeR[setupId])
    if (Number.isNaN(r)) return
    const setup = detectedSetups.find((s) => s.id === setupId)
    recordOutcome(setupId, r, {
      fvgPartial: false,
      rrRatio: 2.5,
      outsideKz: setup?.killZone === 'outside',
    })
    setOutcomeR((o) => ({ ...o, [setupId]: '' }))
  }

  const openSetups = detectedSetups.filter(
    (s) => s.actualR === undefined && (s.decision === 'take' || s.grade === 'A' || s.grade === 'B')
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">RSI — Self Improvement</h2>
        <p className="text-slate-400 text-sm mt-1">
          Model {rsiModelVersion} · Episode: {episodes.length} · Pending RSI: {pending}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          Sistem belajar dari outcome setup (actual R), bukan dari psikologi user.
          ICT Core rules tetap kaku — yang berubah bobot edge.
        </p>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-medium text-emerald-400">Jalankan RSI Update</div>
            <div className="text-xs text-slate-500">
              Minimal 3 episode belum diproses
            </div>
          </div>
          <button
            onClick={() => {
              const msg = runRSI()
              alert(msg)
            }}
            disabled={pending < 3}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              pending >= 3
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            Run RSI ({pending} pending)
          </button>
        </div>
        {lastRsiSummary && (
          <div className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3">
            {lastRsiSummary}
          </div>
        )}
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
        <h3 className="font-medium mb-3">Feature Weights (learned)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {Object.entries(featureWeights).map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between bg-slate-900/50 rounded px-2 py-1.5"
            >
              <span className="text-slate-400">{k}</span>
              <span
                className={
                  v > 1.15
                    ? 'text-emerald-400 font-semibold'
                    : v < 0.85
                      ? 'text-amber-400 font-semibold'
                      : 'text-slate-200'
                }
              >
                {v.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-3">
        <h3 className="font-medium">Record Outcome (untuk setup TAKE)</h3>
        <p className="text-xs text-slate-500">
          Isi actual R setelah trade selesai (mis. 2.1, -1, 0). Ini jadi bahan belajar RSI.
        </p>
        {openSetups.length === 0 ? (
          <p className="text-sm text-slate-500">
            Tidak ada setup terbuka. Analisa dulu di Setup Analyzer (decision TAKE).
          </p>
        ) : (
          openSetups.slice(0, 10).map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 p-3 bg-slate-900/50 rounded-lg text-sm"
            >
              <div className="flex-1 min-w-[140px]">
                <div className="font-medium">
                  {s.instrument} {s.direction} · Grade {s.grade}
                </div>
                <div className="text-xs text-slate-500">
                  {s.setupType} · {s.killZone} · E[R] {s.expectancy}
                </div>
              </div>
              <input
                type="number"
                step="0.1"
                placeholder="Actual R"
                className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
                value={outcomeR[s.id] || ''}
                onChange={(e) =>
                  setOutcomeR((o) => ({ ...o, [s.id]: e.target.value }))
                }
              />
              <button
                onClick={() => submitOutcome(s.id)}
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded text-xs font-medium"
              >
                Save
              </button>
            </div>
          ))
        )}
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
        <h3 className="font-medium mb-3">Episodes ({episodes.length})</h3>
        {episodes.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada episode.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {episodes.slice(0, 30).map((e) => (
              <div
                key={e.id}
                className="flex justify-between text-xs p-2 bg-slate-900/40 rounded"
              >
                <span>
                  {e.instrument} {e.direction} · pred {e.predictedGrade} ·{' '}
                  <span
                    className={
                      e.actualR >= 1 ? 'text-emerald-400' : 'text-red-400'
                    }
                  >
                    actual {e.actualR > 0 ? '+' : ''}
                    {e.actualR}R
                  </span>
                </span>
                <span className="text-slate-500">
                  {e.processed ? 'processed' : 'pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {modelVersions.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
          <h3 className="font-medium mb-3">Model Versions</h3>
          <div className="space-y-2 text-xs">
            {modelVersions.map((m) => (
              <div key={m.version} className="p-2 bg-slate-900/40 rounded">
                <div className="font-medium text-emerald-400">{m.version}</div>
                <div className="text-slate-500">{m.notes}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
