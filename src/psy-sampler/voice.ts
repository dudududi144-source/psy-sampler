// PSY Sampler — SampleVoice.
// Plays an AudioBuffer via AudioBufferSourceNode with:
//   - playbackRate pitch shift (linear, native Web Audio — sample-accurate)
//   - gain envelope (exp decay, like psy4's SampleVoice)
//   - equal-power pan (FIXED: psy4's "equal-power" comment was wrong — it used linear pan)
//
// Implements the foundation's Voice interface (noteOn/noteOff/panic) so it can
// live in a VoicePool<SampleVoice>. The sample/playbackRate/gain/pan are set
// via a separate trigger() method (GAP-S8: Voice.noteOn has no sample param).

import type { Voice } from '../psy-foundation-shim/voice-pool'
import type { VoiceTriggerOptions } from './types'

export interface SampleVoiceInit {
  audioContext: AudioContext
  /** Default output node to connect to (a bus gain node). */
  output: AudioNode
}

/**
 * One sample-playback voice. Pre-wires its graph once at construction:
 *   sourceSlot (BufferSource, created per trigger) → gainEnv → panner → output
 *
 * The gainEnv and panner nodes are persistent; only the BufferSource is created
 * per trigger (Web Audio requires a fresh BufferSourceNode per start()).
 *
 * NOTE: This is NOT zero-allocation in the hot path — each trigger() creates a
 * new AudioBufferSourceNode. The VoicePool bounds the concurrency to 32, so
 * allocation is bounded. If profiling shows GC pressure, migrate to AudioWorklet
 * (documented future path in the audit).
 */
export class SampleVoice implements Voice {
  private readonly ctx: AudioContext
  private readonly gainEnv: GainNode
  private readonly panner: StereoPannerNode
  private currentSource: AudioBufferSourceNode | null = null
  private _active = false

  constructor(init: SampleVoiceInit) {
    this.ctx = init.audioContext
    this.gainEnv = this.ctx.createGain()
    this.gainEnv.gain.value = 0
    this.panner = this.ctx.createStereoPanner()
    this.gainEnv.connect(this.panner)
    this.panner.connect(init.output)
  }

  get active(): boolean {
    return this._active
  }

  /**
   * Trigger playback of a sample buffer.
   * Replaces any currently-sounding source on this voice (implicit steal).
   */
  trigger(buffer: AudioBuffer, opts: VoiceTriggerOptions): void {
    // Stop any current source — with 5ms fade-out to prevent click on steal.
    if (this.currentSource !== null) {
      const now = this.ctx.currentTime
      try {
        // Quick fade-out to prevent click (5ms exponential ramp to ~0).
        this.gainEnv.gain.cancelScheduledValues(now)
        this.gainEnv.gain.setValueAtTime(this.gainEnv.gain.value, now)
        this.gainEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.005)
        this.currentSource.stop(now + 0.006)
      } catch {
        // already stopped
      }
      this.currentSource.disconnect()
      this.currentSource = null
    }

    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = opts.playbackRate
    source.connect(this.gainEnv)
    this.currentSource = source

    // Equal-power pan (FIXED from psy4's linear pan).
    this.panner.pan.value = Math.max(-1, Math.min(1, opts.pan))

    // Gain envelope: instant attack, exponential decay.
    const at = Math.max(opts.at, this.ctx.currentTime)
    const gain = Math.max(0.0001, opts.gain)
    this.gainEnv.gain.cancelScheduledValues(at)
    this.gainEnv.gain.setValueAtTime(0.0001, at)
    this.gainEnv.gain.linearRampToValueAtTime(gain, at + 0.001)
    this.gainEnv.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)

    source.onended = () => {
      // FIX: only flip _active to false if this is STILL the current source.
      // If the voice was stolen (trigger called again while this source was
      // playing), currentSource points to the NEW source — don't flip _active.
      if (this.currentSource === source) {
        this._active = false
        this.currentSource.disconnect()
        this.currentSource = null
      }
    }

    try {
      source.start(at)
      // Stop a bit after decay to ensure the envelope has fully decayed + buffer tail.
      source.stop(at + opts.decay + 0.05)
    } catch {
      // start/stop failed (invalid at, or source already stopped) — clean up.
      if (this.currentSource === source) {
        this.currentSource.disconnect()
        this.currentSource = null
      }
      this._active = false
      return
    }
    this._active = true
  }

  // ─── Voice interface (foundation contract) ─────────────────────────────────

  /**
   * noteOn(note, velocity) — foundation Voice contract.
   * For a sampler, noteOn alone is insufficient (needs a buffer + opts).
   * Use trigger() for real playback. noteOn is a no-op stub that satisfies the
   * interface so the voice can live in VoicePool<SampleVoice>.
   */
  noteOn(_note: number, _velocity: number): void {
    // Intentional no-op — sampler uses trigger() instead.
    // This satisfies VoicePool.noteOn(note, vel) which calls allocate() + noteOn().
    // The sampler device calls pool.allocate() + voice.trigger(...) directly.
  }

  noteOff(): void {
    // Release — for a one-shot sample, this is a no-op (envelope handles decay).
    // For sustained samples (future loop mode), this would begin release.
  }

  panic(): void {
    if (this.currentSource !== null) {
      try {
        this.currentSource.stop()
      } catch {
        // already stopped
      }
      this.currentSource.disconnect()
      this.currentSource = null
    }
    // Snap gain to zero immediately.
    const now = this.ctx.currentTime
    this.gainEnv.gain.cancelScheduledValues(now)
    this.gainEnv.gain.setValueAtTime(0, now)
    this._active = false
  }

  /** Connect this voice's output to a different bus (for per-event bus routing). */
  connectTo(output: AudioNode): void {
    this.panner.disconnect()
    this.panner.connect(output)
  }
}
