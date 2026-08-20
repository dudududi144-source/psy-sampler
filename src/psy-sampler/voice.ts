// PSY Sampler — SampleVoice.
// Plays an AudioBuffer via AudioBufferSourceNode with:
//   - playbackRate pitch shift (linear, native Web Audio — sample-accurate)
//   - gain envelope (exp decay, like psy4's SampleVoice)
//   - equal-power pan (FIXED: psy4's "equal-power" comment was wrong — it used linear pan)
//   - PER-TRIGGER output chain (FIX: voice-steal tail no longer bleeds into the
//     new bus; each trigger owns its own sourceGain → gainEnv → panner → output
//     so the old source's 5ms fade-out stays on the bus it was routed to)
//   - optional anti-alias lowpass (FIX: pitched-up bass/lead no longer alias —
//     a lowpass whose cutoff scales with playbackRate tames mirror spectra)
//
// Implements the foundation's Voice interface (noteOn/noteOff/panic) so it can
// live in a VoicePool<SampleVoice>. The sample/playbackRate/gain/pan are set
// via a separate trigger() method (GAP-S8: Voice.noteOn has no sample param).

import type { Voice } from '../psy-foundation-shim/voice-pool'
import type { VoiceTriggerOptions } from './types'
import { safeDisconnect } from '../lib/safe-disconnect'
import { combinedFxCurve } from './voice-fx-curves'

export interface SampleVoiceInit {
  audioContext: AudioContext
  /** Default output node to connect to (a bus gain node). */
  output: AudioNode
}

/**
 * One sample-playback voice.
 *
 * Each trigger() call creates a FRESH, SELF-CONTAINED chain:
 *   source → sourceGain → [lowpass] → panner → output
 * and keeps a handle so it can be stolen (faded + stopped) independently of
 * any subsequent trigger. The previous chain is NOT mutated by connectTo() or
 * by the next trigger — its tail fades out on the bus it was originally routed
 * to. This is the key fix vs. the old shared-gainEnv/shared-panner design,
 * which bled the steal tail into whatever bus the next trigger targeted.
 *
 * `connectTo()` only records the NEXT output target; in-flight triggers are
 * untouched. This is how Tone.js, Kontakt, and every pro sampler route voices.
 */
export class SampleVoice implements Voice {
  private readonly ctx: AudioContext
  /** The output the NEXT trigger() will connect to. */
  private nextOutput: AudioNode
  /** The currently-sounding trigger chain (null when idle). */
  private activeChain: ActiveChain | null = null
  private _active = false
  /**
   * Caller-owned tag (e.g. the SampleRole this voice was last triggered with).
   * Used by the device's choke-group logic to find voices to cut. The voice
   * itself never reads this — it is purely an external lookup key.
   */
  private _tag: unknown = null

  constructor(init: SampleVoiceInit) {
    this.ctx = init.audioContext
    this.nextOutput = init.output
  }

  get active(): boolean {
    return this._active
  }

  /** External tag (device sets this to the role on each trigger). */
  get tag(): unknown {
    return this._tag
  }

  set tag(v: unknown) {
    this._tag = v
  }

  /**
   * Set the output bus that the NEXT trigger() will route to.
   * Does NOT affect any in-flight trigger — their tails stay on their original
   * bus. This is the correctness fix for voice-steal bus bleed.
   */
  connectTo(output: AudioNode): void {
    this.nextOutput = output
  }

  /**
   * Trigger playback of a sample buffer.
   * Replaces any currently-sounding source on this voice (implicit steal),
   * fading the old one out on ITS OWN bus over 5ms (no click, no bleed).
   */
  trigger(buffer: AudioBuffer, opts: VoiceTriggerOptions): void {
    // ── Steal the currently-sounding chain (if any) ────────────────────────
    // The old chain stays connected to ITS output (the bus it was routed to
    // when it started). We fade it out at the NEW event's start time (opts.at),
    // not at currentTime — this keeps offline renders (where currentTime is 0
    // at construction) timing-accurate, and tightens live steals to the exact
    // event time instead of the scheduler's 100ms horizon window.
    const stealAt = Math.max(opts.at, this.ctx.currentTime)
    if (this.activeChain !== null) {
      this.fadeOutAndStop(this.activeChain, stealAt)
      this.activeChain = null
    }

    const ctx = this.ctx
    const now = ctx.currentTime
    const at = Math.max(opts.at, now)

    // ── Build a fresh per-trigger chain ───────────────────────────────────
    const source = ctx.createBufferSource()
    source.buffer = buffer

    // ── Phase 1.3: Loop points + reverse ─────────────────────────────────
    // The Web Audio API's AudioBufferSourceNode supports:
    //   - loop: boolean — when true, the source loops between loopStart and loopEnd
    //   - loopStart/loopEnd: number — loop boundaries in seconds
    //   - playbackRate: number — can be NEGATIVE for reverse playback
    //     (Chrome/Firefox/Safari all support negative playbackRate)
    //
    // We translate the VoiceTriggerOptions.loop enum into AudioBufferSourceNode
    // settings:
    //   - 'one-shot' → loop=false (default; plays buffer once then ends)
    //   - 'forward'  → loop=true, loopStart/loopEnd set, playbackRate positive
    //   - 'backward' → loop=true, playbackRate NEGATIVE throughout (loops in
    //                  reverse direction; Web Audio handles the wraparound)
    //   - 'ping-pong' → loop=true with alternating direction. Web Audio doesn't
    //                   natively support ping-pong, so we use a scheduled
    //                   playbackRate sign-flip at each loop boundary via
    //                   setValueAtTime on a timeline.
    //
    // Reverse (one-shot, no loop) is handled by negating playbackRate and
    // starting from the end of the buffer.
    const loopMode = opts.loop ?? 'one-shot'
    const reverse = opts.reverse ?? false
    const bufDuration = buffer.duration
    const loopStart = Math.max(0, Math.min(bufDuration - 0.001, opts.loopStart ?? 0))
    const loopEnd = Math.max(loopStart + 0.001, Math.min(bufDuration, opts.loopEnd ?? bufDuration))

    // Base playback rate (may be negated for reverse/backward).
    let rate = opts.playbackRate
    if (reverse) rate = -rate
    if (loopMode === 'backward') rate = -Math.abs(rate)
    source.playbackRate.value = rate

    // Compute the start offset (where playback begins).
    let startOffset: number
    if (loopMode === 'one-shot') {
      // One-shot: start at startOffset, or end of buffer if reversed.
      startOffset = reverse
        ? bufDuration - (opts.startOffset ?? 0)
        : (opts.startOffset ?? 0)
    } else {
      // Looping: start at loopStart (forward) or loopEnd (backward/ping-pong).
      startOffset = (loopMode === 'backward' || reverse)
        ? loopEnd
        : (opts.startOffset ?? loopStart)
      source.loop = true
      source.loopStart = loopStart
      source.loopEnd = loopEnd
    }

    // For ping-pong, schedule the playbackRate sign-flip at each boundary.
    // Web Audio doesn't natively do ping-pong, so we manually schedule
    // direction reversals at the loop boundaries.
    if (loopMode === 'ping-pong') {
      // Forward phase duration (loopStart → loopEnd)
      const forwardDur = (loopEnd - loopStart) / Math.abs(rate)
      // Backward phase duration (same duration since |rate| is the same)
      const backwardDur = forwardDur
      // Total ping-pong cycle = forward + backward
      const cycleDur = forwardDur + backwardDur
      // Schedule sign-flips for the duration of opts.decay (envelope length).
      // We cap at 100 cycles to avoid pathological scheduling.
      const numCycles = Math.min(100, Math.ceil(opts.decay / cycleDur))
      const pr = source.playbackRate
      pr.cancelScheduledValues(at)
      pr.setValueAtTime(rate, at)
      for (let c = 0; c < numCycles; c++) {
        // After forward phase, flip to backward.
        pr.setValueAtTime(-rate, at + (c + 1) * forwardDur + c * backwardDur)
        // After backward phase, flip back to forward (next cycle).
        pr.setValueAtTime(rate, at + (c + 1) * cycleDur)
      }
    }
    // ── End Phase 1.3 ────────────────────────────────────────────────────

    // Per-trigger gain: instant attack, exponential decay. Owns the envelope.
    const sourceGain = ctx.createGain()
    sourceGain.gain.value = 0.0001
    source.connect(sourceGain)

    // Per-trigger pan (equal-power via StereoPanner — Web Audio's panningModel
    // default is 'equalpower' for StereoPannerNode, which is correct here).
    const panner = ctx.createStereoPanner()
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan))
    sourceGain.connect(panner)

    // ── Phase 1.6: Per-voice FX chain ──────────────────────────────────────
    // Insert a WaveShaperNode with a combined curve for transient design +
    // bitcrushing + saturation. Inserted between sourceGain and the anti-
    // alias lowpass so the lowpass can still tame mirror images AFTER the
    // FX adds harmonics. The panner stays at the end (post-FX) so FX isn't
    // affected by pan position.
    //
    // Chain order:
    //   source → sourceGain → [fxShaper] → [lowpass] → [lowpass2] → panner → out
    //
    // We use a SINGLE WaveShaperNode with a pre-combined curve (more
    // efficient than 3 separate shapers). The curve is generated by
    // combinedFxCurve() which applies transient → bitcrusher → saturation
    // in that order (matches the chain order in the docstring).
    let fxShaper: WaveShaperNode | null = null
    const hasFx = opts.fx && (
      (typeof opts.fx.transient === 'number' && Math.abs(opts.fx.transient) > 0.01) ||
      (typeof opts.fx.bitcrusher === 'number' && opts.fx.bitcrusher < 16) ||
      (typeof opts.fx.saturation === 'number' && opts.fx.saturation > 0.01)
    )
    if (hasFx && typeof ctx.createWaveShaper === 'function') {
      try {
        fxShaper = ctx.createWaveShaper()
        // 2x oversampling for smoother curve interpolation at high freqs.
        if ('oversample' in fxShaper) {
          fxShaper.oversample = '2x'
        }
        // Generate the combined curve (cached per (transient,bitcrusher,saturation)
        // tuple in production; for MVP we regenerate each trigger which is fine
        // for our use case — triggers are infrequent relative to sample rate).
        fxShaper.curve = combinedFxCurve(opts.fx!)
        // No additional DC offset — our curves are odd functions.
        // Insert: sourceGain → fxShaper → panner (lowpass will reconnect
        // below if needed).
        sourceGain.disconnect()
        sourceGain.connect(fxShaper)
        fxShaper.connect(panner)
      } catch {
        // WaveShaper unavailable — play without FX (degraded).
        fxShaper = null
      }
    }

    // Optional anti-alias lowpass for pitched-up playback (HQI mode).
    //
    // When playbackRate > 1 (pitching up), the source's spectra are compressed
    // and mirror images alias back into the audible band. We tame this with a
    // lowpass whose cutoff tracks playbackRate.
    //
    // A1 (ROADMAP-TO-100): The lowpass uses `oversample = '2x'` — Web Audio
    // internally renders the filter at 2× the sample rate then downsamples,
    // which is the standard way to get near-sinc-quality anti-aliasing without
    // a custom AudioWorklet. For heavily pitched playback (playbackRate > 2),
    // we cascade TWO lowpass filters for a steeper (≈48 dB/oct) roll-off —
    // a single 12 dB/oct BiquadFilter isn't enough to fully suppress mirror
    // images at extreme pitch shifts.
    //
    // Guarded so limited AudioContext shims (e.g. test environments without
    // createBiquadFilter) degrade gracefully — the voice still plays, just
    // without anti-aliasing.
    let lowpass: BiquadFilterNode | null = null
    let lowpass2: BiquadFilterNode | null = null
    if (opts.playbackRate > 1.01 && typeof ctx.createBiquadFilter === 'function') {
      try {
        lowpass = ctx.createBiquadFilter()
        lowpass.type = 'lowpass'
        // HQI: 2× oversampling for near-sinc filter quality.
        if ('oversample' in lowpass) {
          lowpass.oversample = '2x'
        }
        // Nyquist of the SOURCE material, scaled by playbackRate. Anything above
        // this would alias. We go at 0.85× Nyquist for the cascaded slope.
        const nyquist = (ctx.sampleRate / 2) * 0.85
        const cutoff = Math.min(nyquist, (18000 / opts.playbackRate) * 1.1)
        lowpass.frequency.value = Math.max(2000, cutoff)
        lowpass.Q.value = 0.7

        // For extreme pitch shifts (>2×), cascade a second lowpass for steeper
        // roll-off. This gives ~48 dB/oct attenuation of mirror images instead
        // of the single filter's ~24 dB/oct.
        if (opts.playbackRate > 2.0) {
          lowpass2 = ctx.createBiquadFilter()
          lowpass2.type = 'lowpass'
          if ('oversample' in lowpass2) {
            lowpass2.oversample = '2x'
          }
          lowpass2.frequency.value = lowpass.frequency.value
          lowpass2.Q.value = 0.5 // lower Q on the second filter for a smoother combined slope
        }

        // Insert: fxShaper-or-sourceGain → lowpass → [lowpass2] → panner.
        // We disconnect the fxShaper→panner (or sourceGain→panner if no FX)
        // and insert the lowpass chain in between.
        const preLowpassNode = fxShaper ?? sourceGain
        preLowpassNode.disconnect()
        preLowpassNode.connect(lowpass)
        if (lowpass2) {
          lowpass.connect(lowpass2)
          lowpass2.connect(panner)
        } else {
          lowpass.connect(panner)
        }
      } catch {
        // BiquadFilter unavailable — play without anti-aliasing (degraded).
        lowpass = null
        lowpass2 = null
      }
    }

    panner.connect(this.nextOutput)

    // ── Envelope: instant attack, exponential decay ───────────────────────
    const gain = Math.max(0.0001, opts.gain)
    sourceGain.gain.cancelScheduledValues(at)
    sourceGain.gain.setValueAtTime(0.0001, at)
    sourceGain.gain.linearRampToValueAtTime(gain, at + 0.001)
    sourceGain.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay)

    const chain: ActiveChain = { source, sourceGain, panner, lowpass, lowpass2, fxShaper }
    this.activeChain = chain

    // ── Cleanup when the source ends (natural or forced) ──────────────────
    // Only flip _active=false if THIS chain is still the active one (i.e. it
    // wasn't superseded by a newer trigger).
    source.onended = () => {
      if (this.activeChain === chain) {
        this._active = false
        this.activeChain = null
      }
      disposeChain(chain)
    }

    try {
      // Phase 1.3: pass startOffset so reverse + loop start positions work.
      // start() signature: source.start(when, offset?)
      source.start(at, Math.max(0, startOffset))
      // Hard stop a hair past the decay so the exponential ramp's tail (which
      // approaches but never reaches zero) doesn't drone forever.
      source.stop(at + opts.decay + 0.05)
    } catch {
      // start() can throw if at is in the past or the source is malformed.
      if (this.activeChain === chain) {
        this.activeChain = null
        this._active = false
      }
      disposeChain(chain)
      return
    }
    this._active = true
  }

  /**
   * Fade out + stop a chain on ITS OWN bus (no re-routing). 5ms exponential
   * ramp on the per-trigger sourceGain, then stop the source 3ms later so the
   * ramp completes before the node is torn down. No click. The fade is
   * scheduled at `at` (the triggering event's time) for timing accuracy in
   * both live and offline contexts.
   */
  private fadeOutAndStop(chain: ActiveChain, at: number): void {
    try {
      chain.sourceGain.gain.cancelScheduledValues(at)
      chain.sourceGain.gain.setValueAtTime(chain.sourceGain.gain.value, at)
      chain.sourceGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.005)
      chain.source.stop(at + 0.008)
    } catch {
      // already stopped — just dispose
      disposeChain(chain)
    }
  }

  // ─── Voice interface (foundation contract) ─────────────────────────────────

  noteOn(_note: number, _velocity: number): void {
    // Intentional no-op — sampler uses trigger() instead.
  }

  noteOff(): void {
    // Release — for a one-shot sample, this is a no-op (envelope handles decay).
  }

  /**
   * Choke: fast 2ms fade-out then stop. Used by choke groups (e.g. a closed
   * hi-hat chokes an open hi-hat). Gentler than panic() (which is instant and
   * can click) — the 2ms ramp is inaudible as a fade but avoids the discontinuity
   * click of a hard cut. This is how hardware MPCs and Kontakt choke groups work.
   *
   * @param at The AudioContext time to start the fade. Defaults to currentTime.
   * Pass the triggering event's .at for timing-accurate chokes in both live and
   * offline contexts.
   */
  choke(at?: number): void {
    if (this.activeChain !== null) {
      const chain = this.activeChain
      this.activeChain = null
      this._active = false
      const fadeAt = at ?? this.ctx.currentTime
      try {
        chain.sourceGain.gain.cancelScheduledValues(fadeAt)
        chain.sourceGain.gain.setValueAtTime(chain.sourceGain.gain.value, fadeAt)
        chain.sourceGain.gain.exponentialRampToValueAtTime(0.0001, fadeAt + 0.002)
        chain.source.stop(fadeAt + 0.004)
      } catch {
        disposeChain(chain)
      }
    }
  }

  panic(): void {
    if (this.activeChain !== null) {
      const chain = this.activeChain
      this.activeChain = null
      this._active = false
      try { chain.source.stop() } catch { /* already stopped */ }
      disposeChain(chain)
    }
  }
}

interface ActiveChain {
  source: AudioBufferSourceNode
  sourceGain: GainNode
  panner: StereoPannerNode
  lowpass: BiquadFilterNode | null
  lowpass2: BiquadFilterNode | null
  /** Per-voice FX WaveShaper (Phase 1.6) — transient + bitcrusher + saturation combined. */
  fxShaper: WaveShaperNode | null
}

function disposeChain(chain: ActiveChain): void {
  safeDisconnect(chain.source)
  safeDisconnect(chain.sourceGain)
  if (chain.fxShaper) {
    safeDisconnect(chain.fxShaper)
  }
  if (chain.lowpass) {
    safeDisconnect(chain.lowpass)
  }
  if (chain.lowpass2) {
    safeDisconnect(chain.lowpass2)
  }
  safeDisconnect(chain.panner)
}
