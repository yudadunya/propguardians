/**
 * autoScanner.ts — Background ICT scanner singleton.
 *
 * Cara kerja:
 *  1. Jalan sebagai setInterval di browser (tab harus terbuka)
 *  2. Tiap interval: scan semua instrument → fetchMultiTf → analyzeMultiTf → pipeline
 *  3. Kalau Grade A atau B → callback onAlert → kirim Telegram
 *  4. Cooldown per instrument+direction supaya tidak spam (default 30 menit)
 *  5. Opsional: hanya scan saat Kill Zone aktif
 */

import { fetchMultiTf, analyzeMultiTf }  from './multiTf'
import { runPhase1Pipeline }              from './agents'
import type { SynthesisOutput }           from '../types/ict'
import type { DetectedPattern }           from './patternDetector'
import type { PropAccount, PersonalRules, DailyLog } from '../types'
import type { FeatureWeights }            from './rsiEngine'
import { getNyNow }                       from './killZoneSchedule'

export interface ScannerConfig {
  enabled:         boolean
  intervalMinutes: number       // 5 | 10 | 15 | 30
  instruments:     string[]
  alertGrades:     ('A' | 'B')[]
  onlyInKillZone:  boolean
  cooldownMinutes: number       // min gap between same instrument+dir alerts (default 30)
}

export interface ScanResult {
  instrument:  string
  direction:   'long' | 'short'
  grade:       string
  score:       number
  synthesis:   SynthesisOutput
  pattern:     DetectedPattern
  scannedAt:   string           // ISO timestamp
  alertSent:   boolean
}

export interface ScannerStatus {
  running:       boolean
  lastScanAt:    string | null
  nextScanAt:    string | null
  scanCount:     number
  alertCount:    number
  lastResults:   ScanResult[]
  lastError:     string | null
}

export type AlertCallback = (result: ScanResult) => void | Promise<void>
export type StatusCallback = (status: ScannerStatus) => void

/* ─────────────────── Kill Zone check ─────────────────── */

function isInKillZone(): boolean {
  const { hour } = getNyNow()
  // London: 02–05 | NY AM: 07–10 | Silver Bullet: 10–11 | NY PM: 13–16
  return (
    (hour >= 2  && hour < 5)  ||
    (hour >= 7  && hour < 11) ||
    (hour >= 13 && hour < 16)
  )
}

/* ─────────────────── Scanner class ─────────────────── */

class AutoScannerService {
  private timer:         ReturnType<typeof setInterval> | null = null
  private onAlert:       AlertCallback | null = null
  private onStatusChange: StatusCallback | null = null
  private cooldownMap:   Map<string, number> = new Map()  // key → last alert timestamp ms
  private config:        ScannerConfig | null = null

  private status: ScannerStatus = {
    running:     false,
    lastScanAt:  null,
    nextScanAt:  null,
    scanCount:   0,
    alertCount:  0,
    lastResults: [],
    lastError:   null,
  }

  /* ── Lifecycle ── */

  start(
    config: ScannerConfig,
    getState: () => { account: PropAccount; personalRules: PersonalRules; dailyLog: DailyLog; featureWeights: FeatureWeights },
    onAlert: AlertCallback,
    onStatusChange?: StatusCallback,
  ) {
    this.stop()
    this.config       = config
    this.onAlert      = onAlert
    this.onStatusChange = onStatusChange ?? null

    if (!config.enabled || config.instruments.length === 0) {
      this.updateStatus({ running: false })
      return
    }

    const intervalMs = config.intervalMinutes * 60 * 1000

    const tick = async () => {
      if (config.onlyInKillZone && !isInKillZone()) {
        this.updateStatus({
          lastError: null,
          nextScanAt: new Date(Date.now() + intervalMs).toISOString(),
        })
        return
      }
      await this.scanAll(config, getState)
    }

    // Immediate first scan
    tick()

    this.timer = setInterval(tick, intervalMs)

    this.updateStatus({
      running:   true,
      lastError: null,
      nextScanAt: new Date(Date.now() + intervalMs).toISOString(),
    })

    console.log(
      `[AutoScanner] Started — ${config.instruments.join(', ')} every ${config.intervalMinutes}min`,
    )
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.updateStatus({ running: false, nextScanAt: null })
    console.log('[AutoScanner] Stopped')
  }

  /** Trigger an immediate manual scan (useful for "Scan Now" button in Settings) */
  async scanNow(
    config: ScannerConfig,
    getState: () => { account: PropAccount; personalRules: PersonalRules; dailyLog: DailyLog; featureWeights: FeatureWeights },
  ): Promise<ScanResult[]> {
    return this.scanAll(config, getState)
  }

  getStatus(): ScannerStatus {
    return { ...this.status }
  }

  /* ── Core scan loop ── */

  private async scanAll(
    config: ScannerConfig,
    getState: () => { account: PropAccount; personalRules: PersonalRules; dailyLog: DailyLog; featureWeights: FeatureWeights },
  ): Promise<ScanResult[]> {
    const { account, personalRules, dailyLog, featureWeights } = getState()
    const results: ScanResult[] = []
    const scanTs = new Date().toISOString()

    this.updateStatus({ lastScanAt: scanTs, lastError: null })

    for (const instrument of config.instruments) {
      try {
        /* ── Fetch candles ── */
        const { htfCandles, ltfCandles, entryTf, biasTf } =
          await fetchMultiTf(instrument)

        /* ── Multi-TF analysis ── */
        const multi = analyzeMultiTf(
          instrument, htfCandles, ltfCandles, biasTf, entryTf,
        )
        const pattern = multi.merged

        /* ── Full agent pipeline ── */
        const synthesis = runPhase1Pipeline(
          {
            ...pattern,
            // Ensure required fields for ICTStructureInput
            mssStrong:     pattern.mssStrong    ?? false,
            sweepExtreme:  pattern.sweepExtreme ?? null,
            ote62:         pattern.ote62        ?? null,
            ote79:         pattern.ote79        ?? null,
            avgAtr:        pattern.avgAtr       ?? 0,
          },
          account,
          personalRules,
          dailyLog,
          featureWeights as never,  // edge weights optional
        )

        const grade = synthesis.grade

        const result: ScanResult = {
          instrument,
          direction:  pattern.direction,
          grade,
          score:      synthesis.combinedScore,
          synthesis,
          pattern,
          scannedAt:  scanTs,
          alertSent:  false,
        }

        results.push(result)

        /* ── Alert gate ── */
        if (
          config.alertGrades.includes(grade as 'A' | 'B') &&
          synthesis.decision !== 'blocked'
        ) {
          const cooldownKey = `${instrument}_${pattern.direction}`
          const lastAlertMs = this.cooldownMap.get(cooldownKey) ?? 0
          const cooldownMs  = config.cooldownMinutes * 60 * 1000

          if (Date.now() - lastAlertMs >= cooldownMs) {
            result.alertSent = true
            this.cooldownMap.set(cooldownKey, Date.now())
            this.updateStatus({ alertCount: this.status.alertCount + 1 })

            console.log(
              `[AutoScanner] Grade ${grade} alert — ${instrument} ${pattern.direction}`,
            )

            if (this.onAlert) {
              try { await this.onAlert(result) } catch { /* callback error */ }
            }
          }
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[AutoScanner] ${instrument} scan failed:`, msg)
        this.updateStatus({ lastError: `${instrument}: ${msg}` })
      }

      // Small delay between instruments to be respectful to biquote API
      await new Promise(r => setTimeout(r, 1500))
    }

    const intervalMs = (this.config?.intervalMinutes ?? 15) * 60 * 1000

    this.updateStatus({
      scanCount:   this.status.scanCount + 1,
      lastResults: results,
      nextScanAt:  new Date(Date.now() + intervalMs).toISOString(),
    })

    return results
  }

  private updateStatus(patch: Partial<ScannerStatus>) {
    this.status = { ...this.status, ...patch }
    if (this.onStatusChange) {
      try { this.onStatusChange(this.status) } catch { /* ignore */ }
    }
  }
}

/** Module-level singleton — shared across the whole app */
export const autoScanner = new AutoScannerService()
