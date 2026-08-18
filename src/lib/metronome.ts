// Metronome — a click track that fires on every beat.
//
// Uses a short synthesized click (sine burst, 1kHz, 5ms) generated on the
// AudioContext. No samples needed — pure procedural. The click is routed
// directly to the master output (not through the buses) so it's always
// audible regardless of mixer state.
//
// The metronome is driven by the DemoDirector's tick callback — it fires
// on beat boundaries (step % 4 === 0) when enabled.

export class Metronome {
  private ctx: AudioContext
  private enabled = false
  private outputNode: AudioNode
  private clickBuffer: AudioBuffer | null = null

  constructor(ctx: AudioContext, outputNode: AudioNode) {
    this.ctx = ctx
    this.outputNode = outputNode
    this.clickBuffer = this.makeClick(1000, 0.005) // 1kHz, 5ms
  }

  private makeClick(freq: number, duration: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const length = Math.floor(rate * duration)
    const buffer = this.ctx.createBuffer(1, length, rate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) {
      const t = i / rate
      // Sine burst with exponential decay.
      data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 200) * 0.3
    }
    return buffer
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Fire a metronome click. Called by the director on beat boundaries.
   * @param at AudioContext time to fire the click.
   * @param isDownbeat True if this is beat 1 of the bar (higher pitch).
   */
  click(at: number, isDownbeat: boolean = false): void {
    if (!this.enabled || !this.clickBuffer) return
    const now = Math.max(at, this.ctx.currentTime)
    const source = this.ctx.createBufferSource()
    source.buffer = isDownbeat ? this.makeClick(1500, 0.006) : this.clickBuffer
    const gain = this.ctx.createGain()
    gain.gain.value = isDownbeat ? 0.4 : 0.25
    source.connect(gain)
    gain.connect(this.outputNode)
    source.start(now)
    source.stop(now + 0.01)
    // Cleanup after the click ends.
    source.onended = () => {
      try { gain.disconnect() } catch { /* */ }
    }
  }
}
