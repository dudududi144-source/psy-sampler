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
import { parseChannel, roleToBus, type SampleRole, type VoiceTriggerOptions, type VoiceFXOptions } from './types'

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
  /**
   * Per-role hit counter for deterministic round-robin selection. Increments on
   * every note-on (after velocity-layer filtering succeeds). The counter is
   * EVENT-ORDER-DEPENDENT (not wall-clock): two runs receiving the same
   * NoteEvents in the same order produce the same hitIndex sequence → the same
   * round-robin sample selection → byte-identical audio. This is how Kontakt
   * and SMPLR round-robin works, and it eliminates machine-gunning without
   * breaking the determinism contract.
   */
  private readonly hitCounters = new Map<SampleRole, number>()
  /**
   * Per-role FX chain options (Phase 1.6.2). Set externally via setRoleFx();
   * merged into VoiceTriggerOptions on every note-on. Per-role granularity
   * (not per-sample) — every sample in a role shares the same FX.
   *
   * This is the foundation for a full modulation matrix (Phase 1.7):
   * eventually every parameter here will be modulatable by LFOs, envelopes,
   * and MIDI CC. For MVP it's a static per-role setting.
   */
  private readonly perRoleFx = new Map<SampleRole, VoiceFXOptions>()
  /** Counters for observability. */
  eventsReceived = 0
  notesTriggered = 0
  notesSkipped = 0
  /** Last event processed (for debug overlay). */
  lastEvent: { channel: string; note: number; velocity: number; at: number; sampleId?: string; triggered: boolean } | null = null

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
      // Roles match the SampleRole enum in types.ts exactly.
      roles: ['sampler', 'kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'],
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

  /**
   * Set per-role FX chain options (Phase 1.6.2).
   *
   * The FX chain is applied to EVERY trigger of the given role. Per-role
   * granularity (not per-sample) — every sample in a role shares the same FX.
   *
   * Calling with `null` clears the FX for that role (back to bypass).
   *
   * @param role The role to apply FX to.
   * @param fx The FX options (transient, bitcrusher, saturation). null = clear.
   */
  setRoleFx(role: SampleRole, fx: VoiceFXOptions | null): void {
    if (fx === null) {
      this.perRoleFx.delete(role)
    } else {
      this.perRoleFx.set(role, fx)
    }
  }

  /**
   * Get the current per-role FX options. Returns undefined if no FX set.
   */
  getRoleFx(role: SampleRole): VoiceFXOptions | undefined {
    return this.perRoleFx.get(role)
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
    // GUARD: reject unknown channels instead of blindly routing to the drum bus.
    // This is a correctness fix — previously parseChannel did a blind `as SampleRole`
    // cast and unknown roles silently landed on the drum bus via roleToBus's default.
    if (parsed.role === null) {
      this.notesSkipped += 1
      this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, triggered: false }
      return
    }
    const role = parsed.role
    const bus = roleToBus(role)

    // Selection — genuinely deterministic (seeded, stateless).
    // seed comes from transport.revision (stable per transport state).
    // phraseIndex is derived statelessly from transport.bar (read-only).
    // hitIndex is the per-role note-on counter (deterministic round-robin).
    const seed = this.transport?.revision ?? 0
    const phraseIndex = this.transport
      ? Math.floor(Math.max(0, this.transport.bar) / this.barsPerPhrase)
      : 0
    const hitIndex = this.hitCounters.get(role) ?? 0
    const selection = this.opts.selectionPolicy.selectWithNote(
      {
        role,
        bank: parsed.bank,
        velocity: event.velocity,
        phraseIndex,
        seed,
        hitIndex,
      },
      event.note
    )

    if (selection === null) {
      this.notesSkipped += 1
      this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, triggered: false }
      // Graceful: no sample for this role — skip silently. No invented music.
      return
    }

    const asset = this.opts.library.get(selection.sampleId)
    if (!asset) {
      this.notesSkipped += 1
      this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, triggered: false }
      return
    }

    this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, sampleId: selection.sampleId, triggered: true }

    const decay = this.opts.selectionPolicy.decayFor(role)

    // Trigger sidechain ducking when a kick fires (if enabled).
    if (role === 'kick') {
      this.opts.audioGraph.triggerSidechain(event.at)
    }

    // Queue the voice trigger at event.at (device-local realization scheduling).
    // The scheduler does NOT decide musical timing — it only fires at the
    // AudioContext time the host already chose.
    const scheduledEvent: ScheduledSampleEvent = {
      at: event.at,
      sampleId: selection.sampleId,
      buffer: asset.audioBuffer,
      bus,
      role,
      opts: {
        at: event.at,
        playbackRate: selection.playbackRate,
        gain: selection.gain,
        pan: selection.pan,
        decay,
        // Phase 1.6.2: attach per-role FX if set.
        fx: this.perRoleFx.get(role),
      },
    }
    this.opts.scheduler.schedule(scheduledEvent)
    this.notesTriggered += 1
    // Advance the per-role hit counter for deterministic round-robin.
    // Only incremented on a successful trigger (skips don't consume an RR slot).
    this.hitCounters.set(role, hitIndex + 1)
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
 * Choke-group map. When a voice with role R fires, every currently-sounding
 * voice whose tag (role) is in CHOKE_GROUPS[R] is choked (fast 2ms fade-out).
 *
 * This is the drum-sampler standard: a closed hi-hat cuts off any open hi-hat,
 * mimicking a physical hi-hat that can't be open and closed at once. Kontakt
 * calls these "voice groups"; Ableton Drum Rack calls them "choke"; SMPLR uses
 * `offBy`. Without this, open + closed hats stack into a wash — a tell-tale sign
 * of an amateur drum sampler.
 *
 * Keys are the TRIGGERING role; values are the roles to cut off.
 */
const CHOKE_GROUPS: Record<SampleRole, SampleRole[]> = {
  kick: [],
  bass: [],
  lead: [],
  // Closed hat chokes open hat — the canonical drum-sampler choke.
  'hat-closed': ['hat-open'],
  'hat-open': [],
  clap: [],
  perc: [],
  texture: [],
  fx: [],
}

/**
 * Realize ONE scheduled event: apply choke groups, allocate a voice, tag it,
 * route to bus, trigger. Stateless (other than voice-pool side effects) —
 * shared by the live RealizationScheduler (via wireSchedulerTrigger) and the
 * offline renderer (which calls it directly without a scheduler).
 */
export function realizeScheduledEvent(
  event: ScheduledSampleEvent,
  voicePool: VoicePool<SampleVoice>,
  audioGraph: AudioGraph
): void {
  // 1. Apply choke groups: choke (fast fade) any active voice whose tag is a
  //    choke target of the triggering role.
  const targets = CHOKE_GROUPS[event.role]
  if (targets && targets.length > 0) {
    const targetSet = new Set<SampleRole>(targets)
    for (const v of voicePool.all) {
      if (v.active && v.tag != null && targetSet.has(v.tag as SampleRole)) {
        v.choke(event.at)
      }
    }
  }
  // 2. Allocate a voice (round-robin; steals oldest if all active).
  const voice = voicePool.allocate()
  // 3. Tag it with the role so future chokes can find it.
  voice.tag = event.role
  // 4. Route to the correct bus (sets the NEXT trigger's output — does NOT
  //    affect any in-flight tail on this voice).
  const busInput = audioGraph.getBusInput(event.bus)
  voice.connectTo(busInput)
  // 5. Trigger.
  voice.trigger(event.buffer, event.opts)
}

/**
 * Wire the trigger callback: when the realization scheduler fires an event,
 * delegate to realizeScheduledEvent (with error catching so one bad event
 * doesn't kill the tick loop).
 */
export function wireSchedulerTrigger(
  scheduler: RealizationScheduler,
  voicePool: VoicePool<SampleVoice>,
  audioGraph: AudioGraph
): void {
  scheduler.setTriggerFn((event: ScheduledSampleEvent) => {
    realizeScheduledEvent(event, voicePool, audioGraph)
  })
}
