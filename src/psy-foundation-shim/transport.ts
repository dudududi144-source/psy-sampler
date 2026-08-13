// VERBATIM SHIM from psy-foundation/packages/transport/src/types.ts (lines 1-43)
// Contains the v0 (legacy, currently canonical for PsyDevice.onTransport) types.
// The v1 TransportSnapshot is NOT wired to DeviceHost yet (GAP-S5 in audit).
// Do not modify. Replace with `import { MusicalTransport } from '@psy-foundation/transport'`
// when integrated into the canonical workspace.

export type AudioTime = number
export type ObservedBeatTime = number
export type EstimatedBeatTime = number
export type PredictedBeatTime = number

export interface BeatObservation {
  observedAt: AudioTime
  strength: number
  source?: string
}

export interface MusicalTransport {
  bpm: number
  beat: number
  bar: number
  beatsPerBar: number
  beatTime: EstimatedBeatTime
  barTime: number
  phase: number
  barPhase: number
  confidence: number
  locked: boolean
  revision: number
  origin: { audioTime: AudioTime; beatIndex: number; bpm: number }
  lastObservationAgo: number
  observationCount: number
}

export interface TransportClockOptions {
  beatsPerBar?: number
  initialBpm?: number
  minBpm?: number
  maxBpm?: number
  tempoSmoothing?: number
  phaseCorrectionRate?: number
  relockWindow?: number
  gapTimeout?: number
  confidenceDecayPerSec?: number
  confidenceGainPerObs?: number
  lockMinObservations?: number
  octaveFoldTolerance?: number
}

// ─── DemoTransport (NOT verbatim — demo helper, NOT part of canonical foundation) ───
// The canonical TransportClock (psy-foundation/packages/transport/src/transport.ts) depends
// on BeatEstimator + ConfidenceTracker + PhaseCorrector (PLL machinery for radio observation).
// The PSY Sampler demo host does NOT observe radio — it drives transport manually from a BPM
// slider. This DemoTransport produces valid v0 MusicalTransport snapshots aligned to
// AudioContext.currentTime, without the PLL. When the sampler is integrated into a real
// PSY host that observes radio, replace this with the canonical TransportClock.

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
    // Re-anchor origin to preserve beat continuity at the new tempo.
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
