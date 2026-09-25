/**
 * ICT Kill Zone schedule (New York time)
 * AI should work hardest approaching / inside these windows.
 */

export type KillZoneId = 'london' | 'ny_am' | 'silver_bullet' | 'ny_pm' | 'outside'

export interface KillZoneWindow {
  id: KillZoneId
  label: string
  startHourNy: number // inclusive
  endHourNy: number // exclusive
  priority: 'high' | 'medium' | 'low'
  description: string
}

/** NY local hours (EST/EDT approximate — user can refine with DST lib later) */
export const ICT_WINDOWS: KillZoneWindow[] = [
  {
    id: 'london',
    label: 'London Open',
    startHourNy: 2,
    endHourNy: 5,
    priority: 'high',
    description: 'Judas swing / London kill zone',
  },
  {
    id: 'ny_am',
    label: 'New York AM',
    startHourNy: 7,
    endHourNy: 10,
    priority: 'high',
    description: 'NY open continuation / reversal',
  },
  {
    id: 'silver_bullet',
    label: 'Silver Bullet',
    startHourNy: 10,
    endHourNy: 11,
    priority: 'high',
    description: '10:00–11:00 NY — high probability FVG window',
  },
  {
    id: 'ny_pm',
    label: 'New York PM',
    startHourNy: 13,
    endHourNy: 16,
    priority: 'medium',
    description: 'PM session — secondary setups',
  },
]

export interface ScheduleStatus {
  nowNy: Date
  hourNy: number
  minuteNy: number
  activeZone: KillZoneId
  activeWindow: KillZoneWindow | null
  inKillZone: boolean
  shouldWork: boolean // AI should actively scan
  minutesToNext: number | null
  nextWindow: KillZoneWindow | null
  message: string
}

/** Approximate NY time from local clock (UTC-4 summer / UTC-5 winter rough) */
export function getNyNow(date = new Date()): { date: Date; hour: number; minute: number } {
  // Use America/New_York when available
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(date).map((p) => [p.type, p.value])
    )
    const hour = parseInt(parts.hour === '24' ? '0' : parts.hour, 10)
    const minute = parseInt(parts.minute, 10)
    return { date, hour, minute }
  } catch {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000
    const ny = new Date(utc - 4 * 3600000) // EDT fallback
    return { date: ny, hour: ny.getUTCHours(), minute: ny.getUTCMinutes() }
  }
}

function findActive(hour: number, minute: number): KillZoneWindow | null {
  const t = hour + minute / 60
  for (const w of ICT_WINDOWS) {
    if (t >= w.startHourNy && t < w.endHourNy) return w
  }
  return null
}

function findNext(hour: number, minute: number): { window: KillZoneWindow; minutes: number } | null {
  const nowMin = hour * 60 + minute
  let best: { window: KillZoneWindow; minutes: number } | null = null

  for (const w of ICT_WINDOWS) {
    let startMin = w.startHourNy * 60
    let delta = startMin - nowMin
    if (delta <= 0) delta += 24 * 60 // next day
    if (!best || delta < best.minutes) {
      best = { window: w, minutes: delta }
    }
  }
  return best
}

/** Pre-window: start working N minutes before kill zone opens */
const PRE_WINDOW_MINUTES = 15

export function getScheduleStatus(date = new Date()): ScheduleStatus {
  const { hour, minute } = getNyNow(date)
  const active = findActive(hour, minute)
  const next = findNext(hour, minute)

  let shouldWork = !!active
  let message = ''

  if (active) {
    message = `Dalam ${active.label} — AI aktif menganalisa`
    shouldWork = true
  } else if (next && next.minutes <= PRE_WINDOW_MINUTES) {
    shouldWork = true
    message = `${next.minutes} menit menuju ${next.window.label} — AI standby / pre-scan`
  } else if (next) {
    const h = Math.floor(next.minutes / 60)
    const m = next.minutes % 60
    message = `Di luar kill zone. Berikutnya: ${next.window.label} dalam ${h}j ${m}m (NY)`
    shouldWork = false
  } else {
    message = 'Jadwal kill zone tidak tersedia'
    shouldWork = false
  }

  return {
    nowNy: date,
    hourNy: hour,
    minuteNy: minute,
    activeZone: active?.id || 'outside',
    activeWindow: active,
    inKillZone: !!active,
    shouldWork,
    minutesToNext: next?.minutes ?? null,
    nextWindow: next?.window ?? null,
    message,
  }
}

export function formatNyTime(date = new Date()): string {
  const { hour, minute } = getNyNow(date)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} NY`
}
