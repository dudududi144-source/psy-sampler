// PSY Sampler — AudioGraph.
// Bus routing + FX sends + sidechain ducking.
//   - 3 buses: drum, music, atmos
//   - Per-bus gain + delay/reverb sends
//   - Sidechain ducking: kick triggers gain dip on music + atmos buses
//   - Master chain: master gain → compressor → analyser → destination
//
// The sampler device creates this graph and routes voices to buses per role.

import type { BusName } from './types'
import { safeDisconnect } from '../lib/safe-disconnect'

export interface AudioGraphOptions {
  masterGain?: number
  delaySend?: number
  reverbSend?: number
  enableAnalyser?: boolean
  outputNode?: AudioNode | null
}

interface Bus {
  input: GainNode
  eqLow: BiquadFilterNode
  eqMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  saturation: WaveShaperNode
  saturationGain: GainNode
  duckGain: GainNode
  delaySend: GainNode
  reverbSend: GainNode
  userGain: number
  muted: boolean
  saturationDrive: number
  /** Post-fader direct output tap (multi-output). Null until enableBusOutput(). */
  directOutput: MediaStreamAudioDestinationNode | null
}

export class AudioGraph {
  readonly ctx: AudioContext
  readonly master: GainNode
  /** Master filter (lowpass/highpass/allpass) — the psytrance filter sweep. */
  readonly masterFilter: BiquadFilterNode
  /** Master compressor (glue compression on the mix bus). */
  readonly compressor: DynamicsCompressorNode
  /** Brickwall limiter — prevents clipping at the final output. */
  readonly limiter: DynamicsCompressorNode
  readonly analyser: AnalyserNode | null
  readonly delay: DelayNode
  readonly delayFeedback: GainNode
  readonly delayReturn: GainNode
  readonly reverb: ConvolverNode
  readonly reverbReturn: GainNode
  private readonly buses = new Map<BusName, Bus>()
  private sidechainEnabled = false
  private sidechainDepth = 0.6 // 0=none, 1=full mute
  private sidechainAttack = 0.008 // 8ms
  private sidechainRelease = 0.15 // 150ms
  /** Master filter envelope state (for auto-sweep on kick, like an auto-filter). */
  private filterEnvEnabled = false
  private filterEnvDepth = 0.7 // 0=none, 1=full sweep to 0 Hz
  private filterEnvTime = 0.3 // recovery time in seconds
  private filterBaseFreq = 20000 // base cutoff (effectively open)

  constructor(ctx: AudioContext, opts: AudioGraphOptions = {}) {
    this.ctx = ctx
    const masterGain = opts.masterGain ?? 0.85
    const delaySendAmt = opts.delaySend ?? 0.15
    const reverbSendAmt = opts.reverbSend ?? 0.2

    // Master chain.
    this.master = ctx.createGain()
    this.master.gain.value = masterGain
    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -8
    this.compressor.knee.value = 12
    this.compressor.ratio.value = 6
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.2

    // Brickwall limiter — prevents clipping at the final output stage.
    // High ratio (20:1) + low threshold (-1dB) + fast attack (0.5ms) = catches
    // peaks that would otherwise distort. Professional mixes always have a
    // limiter on the master bus.
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.0005
    this.limiter.release.value = 0.05

    this.analyser = opts.enableAnalyser !== false ? ctx.createAnalyser() : null
    if (this.analyser) this.analyser.fftSize = 256

    const outputTarget = opts.outputNode ?? ctx.destination

    // Master filter — B2 (ROADMAP-TO-100): resonant lowpass/highpass on the
    // master chain. Defaults to 'allpass' (transparent) so it's a no-op until
    // the user engages it. The filter sits BEFORE the compressor so sweeps
    // affect the signal before dynamic control. This is the psytrance "filter
    // sweep" sound — close the filter during a build, snap it open on the drop.
    this.masterFilter = ctx.createBiquadFilter()
    this.masterFilter.type = 'allpass' // transparent by default
    this.masterFilter.frequency.value = 20000 // effectively open
    this.masterFilter.Q.value = 1.0 // gentle resonance

    // Master chain: master → masterFilter → compressor → limiter → [analyser] → output
    this.master.connect(this.masterFilter)
    this.masterFilter.connect(this.compressor)
    this.compressor.connect(this.limiter)
    if (this.analyser) {
      this.limiter.connect(this.analyser)
      this.analyser.connect(outputTarget)
    } else {
      this.limiter.connect(outputTarget)
    }

    // Delay.
    this.delay = ctx.createDelay(2.0)
    this.delay.delayTime.value = 0.3
    this.delayFeedback = ctx.createGain()
    this.delayFeedback.gain.value = 0.35
    this.delayReturn = ctx.createGain()
    this.delayReturn.gain.value = 0.8
    this.delay.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delay)
    this.delay.connect(this.delayReturn)
    this.delayReturn.connect(this.master)

    // Reverb.
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.makeImpulse(1.8, 2.4)
    this.reverbReturn = ctx.createGain()
    this.reverbReturn.gain.value = 0.8
    this.reverb.connect(this.reverbReturn)
    this.reverbReturn.connect(this.master)

    // Buses — each has:
    //   input → eqLow → eqMid → eqHigh → saturation → saturationGain → duckGain → master + sends
    // EQ shapes tone; saturation adds harmonics; duckGain applies sidechain dip.
    // Sends tap after duckGain so ducked signal doesn't send.
    const busConfig: Array<{ name: BusName; gain: number; delay: number; reverb: number }> = [
      { name: 'drum', gain: 0.9, delay: 0.05, reverb: 0.1 },
      { name: 'music', gain: 0.85, delay: 0.2, reverb: 0.25 },
      { name: 'atmos', gain: 0.7, delay: 0.4, reverb: 0.5 },
    ]
    for (const cfg of busConfig) {
      const input = ctx.createGain()
      input.gain.value = cfg.gain

      // 3-band EQ — flat by default (0 dB gain).
      const eqLow = ctx.createBiquadFilter()
      eqLow.type = 'lowshelf'
      eqLow.frequency.value = 200 // below 200Hz = low band
      eqLow.gain.value = 0
      const eqMid = ctx.createBiquadFilter()
      eqMid.type = 'peaking'
      eqMid.frequency.value = 1000 // center of mid band
      eqMid.Q.value = 0.8 // gentle, wide bell
      eqMid.gain.value = 0
      const eqHigh = ctx.createBiquadFilter()
      eqHigh.type = 'highshelf'
      eqHigh.frequency.value = 4000 // above 4kHz = high band
      eqHigh.gain.value = 0

      // Saturation — soft-clip waveshaper. Linear curve (bypass) by default.
      const saturation = ctx.createWaveShaper()
      saturation.curve = makeSaturationCurve(0) // 0 drive = linear bypass
      saturation.oversample = '2x' // reduces aliasing from the waveshaper
      const saturationGain = ctx.createGain()
      saturationGain.gain.value = 1.0 // no makeup gain by default

      const duckGain = ctx.createGain()
      duckGain.gain.value = 1.0 // no ducking by default
      const ds = ctx.createGain()
      ds.gain.value = cfg.delay * delaySendAmt * 4
      const rs = ctx.createGain()
      rs.gain.value = cfg.reverb * reverbSendAmt * 4

      // Routing: input → eqLow → eqMid → eqHigh → saturation → saturationGain → duckGain → master + sends
      input.connect(eqLow)
      eqLow.connect(eqMid)
      eqMid.connect(eqHigh)
      eqHigh.connect(saturation)
      saturation.connect(saturationGain)
      saturationGain.connect(duckGain)
      duckGain.connect(this.master)
      duckGain.connect(ds)
      ds.connect(this.delay)
      duckGain.connect(rs)
      rs.connect(this.reverb)
      this.buses.set(cfg.name, {
        input, eqLow, eqMid, eqHigh, saturation, saturationGain, duckGain,
        delaySend: ds, reverbSend: rs, userGain: cfg.gain, muted: false, saturationDrive: 0,
        directOutput: null,
      })
    }
  }

  getBusInput(name: BusName): AudioNode {
    const bus = this.buses.get(name)
    if (!bus) throw new Error(`Unknown bus: ${name}`)
    return bus.input
  }

  // ─── Multi-output (route each bus to a separate stream) ──────────────────────

  /**
   * Enable a post-fader direct output tap for a bus. Returns a MediaStream
   * that can be recorded separately or routed to an external DAW. The tap is
   * AFTER gain + EQ + saturation but BEFORE duckGain + master FX.
   */
  enableBusOutput(name: BusName): MediaStream | null {
    const bus = this.buses.get(name)
    if (!bus) return null
    if (bus.directOutput) return null
    const dest = this.ctx.createMediaStreamDestination()
    bus.saturationGain.connect(dest)
    bus.directOutput = dest
    return dest.stream
  }

  /** Disable a bus direct output tap. */
  disableBusOutput(name: BusName): void {
    const bus = this.buses.get(name)
    if (!bus || !bus.directOutput) return
    safeDisconnect(bus.saturationGain)
    bus.directOutput = null
  }

  /** Get the MediaStream for a bus output (null if not enabled). */
  getBusOutputStream(name: BusName): MediaStream | null {
    const bus = this.buses.get(name)
    if (!bus || !bus.directOutput) return null
    return bus.directOutput.stream
  }

  /** True if a bus has a direct output enabled. */
  hasBusOutput(name: BusName): boolean {
    const bus = this.buses.get(name)
    return !!bus?.directOutput
  }

  setMasterGain(value: number): void {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  setBusGain(name: BusName, value: number): void {
    const bus = this.buses.get(name)
    if (!bus) return
    bus.userGain = Math.max(0, Math.min(1.5, value))
    if (!bus.muted) {
      bus.input.gain.setTargetAtTime(bus.userGain, this.ctx.currentTime, 0.01)
    }
  }

  setBusMuted(name: BusName, muted: boolean): void {
    const bus = this.buses.get(name)
    if (!bus) return
    bus.muted = muted
    bus.input.gain.setTargetAtTime(muted ? 0 : bus.userGain, this.ctx.currentTime, 0.01)
  }

  getBusGain(name: BusName): number {
    const bus = this.buses.get(name)
    return bus ? bus.userGain : 0
  }

  isBusMuted(name: BusName): boolean {
    const bus = this.buses.get(name)
    return bus ? bus.muted : false
  }

  applySolo(soloed: BusName[]): void {
    const soloSet = new Set(soloed)
    const anySoloed = soloSet.size > 0
    for (const [name, bus] of this.buses.entries()) {
      const effectiveMuted = bus.muted || (anySoloed && !soloSet.has(name))
      bus.input.gain.setTargetAtTime(effectiveMuted ? 0 : bus.userGain, this.ctx.currentTime, 0.01)
    }
  }

  syncDelayToBpm(bpm: number): void {
    const safeBpm = Math.max(1, Math.min(400, bpm))
    const dottedEighth = (60 / safeBpm) * 0.75
    this.delay.delayTime.setTargetAtTime(dottedEighth, this.ctx.currentTime, 0.01)
  }

  // ─── Per-bus 3-band EQ ──────────────────────────────────────────────────────

  /**
   * Set the 3-band EQ for a bus. Gains are in dB (-24..+24). 0 = flat.
   *   low:  lowshelf at 200Hz (sub + low fundamentals)
   *   mid:  peaking at 1kHz, Q=0.8 (body / presence)
   *   high: highshelf at 4kHz (air / bite)
   * Uses setTargetAtTime for click-free parameter changes.
   */
  setBusEQ(name: BusName, eq: { low?: number; mid?: number; high?: number }): void {
    const bus = this.buses.get(name)
    if (!bus) return
    const now = this.ctx.currentTime
    if (eq.low !== undefined) {
      bus.eqLow.gain.setTargetAtTime(Math.max(-24, Math.min(24, eq.low)), now, 0.02)
    }
    if (eq.mid !== undefined) {
      bus.eqMid.gain.setTargetAtTime(Math.max(-24, Math.min(24, eq.mid)), now, 0.02)
    }
    if (eq.high !== undefined) {
      bus.eqHigh.gain.setTargetAtTime(Math.max(-24, Math.min(24, eq.high)), now, 0.02)
    }
  }

  /** Get the current EQ gains (dB) for a bus. */
  getBusEQ(name: BusName): { low: number; mid: number; high: number } {
    const bus = this.buses.get(name)
    if (!bus) return { low: 0, mid: 0, high: 0 }
    return {
      low: bus.eqLow.gain.value,
      mid: bus.eqMid.gain.value,
      high: bus.eqHigh.gain.value,
    }
  }

  // ─── Per-bus saturation ─────────────────────────────────────────────────────

  /**
   * Set saturation drive for a bus. 0 = bypass (linear). 1-10 = soft-clip
   * intensity. At drive=0 the waveshaper curve is linear (no processing cost
   * beyond the curve lookup). Higher drive adds odd harmonics — the classic
   * "warmth" or "bite" of analog gear / tape saturation.
   *
   * Makeup gain is auto-applied: saturation reduces peak level, so we boost
   * the post-saturation gain to compensate (keeps perceived loudness stable).
   *
   * Determinism note: the curve is generated from a pure math function (tanh),
   * not Math.random — saturation is byte-identical across runs.
   */
  setBusSaturation(name: BusName, drive: number): void {
    const bus = this.buses.get(name)
    if (!bus) return
    const safeDrive = Math.max(0, Math.min(10, drive))
    bus.saturationDrive = safeDrive
    bus.saturation.curve = makeSaturationCurve(safeDrive)
    // Makeup gain: at drive D, peak output ≈ 1/tanh(D) for loud signals.
    // We apply a gentle compensation that ramps from 1.0 (drive=0) to ~1.3 (drive=5).
    const makeup = safeDrive <= 0.01 ? 1.0 : 1.0 + Math.min(0.3, safeDrive * 0.06)
    bus.saturationGain.gain.setTargetAtTime(makeup, this.ctx.currentTime, 0.02)
  }

  /** Get the current saturation drive (0 = bypass). */
  getBusSaturation(name: BusName): number {
    const bus = this.buses.get(name)
    return bus ? bus.saturationDrive : 0
  }

  // ─── Per-bus send levels (Phase 4.1) ──────────────────────────────────────
  // Each bus has delaySend and reverbSend gain nodes. These control how much
  // of the bus's signal goes to the delay/reverb returns. Previously these
  // were set once at construction (fixed defaults) with no runtime API.

  /**
   * Set the delay send level for a bus (0..1).
   * 0 = no delay, 1 = maximum delay send.
   */
  setBusDelaySend(name: BusName, value: number): void {
    const bus = this.buses.get(name)
    if (!bus) return
    const v = Math.max(0, Math.min(1, value))
    bus.delaySend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  /** Get the current delay send level (0..1). */
  getBusDelaySend(name: BusName): number {
    const bus = this.buses.get(name)
    return bus ? bus.delaySend.gain.value : 0
  }

  /**
   * Set the reverb send level for a bus (0..1).
   * 0 = no reverb, 1 = maximum reverb send.
   */
  setBusReverbSend(name: BusName, value: number): void {
    const bus = this.buses.get(name)
    if (!bus) return
    const v = Math.max(0, Math.min(1, value))
    bus.reverbSend.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01)
  }

  /** Get the current reverb send level (0..1). */
  getBusReverbSend(name: BusName): number {
    const bus = this.buses.get(name)
    return bus ? bus.reverbSend.gain.value : 0
  }

  // ─── Sidechain ducking ─────────────────────────────────────────────────────

  /** Enable/disable sidechain ducking. When enabled, triggerSidechain() dips music+atmos. */
  setSidechainEnabled(enabled: boolean): void {
    this.sidechainEnabled = enabled
    if (!enabled) {
      // Reset duck gains to 1.0.
      const now = this.ctx.currentTime
      for (const bus of this.buses.values()) {
        bus.duckGain.gain.cancelScheduledValues(now)
        bus.duckGain.gain.setTargetAtTime(1.0, now, 0.01)
      }
    }
  }

  get isSidechainEnabled(): boolean {
    return this.sidechainEnabled
  }

  /** Set sidechain depth (0=none, 1=full mute). */
  setSidechainDepth(depth: number): void {
    this.sidechainDepth = Math.max(0, Math.min(1, depth))
  }

  get sidechainDepthValue(): number {
    return this.sidechainDepth
  }

  /**
   * Trigger a sidechain dip on music + atmos buses.
   * Called by the device when a kick note fires.
   * Dip = (1 - depth) of the current gain, recovering over sidechainRelease.
   */
  triggerSidechain(at: number): void {
    if (!this.sidechainEnabled) return
    const dipGain = 1.0 - this.sidechainDepth
    const now = Math.max(at, this.ctx.currentTime)

    // Duck music + atmos (not drum — the kick needs to cut through).
    for (const name of ['music', 'atmos'] as BusName[]) {
      const bus = this.buses.get(name)
      if (!bus || bus.muted) continue
      bus.duckGain.gain.cancelScheduledValues(now)
      bus.duckGain.gain.setValueAtTime(bus.duckGain.gain.value, now)
      bus.duckGain.gain.linearRampToValueAtTime(dipGain, now + this.sidechainAttack)
      bus.duckGain.gain.linearRampToValueAtTime(1.0, now + this.sidechainAttack + this.sidechainRelease)
    }

    // Also trigger the master filter envelope (auto-filter pump) if enabled.
    // This closes the filter on each kick, then opens it over filterEnvTime —
    // the classic psytrance "wah" that syncs to the kick.
    if (this.filterEnvEnabled) {
      this.triggerFilterEnvelope(now)
    }
  }

  // ─── Master filter (B2) ─────────────────────────────────────────────────────

  /**
   * Set the master filter type + base frequency + resonance.
   *   type: 'allpass' (bypass) | 'lowpass' | 'highpass' | 'bandpass' | 'notch'
   *   freq: cutoff frequency in Hz (20..20000)
   *   Q: resonance (0.0001..30). Higher = more pronounced peak at the cutoff.
   *
   * Default is allpass/20000/Q=1 (transparent). Switch to lowpass for the
   * classic psytrance filter close; highpass for thinning the mix.
   */
  setMasterFilter(opts: { type?: BiquadFilterType; freq?: number; Q?: number }): void {
    if (opts.type !== undefined) {
      this.masterFilter.type = opts.type
    }
    if (opts.freq !== undefined) {
      this.filterBaseFreq = Math.max(20, Math.min(20000, opts.freq))
      this.masterFilter.frequency.setTargetAtTime(this.filterBaseFreq, this.ctx.currentTime, 0.02)
    }
    if (opts.Q !== undefined) {
      this.masterFilter.Q.setTargetAtTime(Math.max(0.0001, Math.min(30, opts.Q)), this.ctx.currentTime, 0.02)
    }
  }

  /** Get the current master filter state. */
  getMasterFilter(): { type: BiquadFilterType; freq: number; Q: number } {
    return {
      type: this.masterFilter.type,
      freq: this.filterBaseFreq,
      Q: this.masterFilter.Q.value,
    }
  }

  /**
   * Enable/disable the filter envelope (auto-filter pump on every kick).
   * When enabled, each kick (via triggerSidechain) sweeps the filter down by
   * `depth` × baseFreq, then recovers over `time` seconds. This is the
   * psytrance "wah" effect synced to the kick.
   */
  setFilterEnvelopeEnabled(enabled: boolean): void {
    this.filterEnvEnabled = enabled
    if (!enabled) {
      // Reset filter to base frequency.
      this.masterFilter.frequency.setTargetAtTime(this.filterBaseFreq, this.ctx.currentTime, 0.05)
    }
  }

  get isFilterEnvelopeEnabled(): boolean {
    return this.filterEnvEnabled
  }

  /** Set the filter envelope depth (0=none, 1=full sweep to ~0 Hz) and recovery time. */
  setFilterEnvelopeParams(depth: number, time: number): void {
    this.filterEnvDepth = Math.max(0, Math.min(1, depth))
    this.filterEnvTime = Math.max(0.02, Math.min(2.0, time))
  }

  get filterEnvelopeDepth(): number { return this.filterEnvDepth }
  get filterEnvelopeTime(): number { return this.filterEnvTime }

  /**
   * Trigger a filter sweep: dip the cutoff by `depth` × baseFreq, then recover
   * over `filterEnvTime` seconds. Called automatically by triggerSidechain when
   * the envelope is enabled, or can be called manually for custom sweeps.
   *
   * Uses exponential ramps (musically natural for filter frequency).
   */
  triggerFilterEnvelope(at: number): void {
    const now = Math.max(at, this.ctx.currentTime)
    const dipFreq = Math.max(20, this.filterBaseFreq * (1.0 - this.filterEnvDepth))
    try {
      this.masterFilter.frequency.cancelScheduledValues(now)
      this.masterFilter.frequency.setValueAtTime(this.masterFilter.frequency.value, now)
      this.masterFilter.frequency.exponentialRampToValueAtTime(dipFreq, now + this.sidechainAttack)
      this.masterFilter.frequency.exponentialRampToValueAtTime(Math.max(20, this.filterBaseFreq), now + this.sidechainAttack + this.filterEnvTime)
    } catch {
      // exponentialRampToValueAtTime throws if value is 0 or negative — guarded.
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * Generate the reverb impulse response DETERMINISTICALLY.
   *
   * CRITICAL: This MUST NOT use Math.random() — that would make every render
   * produce a different reverb tail, destroying the project's core determinism
   * guarantee (same seed → byte-identical audio). We use a seeded mulberry32 RNG
   * with a FIXED seed so the IR is byte-identical across runs, contexts, and
   * machines. This is the difference between "deterministic selection" (which
   * we already had) and "deterministic AUDIO" (which we now actually have).
   */
  private makeImpulse(durationSec: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const length = Math.floor(rate * durationSec)
    const impulse = this.ctx.createBuffer(2, length, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch)
      // Each channel uses a FIXED per-channel seed so L/R are decorrelated but
      // still byte-identical across runs/contexts/machines. Never use Math.random
      // here — it would destroy the project's determinism guarantee.
      let chSeed = 0x9e3779b9 ^ (ch * 0x85ebca6b)
      const chRng = (): number => {
        chSeed |= 0
        chSeed = (chSeed + 0x6d2b79f5) | 0
        let t = Math.imul(chSeed ^ (chSeed >>> 15), 1 | chSeed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      for (let i = 0; i < length; i++) {
        const t = i / length
        data[i] = (chRng() * 2 - 1) * Math.pow(1 - t, decay)
      }
    }
    return impulse
  }

  dispose(): void {
    this.master.disconnect()
    this.masterFilter.disconnect()
    this.compressor.disconnect()
    this.limiter.disconnect()
    if (this.analyser) this.analyser.disconnect()
    this.delay.disconnect()
    this.delayFeedback.disconnect()
    this.delayReturn.disconnect()
    this.reverb.disconnect()
    this.reverbReturn.disconnect()
    for (const bus of this.buses.values()) {
      bus.input.disconnect()
      bus.eqLow.disconnect()
      bus.eqMid.disconnect()
      bus.eqHigh.disconnect()
      bus.saturation.disconnect()
      bus.saturationGain.disconnect()
      bus.duckGain.disconnect()
      bus.delaySend.disconnect()
      bus.reverbSend.disconnect()
      if (bus.directOutput) bus.directOutput.disconnect()
    }
    this.buses.clear()
  }
}

/**
 * Generate a waveshaper curve for soft-clip saturation.
 *
 * drive = 0 → linear (identity, bypass — output[x] = x).
 * drive > 0 → tanh(x * drive) / tanh(drive), normalized so the curve maps
 *   [-1, 1] → [-1, 1]. This adds odd harmonics (warmth/bite) without hard
 *   clipping, mimicking analog tape / tube saturation.
 *
 * The curve is a Float32Array of 2049 samples (standard waveshaper resolution).
 * Web Audio indexes it by input sample value × 1024 + 1024.
 *
 * DETERMINISM: pure math (tanh), no Math.random — byte-identical across runs.
 */
function makeSaturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2049
  const curve = new Float32Array(n)
  if (drive <= 0.01) {
    // Linear bypass — output = input (identity).
    for (let i = 0; i < n; i++) {
      curve[i] = (i / (n - 1)) * 2 - 1
    }
    return curve
  }
  const tanhDrive = Math.tanh(drive)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1 // [-1, 1]
    curve[i] = Math.tanh(x * drive) / tanhDrive
  }
  return curve
}
