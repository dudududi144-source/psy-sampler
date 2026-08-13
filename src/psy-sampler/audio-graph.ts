// PSY Sampler — AudioGraph.
// Bus routing + FX sends + sidechain ducking.
//   - 3 buses: drum, music, atmos
//   - Per-bus gain + delay/reverb sends
//   - Sidechain ducking: kick triggers gain dip on music + atmos buses
//   - Master chain: master gain → compressor → analyser → destination
//
// The sampler device creates this graph and routes voices to buses per role.

import type { BusName } from './types'

export interface AudioGraphOptions {
  masterGain?: number
  delaySend?: number
  reverbSend?: number
  enableAnalyser?: boolean
  outputNode?: AudioNode | null
}

interface Bus {
  input: GainNode
  /** Duck gain node — inserted between input and master. Sidechain dips this. */
  duckGain: GainNode
  delaySend: GainNode
  reverbSend: GainNode
  userGain: number
  muted: boolean
}

export class AudioGraph {
  readonly ctx: AudioContext
  readonly master: GainNode
  readonly compressor: DynamicsCompressorNode
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
    this.analyser = opts.enableAnalyser !== false ? ctx.createAnalyser() : null
    if (this.analyser) this.analyser.fftSize = 256

    const outputTarget = opts.outputNode ?? ctx.destination
    this.master.connect(this.compressor)
    if (this.analyser) {
      this.compressor.connect(this.analyser)
      this.analyser.connect(outputTarget)
    } else {
      this.compressor.connect(outputTarget)
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

    // Buses — each has input → duckGain → master + sends.
    const busConfig: Array<{ name: BusName; gain: number; delay: number; reverb: number }> = [
      { name: 'drum', gain: 0.9, delay: 0.05, reverb: 0.1 },
      { name: 'music', gain: 0.85, delay: 0.2, reverb: 0.25 },
      { name: 'atmos', gain: 0.7, delay: 0.4, reverb: 0.5 },
    ]
    for (const cfg of busConfig) {
      const input = ctx.createGain()
      input.gain.value = cfg.gain
      const duckGain = ctx.createGain()
      duckGain.gain.value = 1.0 // no ducking by default
      const ds = ctx.createGain()
      ds.gain.value = cfg.delay * delaySendAmt * 4
      const rs = ctx.createGain()
      rs.gain.value = cfg.reverb * reverbSendAmt * 4
      // Routing: input → duckGain → master + sends (sends tap after duck so ducked signal doesn't send)
      input.connect(duckGain)
      duckGain.connect(this.master)
      duckGain.connect(ds)
      ds.connect(this.delay)
      duckGain.connect(rs)
      rs.connect(this.reverb)
      this.buses.set(cfg.name, { input, duckGain, delaySend: ds, reverbSend: rs, userGain: cfg.gain, muted: false })
    }
  }

  getBusInput(name: BusName): AudioNode {
    const bus = this.buses.get(name)
    if (!bus) throw new Error(`Unknown bus: ${name}`)
    return bus.input
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
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private makeImpulse(durationSec: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const length = Math.floor(rate * durationSec)
    const impulse = this.ctx.createBuffer(2, length, rate)
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        const t = i / length
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay)
      }
    }
    return impulse
  }

  dispose(): void {
    this.master.disconnect()
    this.compressor.disconnect()
    if (this.analyser) this.analyser.disconnect()
    this.delay.disconnect()
    this.delayFeedback.disconnect()
    this.delayReturn.disconnect()
    this.reverb.disconnect()
    this.reverbReturn.disconnect()
    for (const bus of this.buses.values()) {
      bus.input.disconnect()
      bus.duckGain.disconnect()
      bus.delaySend.disconnect()
      bus.reverbSend.disconnect()
    }
    this.buses.clear()
  }
}
