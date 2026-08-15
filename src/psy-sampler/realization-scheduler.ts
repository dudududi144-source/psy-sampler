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
//   - Stale events (.at < currentTime - 50ms) are played immediately (not dropped).
//     Dropping causes silence gaps; playing late causes tiny jitter. Standard DAW approach.
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
  /**
   * Queue with head pointer. Instead of shift() (O(n) — moves all elements),
   * we advance headIndex and periodically compact. This makes dequeue O(1)
   * amortized. At 145 BPM with 9 roles, ~144 events are queued per tick —
   * shift() on each costs 144×n comparisons; headIndex costs 0.
   */
  private queue: ScheduledSampleEvent[] = []
  private headIndex = 0
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
    this.headIndex = 0
  }

  /** Queue an event for future firing. Sorted insert by .at. */
  schedule(event: ScheduledSampleEvent): void {
    // Binary insert to keep queue sorted by .at. Operates on the active
    // portion of the array (headIndex..end).
    const arr = this.queue
    let lo = this.headIndex
    let hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (arr[mid]!.at < event.at) lo = mid + 1
      else hi = mid
    }
    arr.splice(lo, 0, event)
  }

  /** Number of events currently queued (active portion). */
  get pendingCount(): number {
    return this.queue.length - this.headIndex
  }

  get isRunning(): boolean {
    return this.running
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.running) return
    const now = this.ctx.currentTime
    const horizon = now + HORIZON_SEC
    // Drain all events due within the horizon. Use headIndex instead of
    // shift() — O(1) dequeue instead of O(n).
    while (this.headIndex < this.queue.length && this.queue[this.headIndex]!.at <= horizon) {
      const event = this.queue[this.headIndex]!
      this.headIndex++
      // If the event is late (> 50ms past its scheduled time), play it NOW
      // instead of dropping it. Dropping causes unexpected silence (gaps in
      // the groove); playing late causes tiny timing jitter but keeps the
      // audio continuous. This is the standard DAW approach — never drop,
      // just catch up.
      if (event.at < now - 0.05) {
        if (now - this.lastTickWarned > 1.0) {
          console.warn(
            `[psy-sampler] Event late by ${((now - event.at) * 1000).toFixed(1)}ms — playing immediately (jitter, not drop)`
          )
          this.lastTickWarned = now
        }
        // Clamp the event time to NOW so the voice triggers immediately.
        event.at = now
        event.opts.at = now
      }
      // FIX: catch triggerFn errors so one bad event doesn't kill the tick loop.
      try {
        this.triggerFn(event)
      } catch (err) {
        console.error('[psy-sampler] triggerFn error for event:', err)
      }
    }
    // Compact: if headIndex has advanced past 64 entries, slice off the
    // consumed prefix. This prevents unbounded array growth. 64 is chosen
    // so we compact roughly every 2-3 ticks (each tick drains ~50 events).
    if (this.headIndex > 64) {
      this.queue = this.queue.slice(this.headIndex)
      this.headIndex = 0
    }
  }
}
