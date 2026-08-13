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

import type { MusicalTransport } from '@/psy-foundation-shim'

export class DemoTransport {
  private bpm: number
  private beatsPerBar: number
  private origin: MusicalTransport['origin']
  private revision = 0
  private running = false
  private readonly listeners = new Set<(t: MusicalTransport) => void>()

  constructor(opts: { initialBpm?: number; beatsPerBar?: number; audioContext: AudioContext }) {
    this.bpm = opts.initialBpm ?? 145
    this.beatsPerBar = opts.beatsPerBar ?? 4
    const ctx = opts.audioContext
    this.origin = { audioTime: ctx.currentTime, beatIndex: 0, bpm: this.bpm }
  }

  start(audioContext: AudioContext): void {
    if (this.running) return
    this.running = true
    this.origin = { audioTime: audioContext.currentTime, beatIndex: 0, bpm: this.bpm }
    this.bumpRevision(audioContext)
  }

  stop(): void {
    this.running = false
  }

  setBpm(bpm: number, audioContext: AudioContext): void {
    const snap = this.snapshot(audioContext.currentTime)
    const newBeatFloat = snap.beat + snap.phase
    this.bpm = bpm
    this.origin = {
      audioTime: audioContext.currentTime,
      beatIndex: newBeatFloat,
      bpm,
    }
    this.bumpRevision(audioContext)
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
      revision: this.revision,
      origin: { ...this.origin },
      lastObservationAgo: 0,
      observationCount: this.running ? 1 : 0,
    }
  }

  onRevision(cb: (t: MusicalTransport) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private bumpRevision(audioContext: AudioContext): void {
    this.revision += 1
    const snap = this.snapshot(audioContext.currentTime)
    for (const cb of this.listeners) cb(snap)
  }
}
