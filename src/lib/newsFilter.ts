/**
 * newsFilter.ts — Economic Calendar Filter via biquote.io
 *
 * Blokir atau downgrade setup ICT saat/sebelum/setelah high-impact news.
 * biquote.io menyediakan economic calendar gratis di /api/calendar endpoint.
 *
 * Window:
 *   AVOID  → 30 menit sebelum + 15 menit setelah event
 *   CAUTION → 60–30 menit sebelum event
 *   CLEAR  → di luar semua window
 */

const CALENDAR_URL = 'https://biquote.io/api/calendar'

const BLOCK_BEFORE_MIN   = 30
const BLOCK_AFTER_MIN    = 15
const CAUTION_BEFORE_MIN = 60

/* ─── Types ─── */

export interface NewsEvent {
  time:       string
  country:    string
  event:      string
  importance: 'high' | 'medium' | 'low'
  currency?:  string
  actual?:    string
  forecast?:  string
  previous?:  string
}

export interface NewsStatus {
  isNewsWindow:      boolean
  recommendation:    'clear' | 'caution' | 'avoid'
  reason:            string
  minutesToNext:     number | null
  minutesSinceLast:  number | null
  upcomingEvents:    NewsEvent[]
  recentEvents:      NewsEvent[]
}

/* ─── Cache (1 hour TTL) ─── */

let cachedEvents: NewsEvent[]  = []
let cacheAt      = 0
const CACHE_TTL  = 60 * 60 * 1000

/* ─── Currency relevance map ─── */

const INSTRUMENT_CURRENCIES: Record<string, string[]> = {
  EURUSD: ['US', 'EU', 'USD', 'EUR'],
  GBPUSD: ['US', 'GB', 'USD', 'GBP'],
  USDJPY: ['US', 'JP', 'USD', 'JPY'],
  AUDUSD: ['US', 'AU', 'USD', 'AUD'],
  NZDUSD: ['US', 'NZ', 'USD', 'NZD'],
  USDCAD: ['US', 'CA', 'USD', 'CAD'],
  USDCHF: ['US', 'CH', 'USD', 'CHF'],
  XAUUSD: ['US', 'USD'],   // gold = Fed-driven
  NAS100:  ['US', 'USD'],
  USTEC:   ['US', 'USD'],
  US30:    ['US', 'USD'],
}

/* ─── Fetch ─── */

async function fetchCalendar(): Promise<NewsEvent[]> {
  if (cachedEvents.length > 0 && Date.now() - cacheAt < CACHE_TTL) {
    return cachedEvents
  }

  try {
    const res = await fetch(
      `${CALENDAR_URL}?importance=high`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return cachedEvents

    const raw = await res.json()
    const arr: unknown[] = Array.isArray(raw) ? raw : raw?.events ?? []

    cachedEvents = arr.map((e: unknown) => {
      const ev = e as Record<string, string>
      return {
        time:       ev.time ?? ev.date ?? ev.datetime ?? '',
        country:    ev.country ?? ev.currency ?? '',
        event:      ev.event ?? ev.name ?? ev.title ?? '',
        importance: (ev.importance ?? ev.impact ?? 'medium').toLowerCase() as NewsEvent['importance'],
        currency:   ev.currency ?? ev.country ?? '',
        actual:     ev.actual   ?? '',
        forecast:   ev.forecast ?? '',
        previous:   ev.previous ?? '',
      }
    })
    cacheAt = Date.now()
    return cachedEvents
  } catch {
    return cachedEvents  // return stale cache on network error
  }
}

/* ─── Time parsing ─── */

function parseTime(str: string): Date | null {
  if (!str) return null
  try {
    // ISO 8601
    const d = new Date(str)
    if (!isNaN(d.getTime())) return d

    // HH:MM today (UTC assumed)
    const m = str.match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      const today = new Date()
      today.setUTCHours(Number(m[1]), Number(m[2]), 0, 0)
      return today
    }
    return null
  } catch { return null }
}

/* ─── Main ─── */

export async function checkNewsStatus(instrument: string): Promise<NewsStatus> {
  const events = await fetchCalendar()
  const now    = new Date()

  const relevantCodes = INSTRUMENT_CURRENCIES[instrument] ?? ['US', 'USD']

  const highImpact = events.filter(e =>
    e.importance === 'high' &&
    (relevantCodes.includes(e.country) || relevantCodes.includes(e.currency ?? ''))
  )

  const upcoming: Array<{ event: NewsEvent; minTo: number }> = []
  const recent:   Array<{ event: NewsEvent; minSince: number }> = []

  for (const ev of highImpact) {
    const t = parseTime(ev.time)
    if (!t) continue
    const diffMin = (t.getTime() - now.getTime()) / 60000

    if (diffMin > 0 && diffMin <= CAUTION_BEFORE_MIN) {
      upcoming.push({ event: ev, minTo: Math.round(diffMin) })
    } else if (diffMin <= 0 && Math.abs(diffMin) <= BLOCK_AFTER_MIN) {
      recent.push({ event: ev, minSince: Math.round(Math.abs(diffMin)) })
    }
  }

  upcoming.sort((a, b) => a.minTo - b.minTo)
  recent.sort((a, b) => a.minSince - b.minSince)

  const next = upcoming[0]
  const last = recent[0]

  let recommendation: NewsStatus['recommendation'] = 'clear'
  let reason = 'Tidak ada high-impact news dalam window'
  let isNewsWindow = false

  if (last && last.minSince <= BLOCK_AFTER_MIN) {
    isNewsWindow   = true
    recommendation = 'avoid'
    reason = `${last.event} dirilis ${last.minSince}min lalu — volatilitas tinggi, SKIP`
  } else if (next && next.minTo <= BLOCK_BEFORE_MIN) {
    isNewsWindow   = true
    recommendation = 'avoid'
    reason = `${next.event} dalam ${next.minTo}min — jangan entry`
  } else if (next && next.minTo <= CAUTION_BEFORE_MIN) {
    recommendation = 'caution'
    reason = `${next.event} dalam ${next.minTo}min — size kecil atau tunggu`
  }

  return {
    isNewsWindow,
    recommendation,
    reason,
    minutesToNext:    next?.minTo    ?? null,
    minutesSinceLast: last?.minSince ?? null,
    upcomingEvents:   upcoming.map(u => u.event),
    recentEvents:     recent.map(r => r.event),
  }
}

export function newsStatusClear(): NewsStatus {
  return {
    isNewsWindow: false,
    recommendation: 'clear',
    reason: 'Calendar tidak tersedia',
    minutesToNext: null,
    minutesSinceLast: null,
    upcomingEvents: [],
    recentEvents: [],
  }
}
