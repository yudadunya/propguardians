/**
 * liveFeed.ts — Singleton polling service for biquote.io live prices.
 * Manages subscriptions per symbol, polls every POLL_MS, emits to callbacks.
 * No external deps — pure TS.
 */

import { fetchTick } from './marketData'

export interface LivePrice {
  symbol: string
  price: number
  bid?: number
  ask?: number
  /** Absolute change vs session open (first fetched price) */
  change: number
  /** Percent change vs session open */
  pctChange: number
  /** Direction of last tick vs previous tick */
  tick: 'up' | 'down' | 'flat'
  updatedAt: number // ms timestamp
  errorCount: number
}

export type PriceCallback = (data: LivePrice) => void

/** Polling interval — 8s is respectful to a free public API */
const POLL_MS = 8_000

class LiveFeedService {
  private subs = new Map<string, Set<PriceCallback>>()
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  /** Baseline price for session change calculation */
  private baseline = new Map<string, number>()
  /** Last emitted price for instant replay to new subscribers */
  private cache = new Map<string, LivePrice>()
  /** Error counters per symbol */
  private errors = new Map<string, number>()

  /**
   * Subscribe to live price updates for a symbol.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  subscribe(appSymbol: string, cb: PriceCallback): () => void {
    if (!this.subs.has(appSymbol)) {
      this.subs.set(appSymbol, new Set())
    }
    this.subs.get(appSymbol)!.add(cb)

    // Replay last known price instantly so UI doesn't flash "loading"
    const cached = this.cache.get(appSymbol)
    if (cached) {
      try { cb(cached) } catch { /* ignore */ }
    }

    // Start polling if this is the first subscriber for this symbol
    if (!this.timers.has(appSymbol)) {
      this._startPolling(appSymbol)
    }

    return () => {
      const set = this.subs.get(appSymbol)
      if (set) {
        set.delete(cb)
        if (set.size === 0) {
          // Last subscriber gone — stop polling and clean up
          clearInterval(this.timers.get(appSymbol))
          this.timers.delete(appSymbol)
          this.subs.delete(appSymbol)
          // Keep baseline & cache so re-subscribing works smoothly
        }
      }
    }
  }

  /** Get last known price without subscribing (for initial renders) */
  getSnapshot(appSymbol: string): LivePrice | null {
    return this.cache.get(appSymbol) ?? null
  }

  /** Manually trigger a single refresh for a symbol (e.g. after analyze) */
  async refresh(appSymbol: string): Promise<void> {
    await this._poll(appSymbol)
  }

  /** Force-reset the session baseline (useful after DST or long gap) */
  resetBaseline(appSymbol: string) {
    this.baseline.delete(appSymbol)
    this.errors.set(appSymbol, 0)
  }

  private _startPolling(appSymbol: string) {
    this._poll(appSymbol) // immediate first fetch
    const timer = setInterval(() => this._poll(appSymbol), POLL_MS)
    this.timers.set(appSymbol, timer)
  }

  private async _poll(appSymbol: string) {
    try {
      const tick = await fetchTick(appSymbol)
      const price = tick.mid ?? 0
      if (price <= 0) return

      // Reset error counter on success
      this.errors.set(appSymbol, 0)

      // Set baseline on first successful fetch
      if (!this.baseline.has(appSymbol)) {
        this.baseline.set(appSymbol, price)
      }
      const base = this.baseline.get(appSymbol)!
      const change = price - base
      const pctChange = base > 0 ? (change / base) * 100 : 0

      // Determine tick direction vs last price
      const prevPrice = this.cache.get(appSymbol)?.price ?? price
      const tick_dir: LivePrice['tick'] =
        price > prevPrice ? 'up' : price < prevPrice ? 'down' : 'flat'

      const lp: LivePrice = {
        symbol: appSymbol,
        price,
        bid: tick.bid,
        ask: tick.ask,
        change,
        pctChange,
        tick: tick_dir,
        updatedAt: Date.now(),
        errorCount: 0,
      }

      this.cache.set(appSymbol, lp)
      this.subs.get(appSymbol)?.forEach((cb) => {
        try { cb(lp) } catch { /* subscriber error — don't kill the feed */ }
      })
    } catch {
      const count = (this.errors.get(appSymbol) ?? 0) + 1
      this.errors.set(appSymbol, count)

      // Emit updated error count so UI can show degraded state
      const prev = this.cache.get(appSymbol)
      if (prev) {
        const degraded: LivePrice = { ...prev, errorCount: count }
        this.cache.set(appSymbol, degraded)
        this.subs.get(appSymbol)?.forEach((cb) => {
          try { cb(degraded) } catch { /* ignore */ }
        })
      }
    }
  }
}

/** Module-level singleton — shared across all React components */
export const liveFeed = new LiveFeedService()
