// DemoTransport — a demo/test transport that produces valid v0 MusicalTransport
// snapshots aligned to AudioContext.currentTime, WITHOUT the PLL machinery.
//
// This is NOT part of the canonical foundation. It is NOT part of the sampler
// device. It lives in src/lib/ (demo harness code) because it is only used by
// the demo playground UI to drive the sampler when no real PSY host is available.
//
// When the sampler is integrated into a real PSY host (e.g. psy4 PsyLive),
// that host owns its own transport and this file is not used.
//
// The canonical TransportClock (psy-foundation/packages/transport/src/transport.ts)
// depends on BeatEstimator + ConfidenceTracker + PhaseCorrector (PLL for radio
// observation). This DemoTransport skips all that — it just maps BPM +
// AudioContext.currentTime → MusicalTransport snapshots for demo purposes.
//
// FIX: revision now derives from bar so DeviceHost.pushTransport dedup doesn't
// starve the device of transport updates. Each new bar → new revision → device
// sees updated phraseIndex → variant rotation works.

import type { MusicalTransport } from '@/psy-foundation-shim'

export class DemoTransport {
  private bpm: number
  private beatsPerBar: number
  private origin: MusicalTransport['origin']
  private running = false

  constructor(opts: { initialBpm?: number; beatsPerBar?: number; audioContext: AudioContext }) {
    this.bpm = Math.max(1, opts.initialBpm ?? 145)
    this.beatsPerBar = opts.beatsPerBar ?? 4
    const ctx = opts.audioContext
    this.origin = { audioTime: ctx.currentTime, beatIndex: 0, bpm: this.bpm }
  }

  start(audioContext: AudioContext): void {
    if (this.running) return
    this.running = true
    this.origin = { audioTime: audioContext.currentTime, beatIndex: 0, bpm: this.bpm }
  }

  stop(): void {
    this.running = false
  }

  setBpm(bpm: number, audioContext: AudioContext): void {
    const safeBpm = Math.max(1, Math.min(400, bpm))
    const snap = this.snapshot(audioContext.currentTime)
    const newBeatFloat = snap.beat + snap.phase
    this.bpm = safeBpm
    this.origin = {
      audioTime: audioContext.currentTime,
      beatIndex: newBeatFloat,
      bpm: safeBpm,
    }
  }

  get isRunning(): boolean {
    return this.running
  }

  get currentBpm(): number {
    return this.bpm
  }

  snapshot(atAudioTime: number): MusicalTransport {
    const secPerBeat = 60 / this.bpm
    const elapsed = atAudioTime - this.origin.audioTime
    const beatFloat = this.origin.beatIndex + elapsed / secPerBeat
    const beat = Math.floor(beatFloat)
    const bar = Math.floor(beat / this.beatsPerBar)
    const phase = beatFloat - beat
    const beatInBar = beatFloat - bar * this.beatsPerBar
    const barPhase = beatInBar / this.beatsPerBar
    const beatTime = beatFloat * secPerBeat
    const barTime = beatInBar * secPerBeat

    // FIX: revision derives from bar so it changes when bar advances.
    // This prevents DeviceHost.pushTransport dedup from starving the device
    // of transport updates (which broke variant rotation — phraseIndex was
    // always 0 because revision never changed after start()).
    // revision = (bar + 1) so it starts at 1 (not 0) and increments per bar.
    const revision = Math.max(0, bar) + 1

    return {
      bpm: this.bpm,
      beat,
      bar,
      beatsPerBar: this.beatsPerBar,
      beatTime,
      barTime,
      phase,
      barPhase,
      confidence: this.running ? 1.0 : 0.0,
      locked: this.running,
      revision,
      origin: { ...this.origin },
      lastObservationAgo: 0,
      observationCount: this.running ? 1 : 0,
    }
  }
}
