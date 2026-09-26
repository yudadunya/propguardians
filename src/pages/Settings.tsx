import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../hooks/useStore'
import { testBotToken, sendTestMessage } from '../lib/telegramAlert'
import { autoScanner, type ScannerStatus } from '../lib/autoScanner'
import { sendSetupAlert } from '../lib/telegramAlert'

const INSTRUMENTS_ALL = ['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30']
const INTERVALS = [5, 10, 15, 30] as const

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs text-slate-400">{children}</label>
}

function Input({ value, onChange, type = 'text', placeholder = '', step }: {
  value: string | number
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  step?: string
}) {
  return (
    <input
      type={type}
      step={step}
      placeholder={placeholder}
      className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  )
}

function Toggle({ enabled, onToggle, label }: {
  enabled: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
        enabled
          ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
          : 'bg-slate-800 border-slate-700 text-slate-400'
      }`}
    >
      <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      {label}
    </button>
  )
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="w-2 h-2 rounded-full bg-slate-500" />
  return <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
}

/* ══════════════════════════════════════════════════════════ */

export default function Settings() {
  const {
    account, personalRules, telegramConfig, scannerConfig,
    updateAccount, updatePersonal, updateTelegram, updateScanner,
    resetAll,
  } = useStore()

  /* ── Telegram test state ── */
  const [tokenStatus, setTokenStatus] = useState<{ ok: boolean; name?: string; error?: string } | null>(null)
  const [testingToken, setTestingToken] = useState(false)
  const [testMsgStatus, setTestMsgStatus] = useState<{ ok: boolean; error?: string } | null>(null)
  const [sendingTest, setSendingTest] = useState(false)

  /* ── Scanner status ── */
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus>(autoScanner.getStatus())
  const [scanningNow, setScanningNow] = useState(false)

  /* ── Wire up auto-scanner whenever config changes ── */
  const startScanner = useCallback(() => {
    if (!scannerConfig.enabled) { autoScanner.stop(); return }
    autoScanner.start(
      { ...scannerConfig, alertGrades: telegramConfig.alertGrades },
      () => {
        const s = useStore.getState()
        return {
          account:        s.account,
          personalRules:  s.personalRules,
          dailyLog:       s.dailyLog,
          featureWeights: s.featureWeights,
        }
      },
      async (result) => {
        // Save to store
        const s = useStore.getState()
        s.addDetectedSetup(
          (await import('../lib/agents')).createDetectedSetup(
            { ...result.pattern },
            result.synthesis,
          )
        )
        // Send Telegram
        if (telegramConfig.enabled) {
          await sendSetupAlert(
            telegramConfig,
            result.synthesis,
            result.pattern,
            s.account.currentBalance,
          )
        }
      },
      (status) => setScannerStatus({ ...status }),
    )
  }, [scannerConfig, telegramConfig])

  useEffect(() => { startScanner() }, [startScanner])

  /* ── Handlers ── */
  async function handleTestToken() {
    setTestingToken(true)
    setTokenStatus(null)
    const res = await testBotToken(telegramConfig.botToken)
    setTokenStatus(res)
    setTestingToken(false)
  }

  async function handleSendTest() {
    setSendingTest(true)
    setTestMsgStatus(null)
    const res = await sendTestMessage(telegramConfig)
    setTestMsgStatus(res)
    setSendingTest(false)
  }

  async function handleScanNow() {
    setScanningNow(true)
    const results = await autoScanner.scanNow(
      { ...scannerConfig, alertGrades: telegramConfig.alertGrades },
      () => {
        const s = useStore.getState()
        return {
          account:        s.account,
          personalRules:  s.personalRules,
          dailyLog:       s.dailyLog,
          featureWeights: s.featureWeights,
        }
      },
    )
    // Send alerts for Grade A/B results
    for (const r of results) {
      if (r.alertSent && telegramConfig.enabled) {
        await sendSetupAlert(
          telegramConfig,
          r.synthesis,
          r.pattern,
          account.currentBalance,
        )
      }
    }
    setScannerStatus(autoScanner.getStatus())
    setScanningNow(false)
  }

  function toggleInstrument(inst: string) {
    const cur = scannerConfig.instruments
    updateScanner({
      instruments: cur.includes(inst)
        ? cur.filter(i => i !== inst)
        : [...cur, inst],
    })
  }

  function handleReset() {
    if (confirm('Reset seluruh data akun & trade history?')) resetAll()
  }

  /* ═══════════════════════════════════════════════════ RENDER */
  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">Account & Settings</h2>

      {/* ── Prop Firm Account ── */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-emerald-400">Prop Firm Account</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Firm Name</Label>
            <Input value={account.firmName} onChange={v => updateAccount('firmName', v)} />
          </div>
          <div>
            <Label>Account Size ($)</Label>
            <Input type="number" value={account.accountSize}
              onChange={v => updateAccount('accountSize', Number(v))} />
          </div>
          <div>
            <Label>Max Daily DD (%)</Label>
            <Input type="number" step="0.1" value={account.maxDailyDD}
              onChange={v => updateAccount('maxDailyDD', Number(v))} />
          </div>
          <div>
            <Label>Max Overall DD (%)</Label>
            <Input type="number" step="0.1" value={account.maxOverallDD}
              onChange={v => updateAccount('maxOverallDD', Number(v))} />
          </div>
          <div>
            <Label>Current Balance ($)</Label>
            <Input type="number" value={account.currentBalance}
              onChange={v => updateAccount('currentBalance', Number(v))} />
          </div>
          <div>
            <Label>Mode</Label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={String(account.isChallenge)}
              onChange={e => updateAccount('isChallenge', e.target.value === 'true')}
            >
              <option value="true">Challenge / Evaluation</option>
              <option value="false">Funded Account</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Personal Rules ── */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-emerald-400">Personal Risk Rules</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Risk per Trade (%)</Label>
            <Input type="number" step="0.05" value={personalRules.riskPerTrade}
              onChange={v => updatePersonal('riskPerTrade', Number(v))} />
          </div>
          <div>
            <Label>Personal Daily Limit (%)</Label>
            <Input type="number" step="0.1" value={personalRules.personalDailyLimit}
              onChange={v => updatePersonal('personalDailyLimit', Number(v))} />
          </div>
          <div>
            <Label>Max Consecutive Loss</Label>
            <Input type="number" value={personalRules.maxConsecutiveLoss}
              onChange={v => updatePersonal('maxConsecutiveLoss', Number(v))} />
          </div>
          <div>
            <Label>Max Trades per Day</Label>
            <Input type="number" value={personalRules.maxTradesPerDay}
              onChange={v => updatePersonal('maxTradesPerDay', Number(v))} />
          </div>
        </div>
      </div>

      {/* ── Telegram Alerts ── */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-emerald-400">🤖 Telegram Alerts</h3>
          <Toggle
            enabled={telegramConfig.enabled}
            onToggle={() => updateTelegram({ enabled: !telegramConfig.enabled })}
            label={telegramConfig.enabled ? 'Aktif' : 'Nonaktif'}
          />
        </div>

        <div className="text-xs text-slate-500 bg-slate-900/60 rounded-lg px-3 py-2 leading-relaxed">
          <b className="text-slate-400">Setup:</b> Buat bot via <code>@BotFather</code> → dapat TOKEN.
          Kirim /start ke bot → dapatkan CHAT_ID via
          <code> api.telegram.org/bot&#123;TOKEN&#125;/getUpdates</code>
        </div>

        <div className="space-y-3">
          {/* Bot Token */}
          <div>
            <Label>Bot Token</Label>
            <div className="flex gap-2 mt-1">
              <input
                type="password"
                placeholder="123456789:ABCdef..."
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
                value={telegramConfig.botToken}
                onChange={e => {
                  updateTelegram({ botToken: e.target.value })
                  setTokenStatus(null)
                }}
              />
              <button
                onClick={handleTestToken}
                disabled={testingToken || !telegramConfig.botToken}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40
                           rounded-lg text-xs whitespace-nowrap transition-colors"
              >
                {testingToken ? 'Checking…' : 'Verify'}
              </button>
            </div>
            {tokenStatus && (
              <div className={`flex items-center gap-1.5 mt-1 text-xs ${tokenStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                <StatusDot ok={tokenStatus.ok} />
                {tokenStatus.ok
                  ? `Bot verified: @${tokenStatus.name}`
                  : tokenStatus.error}
              </div>
            )}
          </div>

          {/* Chat ID */}
          <div>
            <Label>Chat ID</Label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                placeholder="-100123456789 atau 123456789"
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
                value={telegramConfig.chatId}
                onChange={e => {
                  updateTelegram({ chatId: e.target.value })
                  setTestMsgStatus(null)
                }}
              />
              <button
                onClick={handleSendTest}
                disabled={sendingTest || !telegramConfig.botToken || !telegramConfig.chatId}
                className="px-3 py-2 bg-emerald-700/40 hover:bg-emerald-700/60 disabled:opacity-40
                           border border-emerald-600/40 rounded-lg text-xs text-emerald-300
                           whitespace-nowrap transition-colors"
              >
                {sendingTest ? 'Sending…' : 'Test Kirim'}
              </button>
            </div>
            {testMsgStatus && (
              <div className={`flex items-center gap-1.5 mt-1 text-xs ${testMsgStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                <StatusDot ok={testMsgStatus.ok} />
                {testMsgStatus.ok ? 'Pesan test berhasil dikirim ✓' : testMsgStatus.error}
              </div>
            )}
          </div>

          {/* Alert Grades */}
          <div>
            <Label>Kirim alert untuk Grade</Label>
            <div className="flex gap-2 mt-1">
              {(['A', 'B'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => {
                    const cur = telegramConfig.alertGrades
                    updateTelegram({
                      alertGrades: cur.includes(g)
                        ? cur.filter(x => x !== g)
                        : [...cur, g],
                    })
                  }}
                  className={`px-4 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                    telegramConfig.alertGrades.includes(g)
                      ? g === 'A'
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                        : 'bg-sky-600/30 border-sky-500 text-sky-300'
                      : 'bg-slate-800 border-slate-600 text-slate-500'
                  }`}
                >
                  Grade {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Auto Scanner ── */}
      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-emerald-400">⚡ Auto Scanner</h3>
          <Toggle
            enabled={scannerConfig.enabled}
            onToggle={() => updateScanner({ enabled: !scannerConfig.enabled })}
            label={scannerConfig.enabled ? 'Running' : 'Stopped'}
          />
        </div>

        {/* Scanner Status */}
        <div className="bg-slate-900/60 rounded-lg p-3 space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${scannerStatus.running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className={scannerStatus.running ? 'text-emerald-400' : 'text-slate-500'}>
              {scannerStatus.running ? 'Scanner aktif' : 'Scanner berhenti'}
            </span>
            <span className="ml-auto text-slate-600">
              Scan #{scannerStatus.scanCount} · Alert #{scannerStatus.alertCount}
            </span>
          </div>
          {scannerStatus.lastScanAt && (
            <div className="text-slate-500">
              Last scan: {new Date(scannerStatus.lastScanAt).toLocaleTimeString()}
              {scannerStatus.nextScanAt && ` · Next: ${new Date(scannerStatus.nextScanAt).toLocaleTimeString()}`}
            </div>
          )}
          {scannerStatus.lastError && (
            <div className="text-yellow-500">⚠ {scannerStatus.lastError}</div>
          )}
        </div>

        {/* Instruments */}
        <div>
          <Label>Instrumen yang di-scan</Label>
          <div className="flex flex-wrap gap-2 mt-1">
            {INSTRUMENTS_ALL.map(inst => (
              <button
                key={inst}
                onClick={() => toggleInstrument(inst)}
                className={`px-3 py-1 rounded-lg text-xs font-mono border transition-colors ${
                  scannerConfig.instruments.includes(inst)
                    ? 'bg-emerald-700/30 border-emerald-600 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                }`}
              >
                {inst}
              </button>
            ))}
          </div>
        </div>

        {/* Interval */}
        <div>
          <Label>Interval scan</Label>
          <div className="flex gap-2 mt-1">
            {INTERVALS.map(n => (
              <button
                key={n}
                onClick={() => updateScanner({ intervalMinutes: n })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  scannerConfig.intervalMinutes === n
                    ? 'bg-emerald-700/30 border-emerald-600 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                }`}
              >
                {n}m
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Pastikan tab browser tetap terbuka. Service Worker / background tidak tersedia.
          </p>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-2">
          <Toggle
            enabled={scannerConfig.onlyInKillZone}
            onToggle={() => updateScanner({ onlyInKillZone: !scannerConfig.onlyInKillZone })}
            label="Scan hanya saat Kill Zone aktif (direkomendasikan)"
          />
        </div>

        {/* Cooldown */}
        <div>
          <Label>Cooldown per instrumen (menit)</Label>
          <div className="flex gap-2 mt-1">
            {[15, 30, 60].map(n => (
              <button
                key={n}
                onClick={() => updateScanner({ cooldownMinutes: n })}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  scannerConfig.cooldownMinutes === n
                    ? 'bg-emerald-700/30 border-emerald-600 text-emerald-300'
                    : 'bg-slate-800 border-slate-700 text-slate-500'
                }`}
              >
                {n}m
              </button>
            ))}
          </div>
        </div>

        {/* Last scan results */}
        {scannerStatus.lastResults.length > 0 && (
          <div>
            <Label>Hasil scan terakhir</Label>
            <div className="mt-1 space-y-1">
              {scannerStatus.lastResults.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-slate-900/60 px-3 py-1.5 rounded-lg">
                  <span className={`font-bold ${
                    r.grade === 'A' ? 'text-emerald-400' :
                    r.grade === 'B' ? 'text-sky-400' :
                    r.grade === 'C' ? 'text-amber-400' : 'text-slate-500'
                  }`}>Grade {r.grade}</span>
                  <span className="font-mono text-slate-300">{r.instrument}</span>
                  <span className="text-slate-500">{r.direction}</span>
                  <span className="text-slate-600 ml-auto">Score {r.score}</span>
                  {r.alertSent && (
                    <span className="text-emerald-500">✉ sent</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scan Now button */}
        <button
          onClick={handleScanNow}
          disabled={scanningNow}
          className="w-full py-2.5 bg-emerald-700/30 hover:bg-emerald-700/50 disabled:opacity-40
                     border border-emerald-600/40 rounded-lg text-sm text-emerald-300
                     font-medium transition-colors"
        >
          {scanningNow
            ? `Scanning ${scannerConfig.instruments.join(', ')}…`
            : '⚡ Scan Sekarang'}
        </button>
      </div>

      {/* ── Danger Zone ── */}
      <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-5">
        <h3 className="font-medium text-red-400 mb-3">Danger Zone</h3>
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-red-800/30 hover:bg-red-800/50 border border-red-700/50
                     rounded-lg text-sm text-red-400 transition-colors"
        >
          Reset Semua Data
        </button>
      </div>
    </div>
  )
}
