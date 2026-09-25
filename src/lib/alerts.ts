/**
 * Phase 10 — Browser alerts for Grade A/B
 */

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const r = await Notification.requestPermission()
  return r === 'granted'
}

export function notifyGrade(opts: {
  grade: string
  instrument: string
  direction: string
  decision: string
  expectancy?: number
}): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (opts.grade !== 'A' && opts.grade !== 'B') return
  if (opts.decision !== 'take') return

  const title = `Prop Guardian · Grade ${opts.grade}`
  const body = `${opts.instrument} ${opts.direction.toUpperCase()} · ${opts.decision.toUpperCase()}${
    opts.expectancy !== undefined ? ` · E[R] ${opts.expectancy}` : ''
  }`

  try {
    new Notification(title, {
      body,
      tag: `pg-${opts.instrument}-${opts.grade}`,
      silent: false,
    })
  } catch {
    // ignore
  }

  // Optional short beep via Web Audio
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.frequency.value = opts.grade === 'A' ? 880 : 660
    g.gain.value = 0.05
    o.start()
    setTimeout(() => {
      o.stop()
      void ctx.close()
    }, 180)
  } catch {
    // ignore
  }
}
