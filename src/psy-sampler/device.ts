// PSY Sampler — SamplerDevice.
// Implements the canonical PsyDevice interface (verbatim from psy-foundation).
//
// Responsibilities (HOW layer only — never WHAT):
//   - Receive MusicalTransport (bpm, origin.audioTime) for scheduling.
//   - Receive MusicalContext (section, energy, style) for selection.
//   - Receive MusicalEvent (NoteEvent) → select sample → schedule voice.
//   - Own its SampleLibrary, VoicePool, SelectionPolicy, RuntimeScheduler, AudioGraph.
//
// The device NEVER:
//   - Decides WHAT to play (host's musical director decides via NoteEvents).
//   - Decides WHEN to play (host sets NoteEvent.at).
//   - Touches the transport (host owns DemoTransport/TransportClock).
//   - Generates composition (foundation's music package does that).

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
import type { RuntimeScheduler, ScheduledSampleEvent } from './scheduler'
import type { AudioGraph } from './audio-graph'
import type { SampleVoice } from './voice'
import { parseChannel, roleToBus, type SampleRole } from './types'

export interface SamplerDeviceOptions {
  audioContext: AudioContext
  library: SampleLibrary
  selectionPolicy: SelectionPolicy
  scheduler: RuntimeScheduler
  audioGraph: AudioGraph
  voicePool: VoicePool<SampleVoice>
  /** Max voices (for capabilities report). */
  voiceCount: number
  /** Manifest URL (for re-loading). */
  manifestUrl: string
  /** Whether the device has been started. */
  onReady?: () => void
}

export class SamplerDevice implements PsyDevice {
  readonly id = 'psy-sampler'
  private transport: MusicalTransport | null = null
  private context: MusicalContext | null = null
  private started = false
  private readonly opts: SamplerDeviceOptions
  /** Phrase bar counter — increments each bar, resets at phrase boundary (every 8 bars). */
  private phraseBar = 0
  private readonly barsPerPhrase = 8
  private lastBar = -1
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
      latencyMs: 12, // 25ms timer / 2 + scheduling jitter
      roles: ['sampler', 'kick', 'bass', 'hat', 'perc', 'snare', 'clap', 'lead', 'fx'],
    }
  }

  onTransport(transport: MusicalTransport): void {
    this.transport = transport
    // Detect bar change → advance phrase position.
    if (transport.bar !== this.lastBar) {
      if (this.lastBar >= 0) {
        this.phraseBar = (this.phraseBar + 1) % this.barsPerPhrase
      }
      this.lastBar = transport.bar
    }
    // Sync delay to BPM.
    this.opts.audioGraph.syncDelayToBpm(transport.bpm)
  }

  onContext(context: MusicalContext): void {
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
    this.opts.selectionPolicy.reset()
    this.phraseBar = 0
    this.lastBar = -1
  }

  reportLatencyMs?(): number {
    return 12
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private handleNoteEvent(event: NoteEvent): void {
    if (!this.transport) {
      this.notesSkipped += 1
      return
    }
    const parsed = parseChannel(event.channel)
    const bus = roleToBus(parsed.role)

    // Selection — deterministic.
    const selection = this.opts.selectionPolicy.selectWithNote(
      {
        role: parsed.role,
        bank: parsed.bank,
        velocity: event.velocity,
        section: this.context?.section ?? 'DROP',
        energy: this.context?.energy ?? 0.7,
        style: this.context?.style ?? 'psytrance',
        phrasePosition: this.phraseBar,
        seed: this.transport.revision,
      },
      event.note
    )

    if (selection === null) {
      this.notesSkipped += 1
      // Graceful: no sample for this role — skip silently.
      return
    }

    const asset = this.opts.library.get(selection.sampleId)
    if (!asset) {
      this.notesSkipped += 1
      return
    }

    const decay = this.opts.selectionPolicy.decayFor(parsed.role)

    // Schedule the voice trigger.
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
 * Wire the trigger callback: when the scheduler fires an event, allocate a
 * voice from the pool, route it to the correct bus, and trigger it.
 */
export function wireSchedulerTrigger(
  scheduler: RuntimeScheduler,
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
