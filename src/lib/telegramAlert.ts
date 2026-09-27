/**
 * telegramAlert.ts — Telegram Bot API client + ICT setup message formatter.
 *
 * Setup:
 *  1. Buat bot via @BotFather di Telegram → dapat BOT_TOKEN
 *  2. Send /start ke bot kamu → ketahui CHAT_ID via https://api.telegram.org/bot{TOKEN}/getUpdates
 *  3. Isi di Settings → Telegram Alerts
 */

import type { SynthesisOutput } from '../types/ict'
import type { DetectedPattern } from './patternDetector'

export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
  alertGrades: ('A' | 'B')[]
}

const TG_BASE = 'https://api.telegram.org/bot'

/* ─────────────────── API helpers ─────────────────── */

async function tgRequest(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string }> {
  try {
    const res = await fetch(`${TG_BASE}${token}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    return await res.json()
  } catch (e) {
    return { ok: false, description: String(e) }
  }
}

/** Send a plain text or HTML message */
async function sendMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; description?: string }> {
  return tgRequest(token, 'sendMessage', {
    chat_id:    chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
}

/** Verify bot token is valid */
export async function testBotToken(
  token: string,
): Promise<{ ok: boolean; botName?: string; error?: string }> {
  if (!token.trim()) return { ok: false, error: 'Token kosong' }
  try {
    const res = await fetch(`${TG_BASE}${token}/getMe`)
    const data = await res.json()
    if (data.ok) return { ok: true, botName: data.result.username }
    return { ok: false, error: data.description ?? 'Token tidak valid' }
  } catch {
    return { ok: false, error: 'Tidak bisa connect ke Telegram API' }
  }
}

/** Send test message to verify chat_id */
export async function sendTestMessage(
  config: TelegramConfig,
): Promise<{ ok: boolean; error?: string }> {
  const result = await sendMessage(
    config.botToken,
    config.chatId,
    '✅ <b>Prop Guardian</b> terhubung!\n\n' +
    'Alert ICT Grade A/B akan dikirim ke chat ini secara otomatis.\n\n' +
    '<i>Prop Guardian — ICT Process Coach</i>',
  )
  return { ok: result.ok, error: result.description }
}

/* ─────────────────── Message formatter ─────────────────── */

const GRADE_EMOJI: Record<string, string> = {
  A: '🟢', B: '🔵', C: '🟡', D: '🔴',
}

const KZ_LABEL: Record<string, string> = {
  london:        'London (02–05 NY)',
  ny_am:         'New York AM (07–10 NY)',
  silver_bullet: 'Silver Bullet (10–11 NY)',
  ny_pm:         'New York PM (13–16 NY)',
  outside:       'Outside Kill Zone',
}

function esc(s: string): string {
  // Escape HTML special chars for safe insertion
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals)
}

/**
 * Build the Telegram HTML message for a detected setup.
 * Includes: grade, instrument, kill zone, ICT structure checklist,
 * trade levels, position size, and edge stats.
 */
export function buildAlertMessage(
  synthesis: SynthesisOutput,
  pattern: DetectedPattern,
  accountBalance: number,
): string {
  const { grade, structure, edge, risk } = synthesis
  const gradeEmoji = GRADE_EMOJI[grade] ?? '⚪'
  const dir = pattern.direction === 'long' ? '🔼 LONG' : '🔽 SHORT'
  const kzLabel = KZ_LABEL[pattern.killZone] ?? pattern.killZone
  const nyTime = new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour:     '2-digit',
    minute:   '2-digit',
  })

  const lines: string[] = []

  /* ── Header ── */
  lines.push(
    `${gradeEmoji} <b>GRADE ${grade} SETUP DETECTED</b>\n`,
    `📊 <b>${esc(pattern.instrument)} · ${dir} · ${esc(pattern.timeframe)}</b>`,
    `⏰ ${esc(kzLabel)} · ${nyTime} NY\n`,
  )

  /* ── ICT Structure Checklist ── */
  lines.push('<b>📋 ICT Structure</b>')
  const check = (ok: boolean, label: string) => `${ok ? '✅' : '❌'} ${label}`
  lines.push(check(structure.sweepValid,
    `${pattern.sweepType.toUpperCase()} Sweep${pattern.sweepLevel ? ` @ ${fmt(pattern.sweepLevel, 5)}` : ''}`))
  lines.push(check(structure.mssValid,
    structure.mssStrong ? 'CHoCH Confirmed (hard)' : 'MSS Inferred (displacement)'))
  lines.push(check(structure.displacementValid, 'Displacement'))
  lines.push(check(structure.fvgValid,
    `Fair Value Gap${pattern.fvgLow ? ` ${fmt(pattern.fvgLow, 5)}–${fmt(pattern.fvgHigh!, 5)}` : ''}${pattern.fvgPartiallyFilled ? ' [partial]' : ' [fresh]'}`))
  lines.push(check(structure.oteBonus,
    `OTE 62–79%${pattern.ote79 && pattern.ote62 ? ` (${fmt(pattern.ote79, 5)}–${fmt(pattern.ote62, 5)})` : ''}`))
  lines.push(check(structure.premiumDiscountOk,
    pattern.direction === 'long' ? 'Long in Discount' : 'Short in Premium'))
  lines.push('')

  /* ── Trade Levels ── */
  lines.push('<b>📐 Trade Levels</b>')
  lines.push(`• Entry: ${esc(synthesis.entryHint)}`)
  lines.push(`• Stop: ${esc(synthesis.stopHint)}`)
  lines.push(`• Target: ${esc(synthesis.targetHint)}`)
  lines.push(`• R:R: ${fmt(pattern.rrRatio, 1)}:1`)
  lines.push('')

  /* ── Position Size ── */
  if (risk.approved && risk.positionSize > 0) {
    const dollarRisk = accountBalance * (risk.recommendedRiskPercent / 100)
    lines.push('<b>💰 Position Size</b>')
    lines.push(`• Risk: ${fmt(risk.recommendedRiskPercent, 2)}% ($${fmt(dollarRisk, 0)})`)
    lines.push(`• Size: ${fmt(risk.positionSize, 2)} lots`)
    lines.push(`• Daily budget left: ${fmt(risk.remainingDailyPct, 2)}%`)
    lines.push('')
  }

  /* ── Edge Score ── */
  lines.push(
    `<b>📈 Edge</b>  Score: ${structure.structureScore} | ` +
    `Expectancy: ${fmt(edge.expectancy, 2)} | ` +
    `Win@2R: ${(edge.winrate2R * 100).toFixed(0)}%`,
  )
  lines.push('')

  /* ── Devil flags ── */
  const highFlags = synthesis.devil.flags.filter(
    f => f.severity === 'high' || f.severity === 'critical',
  )
  if (highFlags.length > 0) {
    lines.push('⚠️ <b>Devil Flags</b>')
    highFlags.forEach(f => lines.push(`• [${f.severity}] ${esc(f.message)}`))
    lines.push('')
  }

  /* ── Advice ── */
  lines.push(`💡 ${esc(synthesis.advice)}`)
  lines.push('')
  lines.push('<i>⚡ Prop Guardian · Auto-Scanner</i>')

  return lines.join('\n')
}

/* ─────────────────── Main send function ─────────────────── */

/**
 * Send an ICT setup alert to Telegram.
 * Returns { ok, error } — caller decides how to handle failure.
 */
export async function sendSetupAlert(
  config: TelegramConfig,
  synthesis: SynthesisOutput,
  pattern: DetectedPattern,
  accountBalance: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled) return { ok: false, error: 'Telegram alerts disabled' }
  if (!config.botToken || !config.chatId) {
    return { ok: false, error: 'Bot token / chat ID belum diisi' }
  }
  if (!config.alertGrades.includes(synthesis.grade as 'A' | 'B')) {
    return { ok: false, error: `Grade ${synthesis.grade} tidak di alert list` }
  }

  const text   = buildAlertMessage(synthesis, pattern, accountBalance)
  const result = await sendMessage(config.botToken, config.chatId, text)
  return { ok: result.ok, error: result.description }
}
