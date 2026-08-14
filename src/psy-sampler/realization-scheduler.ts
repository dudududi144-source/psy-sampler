// PSY Sampler — RealizationScheduler.
//
// DEVICE-LOCAL REALIZATION SCHEDULING — NOT a musical scheduler.
//
// This is NOT a family-level runtime scheduler. It does NOT decide musical
// timing. The host (composer + transport) already decided WHEN each note
// should sound (NoteEvent.at). This scheduler only ensures the AudioBufferSourceNode
// is started at that exact AudioContext time.
//
// Why it exists: Web Audio requires AudioBufferSourceNode.start(at) to be called
// from the main thread, slightly ahead of `at` (you can't start a source in the
// past). The host publishes NoteEvents with .at in the near future; this
// scheduler drains its queue as time advances and fires voices at the right moment.
//
// Design:
//   - Timer: shared Web Worker (src/lib/timer-worker.ts) firing every 25ms.
//     (Main-thread setInterval fallback if Worker unavailable.)
//   - Horizon: 100ms lookahead (audioCtx.currentTime + 0.1).
//   - Queue: sorted array of scheduled events by .at ascending.
//   - tick(): drains all events with .at <= currentTime + horizon.
//   - Stale events (.at < currentTime - 50ms) are dropped (not fired late).
//   - triggerFn errors are caught (event is logged but not re-thrown).
//
// Timing rule: AudioContext.currentTime is the ONLY clock. The 25ms timer only
// WAKES the drain loop — it is never the musical clock.

import type { SampleId, VoiceTriggerOptions, BusName, SampleRole } from './types'
import { createTimerWorker } from '../lib/timer-worker'

export interface ScheduledSampleEvent {
  at: number
  sampleId: SampleId
  buffer: AudioBuffer
  opts: VoiceTriggerOptions
  /** Bus to route to. */
  bus: BusName
  /** Role that produced this event (for choke-group lookup). */
  role: SampleRole
}

export type VoiceTriggerFn = (event: ScheduledSampleEvent) => void

const TICK_MS = 25
const HORIZON_SEC = 0.1

export class RealizationScheduler {
  private readonly ctx: AudioContext
  private triggerFn: VoiceTriggerFn
  private queue: ScheduledSampleEvent[] = []
  private timer: { stop: () => void } | null = null
  private running = false
  private lastTickWarned = Number.NEGATIVE_INFINITY

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
    this.timer = createTimerWorker(() => this.tick(), TICK_MS)
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
      // FIX: catch triggerFn errors so one bad event doesn't kill the tick loop.
      try {
        this.triggerFn(event)
      } catch (err) {
        console.error('[psy-sampler] triggerFn error for event:', err)
      }
    }
  }
}
