/**
 * Learning.tsx — RSI Learning + Backtest Engine v2 UI
 */

import { useState, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { runMultiBacktest, type MultiBtResult, type BtBreakdown, type BtResult } from '../lib/backtestEngine'
import { ensureNotificationPermission } from '../lib/alerts'

/* ─── Small helpers ─── */

function pct(n: number) { return `${(n * 100).toFixed(0)}%` }
function r2(n: number)  { return n.toFixed(2) }

function WRBar({ value, label }: { value: number; label: string }) {
  const color = value >= 0.60 ? 'bg-emerald-500' : value >= 0.45 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={value >= 0.60 ? 'text-emerald-400' : value >= 0.45 ? 'text-amber-400' : 'text-red-400'}>
          {pct(value)}
        </span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  )
}

function BreakdownCard({ bd }: { bd: BtBreakdown }) {
  if (bd.n === 0) return (
    <div className="bg-slate-900/40 rounded-lg p-3 text-xs text-slate-600 text-center">
      {bd.label} — no data
    </div>
  )
  return (
    <div className="bg-slate-900/40 rounded-lg p-3 space-y-2">
      <div className="flex justify-between">
        <span className="text-xs font-semibold text-slate-300">{bd.label}</span>
        <span className="text-xs text-slate-500">n={bd.n}</span>
      </div>
      <WRBar value={bd.wr2R} label="WR@2R" />
      <WRBar value={bd.wr3R} label="WR@3R" />
      <div className="grid grid-cols-2 gap-1 text-xs">
        <span className="text-slate-500">E[R]</span>
        <span className={`text-right font-mono ${bd.expectancy >= 0.3 ? 'text-emerald-400' : bd.expectancy >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
          {r2(bd.expectancy)}R
        </span>
        <span className="text-slate-500">Max loss streak</span>
        <span className="text-right font-mono text-slate-300">{bd.maxConsecLoss}</span>
      </div>
    </div>
  )
}

function InstrumentResult({ result }: { result: BtResult }) {
  const [open, setOpen] = useState(false)
  const { overall, calibrated } = result
  const color = overall.wr2R >= 0.55 ? 'border-emerald-600/40' : overall.wr2R >= 0.45 ? 'border-amber-600/40' : 'border-red-600/40'

  return (
    <div className={`bg-slate-800/60 border ${color} rounded-xl overflow-hidden`}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-200">{result.instrument}</span>
          <span className="text-xs text-slate-500">{result.bars} bars · {result.trades.length} trades</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className={`text-sm font-bold ${overall.wr2R >= 0.55 ? 'text-emerald-400' : overall.wr2R >= 0.45 ? 'text-amber-400' : 'text-red-400'}`}>
              WR@2R {pct(overall.wr2R)}
            </div>
            <div className="text-xs text-slate-500">E[R] {r2(overall.expectancy)}</div>
          </div>
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-700/50 pt-4">
          {/* Win rates */}
          <div className="space-y-2">
            <WRBar value={overall.wr1R} label="Win Rate @1R" />
            <WRBar value={overall.wr2R} label="Win Rate @2R" />
            <WRBar value={overall.wr3R} label="Win Rate @3R" />
          </div>

          {/* By Kill Zone */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">By Kill Zone</h4>
            <div className="grid grid-cols-2 gap-2">
              {['london', 'ny_am', 'silver_bullet', 'ny_pm'].map(kz => (
                <BreakdownCard key={kz} bd={result.byKillZone[kz] ?? { label: kz, n: 0, wr1R: 0, wr2R: 0, wr3R: 0, avgR: 0, expectancy: 0, maxConsecLoss: 0 }} />
              ))}
            </div>
          </div>

          {/* OTE vs no OTE */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">OTE 62–79% Impact</h4>
            <div className="grid grid-cols-2 gap-2">
              <BreakdownCard bd={result.byOTE.withOTE} />
              <BreakdownCard bd={result.byOTE.withoutOTE} />
            </div>
            {result.calibrated.oteEdge !== 0 && (
              <div className="text-xs mt-1 text-center text-emerald-400">
                OTE edge: +{(calibrated.oteEdge * 100).toFixed(0)}%pts WR@2R
              </div>
            )}
          </div>

          {/* Key Level vs Random */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Key Level Sweep (PDH/PDL)</h4>
            <div className="grid grid-cols-2 gap-2">
              <BreakdownCard bd={result.byKeyLevel.keyLevel} />
              <BreakdownCard bd={result.byKeyLevel.random} />
            </div>
            {calibrated.keyLevelEdge !== 0 && (
              <div className="text-xs mt-1 text-center text-emerald-400">
                Key level edge: +{(calibrated.keyLevelEdge * 100).toFixed(0)}%pts WR@2R
              </div>
            )}
          </div>

          {/* Hard CHoCH vs Inferred */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">MSS Quality</h4>
            <div className="grid grid-cols-2 gap-2">
              <BreakdownCard bd={result.byMSS.hardCHoCH} />
              <BreakdownCard bd={result.byMSS.inferred} />
            </div>
          </div>

          {/* Top-Down */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Top-Down Bias</h4>
            <div className="grid grid-cols-2 gap-2">
              <BreakdownCard bd={result.byTopDown.aligned} />
              <BreakdownCard bd={result.byTopDown.partial} />
            </div>
          </div>

          {/* Stats summary */}
          <div className="bg-slate-900/60 rounded-lg p-3 text-xs space-y-1">
            <div className="font-semibold text-slate-300 mb-1">Calibrated Stats</div>
            <div className="flex justify-between">
              <span className="text-slate-500">Best Kill Zone</span>
              <span className="text-emerald-400 font-medium">{calibrated.bestKillZone.replace('_', ' ')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Worst Kill Zone</span>
              <span className="text-red-400">{calibrated.worstKillZone.replace('_', ' ')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Sample Size</span>
              <span className="text-slate-200">{calibrated.sampleSize} trades</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════ */

const DEFAULT_INSTRUMENTS = ['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD']

export default function Learning() {
  const {
    detectedSetups, episodes, featureWeights,
    modelVersions, rsiModelVersion, lastRsiSummary,
    recordOutcome, runRSI, ingestBacktest,
  } = useStore()

  const pending    = episodes.filter(e => !e.processed).length
  const [outcomeR, setOutcomeR] = useState<Record<string, string>>({})

  /* Backtest state */
  const [instruments, setInstruments] = useState(DEFAULT_INSTRUMENTS)
  const [running,     setRunning]     = useState(false)
  const [progress,    setProgress]    = useState<string[]>([])
  const [btResult,    setBtResult]    = useState<MultiBtResult | null>(null)
  const [applied,     setApplied]     = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)

  function toggleInstrument(sym: string) {
    setInstruments(cur =>
      cur.includes(sym) ? cur.filter(s => s !== sym) : [...cur, sym]
    )
  }

  async function handleRunBacktest() {
    setRunning(true)
    setProgress([])
    setBtResult(null)
    setApplied(false)

    try {
      const result = await runMultiBacktest(
        instruments,
        (msg) => {
          setProgress(p => {
            const next = [...p, msg]
            setTimeout(() => progressRef.current?.scrollTo(0, 9999), 50)
            return next
          })
        },
      )
      setBtResult(result)
      setProgress(p => [...p, '✅ Backtest selesai!'])
    } catch (err) {
      setProgress(p => [...p, `❌ Error: ${err instanceof Error ? err.message : String(err)}`])
    } finally {
      setRunning(false)
    }
  }

  function handleApplyCalibration() {
    if (!btResult) return
    const msg = ingestBacktest([], btResult.summary)
    setApplied(true)
    alert(msg || 'Kalibrasi diterapkan ke RSI Learning')
  }

  function submitOutcome(setupId: string) {
    const r = Number(outcomeR[setupId])
    if (Number.isNaN(r)) return
    const setup = detectedSetups.find(s => s.id === setupId)
    recordOutcome(setupId, r, {
      fvgPartial:  false,
      rrRatio:     2.5,
      outsideKz:   setup?.killZone === 'outside',
    })
    setOutcomeR(o => ({ ...o, [setupId]: '' }))
  }

  const openSetups = detectedSetups.filter(
    s => s.actualR === undefined && (s.decision === 'take' || s.grade === 'A' || s.grade === 'B')
  )

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">Backtest + RSI Learning</h2>
        <p className="text-slate-400 text-sm mt-1">
          Model {rsiModelVersion} · Episodes {episodes.length} · Pending {pending}
        </p>
      </div>

      {/* ══ Backtest Engine v2 ══ */}
      <div className="bg-slate-800/80 border border-violet-500/30 rounded-xl p-5 space-y-4">
        <div>
          <div className="font-medium text-violet-300 text-lg">🔬 Backtest Engine v2</div>
          <p className="text-xs text-slate-500 mt-1">
            Fetch H1 historis → walk-forward ICT scan → Grade A/B only →
            FVG pullback entry → simulasi R → statistik akurat per Kill Zone / OTE / Key Level
          </p>
        </div>

        {/* Instrument selector */}
        <div>
          <div className="text-xs text-slate-400 mb-1">Instrumen</div>
          <div className="flex flex-wrap gap-2">
            {['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY'].map(sym => (
              <button
                key={sym}
                onClick={() => toggleInstrument(sym)}
                disabled={running}
                className={`px-3 py-1 rounded-lg text-xs font-mono border transition-colors ${
                  instruments.includes(sym)
                    ? 'bg-violet-700/30 border-violet-500 text-violet-300'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                }`}
              >
                {sym}
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={handleRunBacktest}
          disabled={running || instruments.length === 0}
          className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40
                     rounded-xl font-medium transition-colors text-sm"
        >
          {running ? '⏳ Menjalankan backtest…' : `⚡ Jalankan Backtest (${instruments.join(', ')})`}
        </button>

        {/* Progress log */}
        {progress.length > 0 && (
          <div
            ref={progressRef}
            className="bg-slate-900/60 rounded-lg p-3 max-h-36 overflow-y-auto text-xs
                       text-slate-400 space-y-0.5 font-mono"
          >
            {progress.map((p, i) => <div key={i}>{p}</div>)}
          </div>
        )}
      </div>

      {/* ══ Results ══ */}
      {btResult && (
        <div className="space-y-4">
          {/* Aggregate */}
          <div className="bg-slate-800/80 border border-emerald-600/30 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-semibold text-emerald-400">📊 Aggregate Result</div>
                <div className="text-xs text-slate-500">{btResult.totalTrades} total trades · {btResult.results.length} instruments</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-white">{pct(btResult.aggregate.wr2R)}</div>
                <div className="text-xs text-slate-400">WR@2R</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center text-xs">
              {[
                { label: 'WR@1R', val: pct(btResult.aggregate.wr1R) },
                { label: 'WR@2R', val: pct(btResult.aggregate.wr2R) },
                { label: 'WR@3R', val: pct(btResult.aggregate.wr3R) },
                { label: 'Avg R', val: r2(btResult.aggregate.avgR) + 'R' },
                { label: 'E[R]',  val: r2(btResult.aggregate.expectancy) + 'R' },
                { label: 'Max loss streak', val: String(btResult.aggregate.maxConsecLoss) },
              ].map((s, i) => (
                <div key={i} className="bg-slate-900/40 rounded-lg py-2">
                  <div className="text-slate-500">{s.label}</div>
                  <div className="font-bold text-slate-100 mt-0.5">{s.val}</div>
                </div>
              ))}
            </div>

            {/* Apply calibration */}
            <button
              onClick={handleApplyCalibration}
              disabled={applied}
              className="mt-4 w-full py-2 bg-emerald-700/30 hover:bg-emerald-700/50
                         disabled:opacity-40 border border-emerald-600/40
                         rounded-lg text-sm text-emerald-300 transition-colors"
            >
              {applied ? '✅ Kalibrasi diterapkan' : '🎯 Terapkan ke RSI Learning'}
            </button>
          </div>

          {/* Per instrument */}
          <div className="space-y-3">
            <div className="text-sm font-semibold text-slate-300">Per Instrumen</div>
            {btResult.results.map(r => (
              <InstrumentResult key={r.instrument} result={r} />
            ))}
          </div>

          {/* What this means */}
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-xs text-slate-400 space-y-1">
            <div className="font-semibold text-slate-300 mb-2">📖 Cara Baca Hasil</div>
            <div>• <b>WR@2R ≥ 55%</b> → setup ini profitable secara statistik</div>
            <div>• <b>E[R] ≥ 0.3</b> → setiap trade average menghasilkan 0.3R</div>
            <div>• <b>OTE edge positif</b> → selalu tunggu pullback ke OTE sebelum entry</div>
            <div>• <b>Key level edge positif</b> → prioritaskan sweep di PDH/PDL/PWH/PWL</div>
            <div>• <b>Max loss streak</b> → sizing down setelah consecutive losses sebanyak ini</div>
          </div>
        </div>
      )}

      {/* ══ RSI Learning ══ */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-medium text-emerald-400">🧠 RSI Weight Update</div>
            <div className="text-xs text-slate-500">Minimal 3 episode pending · Episodes: {episodes.length}</div>
          </div>
          <button
            onClick={() => alert(runRSI())}
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
          <div className="text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3 whitespace-pre-wrap text-xs">
            {lastRsiSummary}
          </div>
        )}
      </div>

      {/* ══ Feature Weights ══ */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
        <h3 className="font-medium mb-3">Feature Weights (RSI-Learned)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {Object.entries(featureWeights).map(([k, v]) => {
            const num = Number(v)
            return (
              <div key={k} className="flex justify-between bg-slate-900/50 rounded px-2 py-1.5">
                <span className="text-slate-400">{k}</span>
                <span className={
                  num > 1.15 ? 'text-emerald-400 font-semibold' :
                  num < 0.85 ? 'text-amber-400 font-semibold' : 'text-slate-200'
                }>
                  {num.toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Nilai &gt;1.15 = feature ini lebih prediktif dari baseline. &lt;0.85 = kurang reliabel.
          Diupdate setiap Run RSI dari episode hasil trading nyata.
        </p>
      </div>

      {/* ══ Record Live Outcomes ══ */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-3">
        <h3 className="font-medium">Record Outcome (Live Trades)</h3>
        <p className="text-xs text-slate-500">
          Isi actual R setelah trade selesai → feed ke RSI Learning → weights makin akurat.
        </p>
        {openSetups.length === 0 ? (
          <p className="text-sm text-slate-500">Tidak ada setup Grade A/B terbuka.</p>
        ) : (
          openSetups.slice(0, 10).map(s => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 p-3 bg-slate-900/50 rounded-lg text-sm">
              <div className="flex-1 min-w-[140px]">
                <div className="font-medium">
                  {s.instrument} {s.direction.toUpperCase()} ·{' '}
                  <span className={
                    s.grade === 'A' ? 'text-emerald-400' :
                    s.grade === 'B' ? 'text-sky-400' : 'text-slate-400'
                  }>Grade {s.grade}</span>
                </div>
                <div className="text-xs text-slate-500">{s.setupType} · {s.killZone}</div>
              </div>
              <input
                type="number" step="0.1" placeholder="e.g. 2.1 atau -1"
                className="w-28 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm"
                value={outcomeR[s.id] || ''}
                onChange={e => setOutcomeR(o => ({ ...o, [s.id]: e.target.value }))}
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

      {/* ══ Notifications ══ */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-3">
        <div className="font-medium">🔔 Browser Notifications</div>
        <p className="text-xs text-slate-500">
          Grade A/B setup akan memunculkan notifikasi browser saat Analyze Live dijalankan.
        </p>
        <button
          onClick={() => void ensureNotificationPermission().then(
            ok => alert(ok ? '✅ Notifikasi diizinkan' : '❌ Notifikasi ditolak')
          )}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm"
        >
          Enable Notifications
        </button>
      </div>

      {/* ══ Episodes log ══ */}
      {episodes.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
          <h3 className="font-medium mb-3">Episodes ({episodes.length})</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {episodes.slice(0, 50).map(e => (
              <div key={e.id} className="flex justify-between text-xs p-2 bg-slate-900/40 rounded">
                <span className="text-slate-400">{e.instrument} {e.direction}</span>
                <span className={e.actualR >= 2 ? 'text-emerald-400' : e.actualR >= 0 ? 'text-amber-400' : 'text-red-400'}>
                  {e.actualR > 0 ? '+' : ''}{e.actualR}R
                </span>
                <span className="text-slate-600">{e.processed ? 'processed' : 'pending'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modelVersions.length > 0 && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5">
          <h3 className="font-medium mb-3">Model Versions</h3>
          {modelVersions.slice(0, 5).map(m => (
            <div key={m.version} className="p-2 bg-slate-900/40 rounded text-xs mb-2">
              <div className="font-medium text-violet-400">{m.version}</div>
              <div className="text-slate-500">{m.notes}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
