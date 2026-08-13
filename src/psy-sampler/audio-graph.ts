// PSY Sampler — AudioGraph.
// Bus routing + FX sends. Minimal for MVP:
//   - 3 buses: drum, music, atmos
//   - Per-bus gain + delay/reverb sends
//   - Master chain: master gain → compressor → analyser → destination
//
// The sampler device creates this graph and routes voices to buses per role.

import type { BusName } from './types'

export interface AudioGraphOptions {
  masterGain?: number
  delaySend?: number
  reverbSend?: number
  enableAnalyser?: boolean
  /**
   * External output node to connect to (instead of ctx.destination).
   * When a host provides a shared bus input, the sampler connects its
   * master chain → outputNode. This enables shared master/limiter/ducking.
   * If null (default), connects to ctx.destination (standalone mode).
   */
  outputNode?: AudioNode | null
}

interface Bus {
  input: GainNode
  delaySend: GainNode
  reverbSend: GainNode
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

    // Connect master chain → outputNode (if provided) or ctx.destination.
    const outputTarget = opts.outputNode ?? ctx.destination
    this.master.connect(this.compressor)
    if (this.analyser) {
      this.compressor.connect(this.analyser)
      this.analyser.connect(outputTarget)
    } else {
      this.compressor.connect(outputTarget)
    }

    // Delay (ping-pong-ish via feedback loop).
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

    // Reverb (convolver with synthesized impulse).
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.makeImpulse(1.8, 2.4)
    this.reverbReturn = ctx.createGain()
    this.reverbReturn.gain.value = 0.8
    this.reverb.connect(this.reverbReturn)
    this.reverbReturn.connect(this.master)

    // Buses.
    const busConfig: Array<{ name: BusName; gain: number; delay: number; reverb: number }> = [
      { name: 'drum', gain: 0.9, delay: 0.05, reverb: 0.1 },
      { name: 'music', gain: 0.85, delay: 0.2, reverb: 0.25 },
      { name: 'atmos', gain: 0.7, delay: 0.4, reverb: 0.5 },
    ]
    for (const cfg of busConfig) {
      const input = ctx.createGain()
      input.gain.value = cfg.gain
      const ds = ctx.createGain()
      ds.gain.value = cfg.delay * delaySendAmt * 4 // scale to audible
      const rs = ctx.createGain()
      rs.gain.value = cfg.reverb * reverbSendAmt * 4
      input.connect(this.master)
      input.connect(ds)
      ds.connect(this.delay)
      input.connect(rs)
      rs.connect(this.reverb)
      this.buses.set(cfg.name, { input, delaySend: ds, reverbSend: rs })
    }
  }

  /** Get the input node for a bus (voices connect here). */
  getBusInput(name: BusName): AudioNode {
    const bus = this.buses.get(name)
    if (!bus) throw new Error(`Unknown bus: ${name}`)
    return bus.input
  }

  /** Set master gain. */
  setMasterGain(value: number): void {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01)
  }

  /** Sync delay time to BPM (dotted-eighth). */
  syncDelayToBpm(bpm: number): void {
    const dottedEighth = (60 / bpm) * 0.75
    this.delay.delayTime.setTargetAtTime(dottedEighth, this.ctx.currentTime, 0.01)
  }

  /** Synthesize a stereo impulse response for the convolver reverb. */
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

  /** Disconnect everything (for disposal). */
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
      bus.delaySend.disconnect()
      bus.reverbSend.disconnect()
    }
    this.buses.clear()
  }
}
