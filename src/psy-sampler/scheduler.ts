// PSY Sampler — RuntimeScheduler.
//
// Fills GAP-S4: foundation's scheduler is offline-only (pure function
// schedule(plan) → events[]). A sampler device needs RUNTIME lookahead
// scheduling to fire voices at precise AudioContext times.
//
// Design (standard Web Audio look-ahead pattern, matching psy/psy3-clean/PSY6-ULTIMATE):
//   - Timer: Web Worker (Blob URL) firing postMessage('tick') every 25ms.
//     (Main-thread setInterval fallback if Worker unavailable.)
//   - Horizon: 100ms lookahead (audioCtx.currentTime + 0.1).
//   - Queue: sorted array of scheduled events by .at ascending.
//   - tick(): drains all events with .at < currentTime + horizon.
//   - Stale events (.at < currentTime) are dropped (not fired late).
//
// Timing rule: AudioContext.currentTime is the ONLY musical clock.
// The 25ms timer only WAKES the scheduler — it is never the musical clock.

import type { SampleId } from './types'
import type { VoiceTriggerOptions } from './types'

export interface ScheduledSampleEvent {
  at: number
  sampleId: SampleId
  buffer: AudioBuffer
  opts: VoiceTriggerOptions
  /** Bus to route to. */
  bus: string
}

export type VoiceTriggerFn = (event: ScheduledSampleEvent) => void

const TICK_MS = 25
const HORIZON_SEC = 0.1

const WORKER_SRC = `let iv=null;self.onmessage=function(e){const d=e.data;if(d.cmd==='start'){if(iv)clearInterval(iv);iv=setInterval(()=>self.postMessage('tick'),d.ms)}else if(d.cmd==='stop'){if(iv)clearInterval(iv);iv=null}};`

export class RuntimeScheduler {
  private readonly ctx: AudioContext
  private triggerFn: VoiceTriggerFn
  private queue: ScheduledSampleEvent[] = []
  private timer: { stop: () => void } | null = null
  private running = false
  private lastTickWarned = 0

  constructor(ctx: AudioContext, triggerFn: VoiceTriggerFn = () => {}) {
    this.ctx = ctx
    this.triggerFn = triggerFn
  }

  /** Set or replace the trigger function (called when a scheduled event fires). */
  setTriggerFn(fn: VoiceTriggerFn): void {
    this.triggerFn = fn
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.timer = this.makeTimer(() => this.tick())
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      this.timer.stop()
      this.timer = null
    }
    // Drop all pending events.
    this.queue = []
  }

  /** Queue an event for future firing. Sorted insert by .at. */
  schedule(event: ScheduledSampleEvent): void {
    // Binary insert to keep queue sorted by .at.
    const arr = this.queue
    let lo = 0
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid]!.at < event.at) lo = mid + 1
      else hi = mid
    }
    arr.splice(lo, 0, event)
  }

  /** Number of events currently queued. */
  get pendingCount(): number {
    return this.queue.length
  }

  get isRunning(): boolean {
    return this.running
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.running) return
    const now = this.ctx.currentTime
    const horizon = now + HORIZON_SEC
    // Drain all events due within the horizon.
    while (this.queue.length > 0 && this.queue[0]!.at <= horizon) {
      const event = this.queue.shift()!
      if (event.at < now - 0.05) {
        // Stale event (> 50ms late) — drop, log once per second.
        if (now - this.lastTickWarned > 1.0) {
          console.warn(
            `[psy-sampler] Dropping stale event (late by ${((now - event.at) * 1000).toFixed(1)}ms)`
          )
          this.lastTickWarned = now
        }
        continue
      }
      this.triggerFn(event)
    }
  }

  private makeTimer(onTick: () => void): { stop: () => void } {
    try {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      const worker = new Worker(url)
      worker.onmessage = () => onTick()
      worker.postMessage({ cmd: 'start', ms: TICK_MS })
      return {
        stop: () => {
          try {
            worker.postMessage({ cmd: 'stop' })
            worker.terminate()
          } catch {
            // already terminated
          }
          URL.revokeObjectURL(url)
        },
      }
    } catch {
      // Worker unavailable — fall back to setInterval.
      const id = setInterval(onTick, TICK_MS)
      return { stop: () => clearInterval(id) }
    }
  }
}
