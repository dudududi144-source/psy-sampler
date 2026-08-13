// PSY Sampler — SampleVoice.
// Plays an AudioBuffer via AudioBufferSourceNode with:
//   - playbackRate pitch shift (linear, native Web Audio — sample-accurate)
//   - gain envelope (exp decay, like psy4's SampleVoice)
//   - equal-power pan (FIXED: psy4's "equal-power" comment was wrong — it used linear pan)
//   - per-source gain node for clean steal fade-out (FIX: no click on voice steal)
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
 *   source (per-trigger) → sourceGain (per-trigger) → gainEnv (shared) → panner (shared) → output
 *
 * The gainEnv and panner nodes are persistent; per-trigger a fresh
 * BufferSourceNode + sourceGain are created (Web Audio requires fresh
 * BufferSource per start()). The sourceGain allows clean fade-out on steal
 * without affecting the shared gainEnv.
 */
export class SampleVoice implements Voice {
  private readonly ctx: AudioContext
  private readonly gainEnv: GainNode
  private readonly panner: StereoPannerNode
  private currentSource: AudioBufferSourceNode | null = null
  private currentSourceGain: GainNode | null = null
  private _active = false

  constructor(init: SampleVoiceInit) {
    this.ctx = init.audioContext
    this.gainEnv = this.ctx.createGain()
    this.gainEnv.gain.value = 1
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
   * Uses per-source gain node for clean 5ms fade-out on steal (no click).
   */
  trigger(buffer: AudioBuffer, opts: VoiceTriggerOptions): void {
    // Stop any current source — with 5ms fade-out on its OWN gain node.
    // This doesn't affect the shared gainEnv, so the new source's envelope
    // is not cancelled.
    if (this.currentSource !== null && this.currentSourceGain !== null) {
      const now = this.ctx.currentTime
      const oldGain = this.currentSourceGain
      const oldSource = this.currentSource
      try {
        // Quick fade-out on the per-source gain (5ms exponential ramp to ~0).
        oldGain.gain.cancelScheduledValues(now)
        oldGain.gain.setValueAtTime(oldGain.gain.value, now)
        oldGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.005)
        oldSource.stop(now + 0.008)
      } catch {
        // already stopped
      }
      // Disconnect after fade completes (onended will fire).
      oldSource.onended = () => {
        try { oldGain.disconnect() } catch { /* already disconnected */ }
      }
      this.currentSource = null
      this.currentSourceGain = null
    }

    // Create fresh source + per-source gain for this trigger.
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = opts.playbackRate
    const sourceGain = this.ctx.createGain()
    sourceGain.gain.value = 0
    source.connect(sourceGain)
    sourceGain.connect(this.gainEnv)
    this.currentSource = source
    this.currentSourceGain = sourceGain

    // Equal-power pan (FIXED from psy4's linear pan).
    this.panner.pan.value = Math.max(-1, Math.min(1, opts.pan))

    // Gain envelope on the per-source gain: instant attack, exponential decay.
    const at = Math.max(opts.at, this.ctx.currentTime)
    const gain = Math.max(0.0001, opts.gain)
    sourceGain.gain.cancelScheduledValues(at)
    sourceGain.gain.setValueAtTime(0.0001, at)
    sourceGain.gain.linearRampToValueAtTime(gain, at + 0.001)
    sourceGain.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)

    source.onended = () => {
      // Only flip _active if this is STILL the current source.
      if (this.currentSource === source) {
        this._active = false
        try { sourceGain.disconnect() } catch { /* already disconnected */ }
        try { source.disconnect() } catch { /* already disconnected */ }
        this.currentSource = null
        this.currentSourceGain = null
      }
    }

    try {
      source.start(at)
      source.stop(at + opts.decay + 0.05)
    } catch {
      if (this.currentSource === source) {
        try { sourceGain.disconnect() } catch { /* */ }
        try { source.disconnect() } catch { /* */ }
        this.currentSource = null
        this.currentSourceGain = null
      }
      this._active = false
      return
    }
    this._active = true
  }

  // ─── Voice interface (foundation contract) ─────────────────────────────────

  noteOn(_note: number, _velocity: number): void {
    // Intentional no-op — sampler uses trigger() instead.
  }

  noteOff(): void {
    // Release — for a one-shot sample, this is a no-op (envelope handles decay).
  }

  panic(): void {
    if (this.currentSource !== null) {
      try { this.currentSource.stop() } catch { /* already stopped */ }
      this.currentSource.disconnect()
      this.currentSource = null
    }
    if (this.currentSourceGain !== null) {
      try { this.currentSourceGain.disconnect() } catch { /* */ }
      this.currentSourceGain = null
    }
    this._active = false
  }

  /** Connect this voice's output to a different bus (for per-event bus routing). */
  connectTo(output: AudioNode): void {
    this.panner.disconnect()
    this.panner.connect(output)
  }
}
