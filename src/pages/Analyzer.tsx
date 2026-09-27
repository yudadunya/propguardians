import { useState, useEffect, useRef } from 'react'
import { useStore } from '../hooks/useStore'
import { runPhase1Pipeline, createDetectedSetup } from '../lib/agents'
import { KILL_ZONES } from '../lib/ictCore'
import { detectICTPattern, generateDemoCandles } from '../lib/patternDetector'
import { fetchOhlc } from '../lib/marketData'
import { fetchMultiTf, analyzeMultiTf } from '../lib/multiTf'
import { notifyGrade, ensureNotificationPermission } from '../lib/alerts'
import { getScheduleStatus, formatNyTime, selectAiTimeframe } from '../lib/killZoneSchedule'
import { InlinePrice } from '../components/LivePriceTicker'
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
  const [schedule, setSchedule] = useState(() => getScheduleStatus())
  const [autopilot, setAutopilot] = useState(false)
  const [autoIntervalMin, setAutoIntervalMin] = useState(5)
  const [lastAutoAt, setLastAutoAt] = useState<string | null>(null)
  const analyzeLiveRef = useRef<() => Promise<void>>(async () => {})

  async function analyzeLive() {
    const sched = getScheduleStatus()
    setSchedule(sched)
    setScanning(true)
    setScanError(null)
    setResult(null)
    try {
      await ensureNotificationPermission()
      const { htfCandles, ltfCandles, entryTf, biasTf } = await fetchMultiTf(
        form.instrument
      )
      const multi = analyzeMultiTf(
        form.instrument,
        htfCandles,
        ltfCandles,
        biasTf,
        entryTf
      )
      const pattern = multi.merged
      if (!pattern.hasLiquiditySweep && !pattern.hasFVG) {
        setScanNotes([
          'Analyze Live: structure lemah di multi-TF',
          ...multi.notes,
        ])
        setScanning(false)
        return
      }
      const nextForm = {
        ...form,
        timeframe: entryTf,
        direction: multi.direction,
        killZone: pattern.killZone,
        hasLiquiditySweep: pattern.hasLiquiditySweep,
        sweepType: pattern.sweepType,      // ← use detected sweep type (BSL/SSL)
        hasDisplacement: pattern.hasDisplacement,
        hasMSS: pattern.hasMSS,
        mssStrong: pattern.mssStrong,      // ← hard CHoCH vs inferred
        hasFVG: pattern.hasFVG,
        fvgPartiallyFilled: pattern.fvgPartiallyFilled,
        inPremium: pattern.inPremium,      // ← detected P/D — don't override
        inDiscount: pattern.inDiscount,
        inOTE: pattern.inOTE,
        ote62: pattern.ote62,
        ote79: pattern.ote79,
        stopDistance: pattern.stopDistance,
        rrRatio: pattern.rrRatio,
        sweepExtreme: pattern.sweepExtreme,
        avgAtr: pattern.avgAtr,
      }
      setForm(nextForm)
      setScanNotes([
        `MULTI-TF ${biasTf}+${entryTf} · LTF ${ltfCandles.length} / HTF ${htfCandles.length} bars`,
        `Bias AI: ${multi.direction.toUpperCase()} · aligned: ${multi.aligned ? 'YES' : 'NO'}`,
        ...multi.notes,
      ])

      // Use detected sweep/PD values — no override (AI already computed them correctly)
      const input = { ...nextForm }
      const synthesis = runPhase1Pipeline(
        input,
        account,
        personalRules,
        dailyLog,
        featureWeights
      )
      setResult(synthesis)
      notifyGrade({
        grade: synthesis.grade,
        instrument: nextForm.instrument,
        direction: nextForm.direction,
        decision: synthesis.decision,
        expectancy: synthesis.edge.expectancy,
      })
      const detected = createDetectedSetup(input, synthesis)
      addDetectedSetup(detected)
      addAnalysis({
        grade: synthesis.grade,
        score: synthesis.combinedScore,
        reasons: synthesis.reasons,
        warnings: synthesis.warnings,
        recommendedRisk: synthesis.risk.recommendedRiskPercent,
        positionSize: synthesis.risk.positionSize,
        advice: synthesis.advice,
        instrument: nextForm.instrument,
        direction: nextForm.direction,
        session: nextForm.killZone,
        timestamp: new Date().toISOString(),
      })
    } catch (e) {
      setScanError(e instanceof Error ? e.message : 'Analyze Live gagal')
      setScanNotes([])
    } finally {
      setScanning(false)
    }
  }

  async function scanLive() {
    const sched = getScheduleStatus()
    setSchedule(sched)
    const aiTf = selectAiTimeframe(sched.activeZone, form.instrument)
    setScanning(true)
    setScanError(null)
    setResult(null)
    try {
      const { candles, sourceSymbol, interval } = await fetchOhlc(
        form.instrument,
        aiTf,
        120
      )
      const pattern = detectICTPattern(candles, form.instrument, aiTf)
      if (!pattern) {
        setScanNotes(['Scan live: pattern tidak terdeteksi (data kurang)'])
        setScanning(false)
        return
      }
      setForm((f) => ({
        ...f,
        timeframe: aiTf,
        direction: pattern.direction,
        killZone: pattern.killZone,
        hasLiquiditySweep: pattern.hasLiquiditySweep,
        sweepType: pattern.sweepType,
        hasDisplacement: pattern.hasDisplacement,
        hasMSS: pattern.hasMSS,
        mssStrong: pattern.mssStrong,
        hasFVG: pattern.hasFVG,
        fvgPartiallyFilled: pattern.fvgPartiallyFilled,
        inPremium: pattern.inPremium,
        inDiscount: pattern.inDiscount,
        inOTE: pattern.inOTE,
        ote62: pattern.ote62,
        ote79: pattern.ote79,
        stopDistance: pattern.stopDistance,
        rrRatio: pattern.rrRatio,
        sweepExtreme: pattern.sweepExtreme,
        avgAtr: pattern.avgAtr,
      }))
      setScanNotes([
        `LIVE ${sourceSymbol} ${interval} · ${candles.length} bars (biquote)`,
        `TF AI: ${aiTf}`,
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
    const sched = getScheduleStatus()
    const aiTf = selectAiTimeframe(sched.activeZone, form.instrument)
    const candles = generateDemoCandles(form.instrument)
    // Force NY AM hour for demo high-probability window
    const pattern = detectICTPattern(candles, form.instrument, aiTf, 9)
    if (!pattern) {
      setScanNotes(['Scan gagal: data terlalu pendek'])
      return
    }
    setForm((f) => ({
      ...f,
      timeframe: aiTf,
      direction: pattern.direction,
      killZone: pattern.killZone === 'outside' ? 'ny_am' : pattern.killZone,
      hasLiquiditySweep: pattern.hasLiquiditySweep,
      sweepType: pattern.sweepType,
      hasDisplacement: pattern.hasDisplacement,
      hasMSS: pattern.hasMSS,
      mssStrong: pattern.mssStrong,
      hasFVG: pattern.hasFVG,
      fvgPartiallyFilled: pattern.fvgPartiallyFilled,
      inPremium: pattern.inPremium,
      inDiscount: pattern.inDiscount,
      inOTE: pattern.inOTE,
      ote62: pattern.ote62,
      ote79: pattern.ote79,
      stopDistance: pattern.stopDistance,
      rrRatio: pattern.rrRatio,
      sweepExtreme: pattern.sweepExtreme,
      avgAtr: pattern.avgAtr,
    }))
    setScanNotes(
      pattern.notes.length
        ? [`TF AI: ${aiTf}`, ...pattern.notes]
        : [`TF AI: ${aiTf}`, 'Pattern detected']
    )
    setResult(null)
  }

  function run() {
    // Manual run: infer sweep from direction (user-controlled form)
    // For AI scans, sweepType is already set correctly by patternDetector.
    const inferredSweep: SweepType =
      form.sweepType && form.sweepType !== 'none'
        ? form.sweepType  // keep AI-detected sweep type
        : !form.hasLiquiditySweep
          ? 'none'
          : form.direction === 'long' ? 'ssl' : 'bsl'
    const input: ICTStructureInput = {
      ...form,
      sweepType: inferredSweep,
      // For manual form: force PD based on direction.
      // For AI-scanned form: inDiscount/inPremium already correct from detector.
      inDiscount: form.inDiscount || form.direction === 'long',
      inPremium:  form.inPremium  || form.direction === 'short',
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

  // Keep analyzeLive stable for interval
  analyzeLiveRef.current = analyzeLive

  // Refresh ICT clock every 30s
  useEffect(() => {
    const t = setInterval(() => setSchedule(getScheduleStatus()), 30000)
    return () => clearInterval(t)
  }, [])

  // Autopilot: when enabled + in kill zone / pre-window, run Analyze Live on interval
  useEffect(() => {
    if (!autopilot) return
    const tick = () => {
      const s = getScheduleStatus()
      setSchedule(s)
      if (!s.shouldWork) return
      if (scanning) return
      void analyzeLiveRef.current()
      setLastAutoAt(new Date().toLocaleTimeString())
    }
    // run once when entering autopilot if should work
    const s0 = getScheduleStatus()
    if (s0.shouldWork) {
      void analyzeLiveRef.current()
      setLastAutoAt(new Date().toLocaleTimeString())
    }
    const ms = Math.max(1, autoIntervalMin) * 60 * 1000
    const id = setInterval(tick, ms)
    return () => clearInterval(id)
  }, [autopilot, autoIntervalMin])

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">ICT Core Analyzer</h2>
        <p className="text-slate-400 text-sm mt-1">
          Phase 9–11 · Multi-TF + Backtest + Alerts · Model {rsiModelVersion}
        </p>
        <p className="text-slate-500 text-xs mt-1">
          ICT Kill Zone menentukan kapan AI bekerja. Analyze Live = scan biquote + multi-agent (bias penuh AI).
        </p>
      </div>

      <div className={`rounded-xl p-4 border text-sm ${
        schedule.inKillZone
          ? 'bg-emerald-950/40 border-emerald-500/40'
          : schedule.shouldWork
            ? 'bg-amber-950/30 border-amber-500/30'
            : 'bg-slate-800/60 border-slate-700'
      }`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-medium text-slate-200">
              Jadwal ICT · {formatNyTime()}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{schedule.message}</div>
          </div>
          <div className={`text-xs px-2 py-1 rounded-lg font-medium ${
            schedule.inKillZone
              ? 'bg-emerald-600/30 text-emerald-300'
              : schedule.shouldWork
                ? 'bg-amber-600/30 text-amber-300'
                : 'bg-slate-700 text-slate-400'
          }`}>
            {schedule.inKillZone ? 'KILL ZONE AKTIF' : schedule.shouldWork ? 'PRE-WINDOW' : 'STANDBY'}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-700/80 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autopilot}
              onChange={(e) => setAutopilot(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="font-medium text-slate-200">Autopilot Kill Zone</span>
          </label>
          <span className="text-slate-500">tiap</span>
          <select
            value={autoIntervalMin}
            onChange={(e) => setAutoIntervalMin(Number(e.target.value))}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1"
            disabled={!autopilot}
          >
            <option value={3}>3 menit</option>
            <option value={5}>5 menit</option>
            <option value={10}>10 menit</option>
            <option value={15}>15 menit</option>
          </select>
          <span className="text-slate-500">
            {autopilot
              ? schedule.shouldWork
                ? 'AI scan otomatis saat jendela ICT'
                : 'Menunggu kill zone berikutnya…'
              : 'Off — klik Analyze Live manual'}
          </span>
          {lastAutoAt && autopilot && (
            <span className="text-emerald-500/80">Last auto: {lastAutoAt}</span>
          )}
        </div>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400">Instrument</label>
              <InlinePrice symbol={form.instrument} />
            </div>
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
            <label className="text-xs text-slate-400">Timeframe (AI only)</label>
            <div className="w-full mt-1 bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm flex justify-between items-center">
              <span className="font-semibold text-sky-300">{form.timeframe}</span>
              <span className="text-[10px] text-slate-500">auto ICT</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              AI pilih TF: Silver Bullet→M5, London/NY AM→M15
            </p>
          </div>
                    <div>
            <label className="text-xs text-slate-400">Bias (AI only)</label>
            <div className="w-full mt-1 bg-slate-900/80 border border-slate-600 rounded-lg px-3 py-2 text-sm flex items-center justify-between">
              <span className={form.direction === 'long' ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                {form.direction === 'long' ? 'LONG' : 'SHORT'}
              </span>
              <span className="text-[10px] text-slate-500">
                {form.direction === 'long' ? 'SSL inferred' : 'BSL inferred'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Tidak bisa diubah manual — bias dari Pattern Detector / Analyze Live
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
            onClick={analyzeLive}
            disabled={scanning}
            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            {scanning ? 'Analyzing…' : 'Analyze Live (AI)'}
          </button>
          <button
            type="button"
            onClick={scanLive}
            disabled={scanning}
            className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            {scanning ? 'Scanning…' : 'Scan Only'}
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
