// PSY Sampler — SamplerDevice.
// Implements the canonical PsyDevice interface (verbatim from psy-foundation via shim).
//
// Responsibilities (HOW layer only — never WHAT):
//   - Receive MusicalTransport (bpm) for delay-sync.
//   - Receive MusicalContext (section, energy, style) — currently observed but
//     NOT used for selection (see selector.ts honesty fix). Kept for future
//     context-aware selection.
//   - Receive MusicalEvent (NoteEvent) → select sample → schedule voice trigger at event.at.
//   - Own its SampleLibrary, VoicePool, SelectionPolicy, RealizationScheduler, AudioGraph.
//
// The device NEVER:
//   - Decides WHAT to play (host's composer decides via NoteEvents).
//   - Decides WHEN to play musically (host sets NoteEvent.at — device only
//     realizes at that AudioContext time).
//   - Touches the transport (host owns it).
//   - Generates composition (zero publish() calls in this package).

import type {
  PsyDevice,
  MusicalTransport,
  MusicalContext,
  MusicalEvent,
  NoteEvent,
  DeviceCapabilities,
} from '../psy-foundation-shim'
import type { VoicePool } from '../psy-foundation-shim'
import type { SampleLibrary } from './library'
import type { SelectionPolicy } from './selector'
import type { RealizationScheduler, ScheduledSampleEvent } from './realization-scheduler'
import type { AudioGraph } from './audio-graph'
import type { SampleVoice } from './voice'
import { parseChannel, roleToBus } from './types'

export interface SamplerDeviceOptions {
  audioContext: AudioContext
  library: SampleLibrary
  selectionPolicy: SelectionPolicy
  scheduler: RealizationScheduler
  audioGraph: AudioGraph
  voicePool: VoicePool<SampleVoice>
  /** Max voices (for capabilities report). */
  voiceCount: number
  /** Manifest URL (for re-loading). */
  manifestUrl: string
  /** Called when the device has been started. */
  onReady?: () => void
}

export class SamplerDevice implements PsyDevice {
  readonly id = 'psy-sampler'
  private transport: MusicalTransport | null = null
  private context: MusicalContext | null = null
  private started = false
  private readonly opts: SamplerDeviceOptions
  /** Bars per phrase — used to derive phraseIndex from transport.bar. */
  private readonly barsPerPhrase = 8
  /** Counters for observability. */
  eventsReceived = 0
  notesTriggered = 0
  notesSkipped = 0

  /** Last received transport (for diagnostics/integration tests). */
  get lastTransport(): MusicalTransport | null { return this.transport }
  /** Last received context (for diagnostics/integration tests). */
  get lastContext(): MusicalContext | null { return this.context }

  constructor(opts: SamplerDeviceOptions) {
    this.opts = opts
  }

  capabilities(): DeviceCapabilities {
    return {
      audio: true,
      midi: false,
      inputs: 0,
      outputs: 1,
      voices: this.opts.voiceCount,
      latencyMs: 12,
      // Roles advertise what the device can realize (for host discovery via findByRole).
      // Must match samplerCapabilities in sampler-factory.ts.
      roles: ['sampler', 'kick', 'bass', 'hat', 'perc', 'snare', 'clap', 'lead', 'fx'],
    }
  }

  onTransport(transport: MusicalTransport): void {
    this.transport = transport
    // Sync delay to BPM (realization concern — delay time follows tempo).
    this.opts.audioGraph.syncDelayToBpm(transport.bpm)
  }

  onContext(context: MusicalContext): void {
    // Context is received but NOT currently used for selection.
    // Kept for future context-aware selection (e.g. softer kicks in BREAK).
    // See selector.ts honesty fix.
    this.context = context
  }

  onEvent(event: MusicalEvent): void {
    this.eventsReceived += 1
    if (event.type !== 'note') return
    this.handleNoteEvent(event as NoteEvent)
  }

  onStart?(): void {
    this.started = true
    this.opts.scheduler.start()
    this.opts.onReady?.()
  }

  onStop?(): void {
    this.started = false
    this.opts.scheduler.stop()
    this.opts.voicePool.panic()
  }

  reportLatencyMs?(): number {
    return 12
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private handleNoteEvent(event: NoteEvent): void {
    const parsed = parseChannel(event.channel)
    const bus = roleToBus(parsed.role)

    // Selection — genuinely deterministic (seeded, stateless).
    // seed comes from transport.revision (stable per transport state).
    // phraseIndex is derived statelessly from transport.bar (read-only).
    const seed = this.transport?.revision ?? 0
    const phraseIndex = this.transport
      ? Math.floor(Math.max(0, this.transport.bar) / this.barsPerPhrase)
      : 0
    const selection = this.opts.selectionPolicy.selectWithNote(
      {
        role: parsed.role,
        bank: parsed.bank,
        velocity: event.velocity,
        phraseIndex,
        seed,
      },
      event.note
    )

    if (selection === null) {
      this.notesSkipped += 1
      // Graceful: no sample for this role — skip silently. No invented music.
      return
    }

    const asset = this.opts.library.get(selection.sampleId)
    if (!asset) {
      this.notesSkipped += 1
      return
    }

    const decay = this.opts.selectionPolicy.decayFor(parsed.role)

    // Queue the voice trigger at event.at (device-local realization scheduling).
    // The scheduler does NOT decide musical timing — it only fires at the
    // AudioContext time the host already chose.
    const scheduledEvent: ScheduledSampleEvent = {
      at: event.at,
      sampleId: selection.sampleId,
      buffer: asset.audioBuffer,
      bus,
      opts: {
        at: event.at,
        playbackRate: selection.playbackRate,
        gain: selection.gain,
        pan: selection.pan,
        decay,
      },
    }
    this.opts.scheduler.schedule(scheduledEvent)
    this.notesTriggered += 1
  }

  // ─── public accessors (for UI / tests) ─────────────────────────────────────

  get isStarted(): boolean {
    return this.started
  }

  get librarySize(): number {
    return this.opts.library.size
  }

  get activeVoices(): number {
    return this.opts.voicePool.activeCount
  }

  get pendingEvents(): number {
    return this.opts.scheduler.pendingCount
  }
}

/**
 * Wire the trigger callback: when the realization scheduler fires an event,
 * allocate a voice from the pool, route it to the correct bus, and trigger it.
 */
export function wireSchedulerTrigger(
  scheduler: RealizationScheduler,
  voicePool: VoicePool<SampleVoice>,
  audioGraph: AudioGraph
): void {
  scheduler.setTriggerFn((event: ScheduledSampleEvent) => {
    const voice = voicePool.allocate()
    const busInput = audioGraph.getBusInput(event.bus as ReturnType<typeof roleToBus>)
    voice.connectTo(busInput)
    voice.trigger(event.buffer, event.opts)
  })
}
