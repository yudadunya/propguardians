import { useState } from 'react'
import { useStore } from '../hooks/useStore'
import { runPhase1Pipeline, createDetectedSetup } from '../lib/agents'
import { KILL_ZONES } from '../lib/ictCore'
import { detectICTPattern, generateDemoCandles } from '../lib/patternDetector'
import { fetchOhlc } from '../lib/marketData'
import type { ICTStructureInput, KillZone, SweepType, SynthesisOutput } from '../types/ict'
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

const defaultForm = {
  instrument: 'XAUUSD',
  timeframe: 'M15',
  direction: 'long' as 'long' | 'short',
  killZone: 'ny_am' as KillZone,
  hasLiquiditySweep: true,
  sweepType: 'ssl' as SweepType,
  hasDisplacement: true,
  hasMSS: true,
  hasFVG: true,
  fvgPartiallyFilled: false,
  inPremium: false,
  inDiscount: true,
  inOTE: true,
  stopDistance: 25,
  rrRatio: 2.5,
}

export default function Analyzer() {
  const { account, personalRules, dailyLog, addAnalysis, addDetectedSetup, featureWeights, rsiModelVersion } = useStore()
  const [form, setForm] = useState(defaultForm)
  const [result, setResult] = useState<SynthesisOutput | null>(null)
  const [scanNotes, setScanNotes] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  async function scanLive() {
    setScanning(true)
    setScanError(null)
    setResult(null)
    try {
      const { candles, sourceSymbol, interval } = await fetchOhlc(
        form.instrument,
        form.timeframe,
        120
      )
      const pattern = detectICTPattern(candles, form.instrument, form.timeframe)
      if (!pattern) {
        setScanNotes(['Scan live: pattern tidak terdeteksi (data kurang)'])
        setScanning(false)
        return
      }
      setForm((f) => ({
        ...f,
        direction: pattern.direction,
        killZone: pattern.killZone,
        hasLiquiditySweep: pattern.hasLiquiditySweep,
        sweepType: pattern.sweepType,
        hasDisplacement: pattern.hasDisplacement,
        hasMSS: pattern.hasMSS,
        hasFVG: pattern.hasFVG,
        fvgPartiallyFilled: pattern.fvgPartiallyFilled,
        inPremium: pattern.inPremium,
        inDiscount: pattern.inDiscount,
        inOTE: pattern.inOTE,
        stopDistance: pattern.stopDistance,
        rrRatio: pattern.rrRatio,
      }))
      setScanNotes([
        `LIVE ${sourceSymbol} ${interval} · ${candles.length} bars (biquote)`,
        ...pattern.notes,
      ])
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Gagal fetch biquote')
      setScanNotes([])
    } finally {
      setScanning(false)
    }
  }

  function scanDemo() {
    const candles = generateDemoCandles(form.instrument)
    // Force NY AM hour for demo high-probability window
    const pattern = detectICTPattern(candles, form.instrument, form.timeframe, 9)
    if (!pattern) {
      setScanNotes(['Scan gagal: data terlalu pendek'])
      return
    }
    setForm((f) => ({
      ...f,
      direction: pattern.direction,
      killZone: pattern.killZone === 'outside' ? 'ny_am' : pattern.killZone,
      hasLiquiditySweep: pattern.hasLiquiditySweep,
      sweepType: pattern.sweepType,
      hasDisplacement: pattern.hasDisplacement,
      hasMSS: pattern.hasMSS,
      hasFVG: pattern.hasFVG,
      fvgPartiallyFilled: pattern.fvgPartiallyFilled,
      inPremium: pattern.inPremium,
      inDiscount: pattern.inDiscount,
      inOTE: pattern.inOTE,
      stopDistance: pattern.stopDistance,
      rrRatio: pattern.rrRatio,
    }))
    setScanNotes(pattern.notes.length ? pattern.notes : ['Pattern detected'])
    setResult(null)
  }

  function run() {
    // AI bias: direction determines sweep type (SSL→long, BSL→short). User never picks sweep manually.
    const inferredSweep: SweepType = !form.hasLiquiditySweep
      ? 'none'
      : form.direction === 'long'
        ? 'ssl'
        : 'bsl'
    const input: ICTStructureInput = {
      ...form,
      sweepType: inferredSweep,
      inDiscount: form.direction === 'long',
      inPremium: form.direction === 'short',
    }
    const synthesis = runPhase1Pipeline(input, account, personalRules, dailyLog, featureWeights)
    setResult(synthesis)

    const detected = createDetectedSetup(input, synthesis)
    addDetectedSetup(detected)

    const legacy: SetupAnalysis = {
      grade: synthesis.grade,
      score: synthesis.combinedScore,
      reasons: synthesis.reasons,
      warnings: synthesis.warnings,
      recommendedRisk: synthesis.risk.recommendedRiskPercent,
      positionSize: synthesis.risk.positionSize,
      advice: synthesis.advice,
      instrument: form.instrument,
      direction: form.direction,
      session: form.killZone,
      timestamp: new Date().toISOString(),
    }
    addAnalysis(legacy)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">ICT Core Analyzer</h2>
        <p className="text-slate-400 text-sm mt-1">
          Phase 6 — Live biquote + Pattern + Multi-Agent + RSI · Model {rsiModelVersion}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          Scan OHLC (demo) mengisi struktur otomatis. Bias/sweep di-infer sistem — bukan input manual.
        </p>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400">Instrument</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.instrument}
              onChange={(e) => setForm((f) => ({ ...f, instrument: e.target.value }))}
            >
              {['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30'].map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Timeframe</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.timeframe}
              onChange={(e) => setForm((f) => ({ ...f, timeframe: e.target.value }))}
            >
              {['M5', 'M15', 'H1', 'H4'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
                    <div>
            <label className="text-xs text-slate-400">Direction (AI Bias)</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.direction}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  direction: e.target.value as 'long' | 'short',
                  inDiscount: e.target.value === 'long',
                  inPremium: e.target.value === 'short',
                  sweepType: e.target.value === 'long' ? 'ssl' : 'bsl',
                }))
              }
            >
              <option value="long">Long (infer SSL sweep)</option>
              <option value="short">Short (infer BSL sweep)</option>
            </select>
            <p className="text-[10px] text-slate-500 mt-1">
              Sweep type tidak dipilih manual — sistem mengunci SSL untuk Long, BSL untuk Short
            </p>
          </div>
          <div>
            <label className="text-xs text-slate-400">Kill Zone</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.killZone}
              onChange={(e) =>
                setForm((f) => ({ ...f, killZone: e.target.value as KillZone }))
              }
            >
              {KILL_ZONES.map((z) => (
                <option key={z.id} value={z.id}>{z.label}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="text-xs text-slate-400">Stop Distance (pips/pts)</label>
            <input
              type="number"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={form.stopDistance}
              onChange={(e) =>
                setForm((f) => ({ ...f, stopDistance: Number(e.target.value) }))
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

        <div className="border-t border-slate-700 pt-4">
          <div className="text-xs text-slate-400 mb-2 uppercase tracking-wider">
            ICT Core Checklist
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(
              [
                ['hasLiquiditySweep', 'Liquidity Sweep'],
                ['hasDisplacement', 'Displacement'],
                ['hasMSS', 'MSS / CHoCH'],
                ['hasFVG', 'Fair Value Gap'],
                ['fvgPartiallyFilled', 'FVG partially filled (weaker)'],
                ['inPremium', 'In Premium'],
                ['inDiscount', 'In Discount'],
                ['inOTE', 'Inside OTE (0.62–0.79)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [key]: e.target.checked }))
                  }
                  className="w-4 h-4 rounded"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <button
            type="button"
            onClick={scanLive}
            disabled={scanning}
            className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            {scanning ? 'Scanning…' : 'Scan Live (biquote)'}
          </button>
          <button
            type="button"
            onClick={scanDemo}
            disabled={scanning}
            className="flex-1 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            Scan Demo
          </button>
          <button
            type="button"
            onClick={run}
            disabled={scanning}
            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            Run Multi-Agent
          </button>
        </div>
        {scanError && (
          <div className="text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-lg p-3">
            {scanError}
          </div>
        )}
        {scanNotes.length > 0 && (
          <div className="text-xs text-sky-300/90 bg-sky-950/30 border border-sky-500/20 rounded-lg p-3 space-y-1">
            <div className="font-medium text-sky-400">Pattern Detector</div>
            {scanNotes.map((n, i) => (
              <div key={i}>· {n}</div>
            ))}
            <div className="text-slate-500 pt-1">Checklist diisi otomatis — klik Run Multi-Agent untuk grade</div>
          </div>
        )}
      </div>

      {result && (
        <div className="bg-slate-800/80 border border-emerald-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-4">
            <GradeBadge grade={result.grade} />
            <div>
              <div className="text-xl font-bold">
                Grade {result.grade} · Combined {result.combinedScore}/100
              </div>
              <div className="text-sm text-slate-400">
                {result.setupType.replace(/_/g, ' ')} · {result.decision.toUpperCase()} ·{' '}
                {result.structure.summary}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Structure {result.structure.structureScore} · Edge {result.edge.edgeScore} · E[R] {result.edge.expectancy}
              </div>
            </div>
          </div>

          <div
            className={`p-3 rounded-lg text-sm ${
              result.decision === 'blocked'
                ? 'bg-red-950/50 border border-red-500/40'
                : result.decision === 'take'
                  ? 'bg-emerald-950/40 border border-emerald-500/30'
                  : 'bg-slate-900/60'
            }`}
          >
            {result.advice}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-slate-400 text-xs">Risk %</div>
              <div className="font-semibold text-emerald-400">
                {result.risk.recommendedRiskPercent}%
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Position Size</div>
              <div className="font-semibold">{result.risk.positionSize}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Sisa Daily DD</div>
              <div className="font-semibold">
                {result.risk.remainingDailyPct.toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-xs">Decision</div>
              <div
                className={`font-semibold uppercase ${
                  result.decision === 'take'
                    ? 'text-emerald-400'
                    : result.decision === 'blocked'
                      ? 'text-red-400'
                      : 'text-amber-400'
                }`}
              >
                {result.decision}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-sky-500/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-sky-400 font-medium">
                Edge Agent (Historical)
              </div>
              <div className="text-xs text-slate-500">
                conf: {result.edge.confidence} · n={result.edge.sampleSize}
              </div>
            </div>
            <div className="text-sm text-slate-300">{result.edge.historicalSummary}</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div>
                <div className="text-xs text-slate-500">WR ≥2R</div>
                <div className="font-semibold text-sky-300">
                  {(result.edge.winrate2R * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Avg R</div>
                <div className="font-semibold">{result.edge.avgR.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Expectancy</div>
                <div className={`font-semibold ${result.edge.expectancy >= 0.4 ? 'text-emerald-400' : result.edge.expectancy >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  {result.edge.expectancy.toFixed(2)}R
                </div>
              </div>
            </div>
            {result.edge.conditionBoosts.length > 0 && (
              <ul className="text-xs space-y-0.5 pt-1">
                {result.edge.conditionBoosts.map((b, i) => (
                  <li key={i} className={b.includes('+') ? 'text-emerald-400' : b.includes('−') || b.includes('-') ? 'text-amber-400' : 'text-slate-400'}>
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={`rounded-xl p-4 space-y-2 border ${
            result.devil.veto
              ? 'bg-red-950/40 border-red-500/40'
              : result.devil.attackCount > 0
                ? 'bg-amber-950/30 border-amber-500/30'
                : 'bg-slate-900/60 border-slate-600/40'
          }`}>
            <div className="flex items-center justify-between">
              <div className={`text-xs uppercase tracking-wider font-medium ${
                result.devil.veto ? 'text-red-400' : result.devil.attackCount > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}>
                Devil&apos;s Advocate
              </div>
              <div className="text-xs text-slate-500">
                {result.devil.attackCount} flags · penalty {result.devil.totalPenalty}
                {result.devil.veto ? ' · VETO' : ''}
              </div>
            </div>
            <div className="text-sm text-slate-300">{result.devil.summary}</div>
            {result.devil.flags.length > 0 && (
              <ul className="text-xs space-y-1 pt-1">
                {result.devil.flags.map((f, i) => (
                  <li key={i} className={
                    f.severity === 'critical' ? 'text-red-400' :
                    f.severity === 'high' ? 'text-orange-400' :
                    f.severity === 'medium' ? 'text-amber-400' : 'text-slate-400'
                  }>
                    [{f.severity}] {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-500 mb-1">Entry</div>
              <div>{result.entryHint}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-500 mb-1">Stop</div>
              <div>{result.stopHint}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-500 mb-1">Target</div>
              <div>{result.targetHint}</div>
            </div>
          </div>

          {result.reasons.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1">Structure Present</div>
              <ul className="text-sm space-y-1">
                {result.reasons.map((r, i) => (
                  <li key={i} className="text-emerald-400">✓ {r}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 mb-1">Missing / Warnings</div>
              <ul className="text-sm space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="text-amber-400">⚠ {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
