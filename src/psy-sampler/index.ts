/**
 * PSY Sampler — Public API
 *
 * The PSY Sampler Device is a canonical realization device in the PSY family.
 * It implements `PsyDevice` from `psy-foundation` and renders `NoteEvent`s
 * as sample-based audio via a pooled voice architecture with deterministic
 * selection.
 *
 * @module psy-sampler
 *
 * @example Basic usage (with a DeviceHost)
 * ```ts
 * import { createSamplerDevice } from '@psy-sampler'
 * import { DeviceHost, InMemoryChannel } from '@psy-foundation/device-sdk'
 *
 * const channel = new InMemoryChannel('host')
 * const host = new DeviceHost(channel)
 * const bundle = createSamplerDevice({
 *   audioContext: ctx,
 *   manifestUrl: '/samples/manifest.json',
 * })
 * await bundle.load()
 * host.register(bundle.device)
 * // Publish NoteEvents → sampler renders them
 * host.publish({ type: 'note', note: 33, velocity: 0.9, duration: 0.2, channel: 'kick', at: ctx.currentTime + 0.1 })
 * ```
 *
 * @example Integration with PSY4 (via UMD bundle)
 * ```ts
 * // In PSY4's page.tsx:
 * const sampler = await import('/psy-sampler.js')
 * const bundle = sampler.createSamplerDevice({
 *   audioContext: psyLive.audioContext,  // SHARED
 *   manifestUrl: '/samples/manifest.json',
 *   outputNode: psyLive.engineBusInput, // SHARED master chain
 * })
 * bridge.register(bundle.device)
 * bundle.device.onStart?.()
 * await bundle.load()
 * ```
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Stable unique identifier for a loaded sample (e.g. "kick-psy3"). */
export type { SampleId } from './types'

/** Logical role a sample fills (kick, bass, lead, hat-closed, etc.). */
export type { SampleRole } from './types'

/** Free-form bank tag (e.g. "909", "nord", "psy3"). */
export type { SampleBank } from './types'

/** Category bucket (= SampleRole, used in manifest). */
export type { SampleCategory } from './types'

/** License + source metadata for a sample. */
export type { SampleProvenance } from './types'

/** Musical/character tags (character[], genreFit[], bpmRange, rootNote). */
export type { SampleCharacter } from './types'

/** Full metadata record for one sample. */
export type { SampleMetadata } from './types'

/** Acoustic features computed at load time (peak, rms, duration). */
export type { SampleFeatures } from './types'

/** A fully-loaded sample ready for playback. */
export type { SampleAsset } from './types'

/** Manifest entry as it appears in manifest.json. */
export type { SampleManifestEntry, SampleManifest } from './types'

/** Parsed channel string { role, bank }. */
export type { ParsedChannel } from './types'

/** The complete set of valid sample roles (used by parseChannel validation). */
export { KNOWN_ROLES } from './types'

/** Inputs to SelectionPolicy.select(). */
export type { SelectionInput, SelectionOutput } from './types'

/** Options for SampleVoice.trigger(). */
export type { VoiceTriggerOptions } from './types'

/** Per-voice FX chain options (Phase 1.6). */
export type { VoiceFXOptions } from './types'

/** Bus name (drum, music, atmos). */
export type { BusName } from './types'

// ─── Channel utilities ──────────────────────────────────────────────────────

/**
 * Parse a NoteEvent.channel string into { role, bank }.
 * Convention: "role" or "role:bank" (e.g. "kick", "kick:909").
 */
export { parseChannel } from './types'

/** Map a sample role to its default bus (drum/music/atmos). */
export { roleToBus } from './types'

// ─── Provenance ──────────────────────────────────────────────────────────────

/** Error thrown when provenance validation fails. */
export { ProvenanceError } from './provenance'

/** Validate that a manifest entry has complete provenance fields. */
export { validateProvenance } from './provenance'

/** Returns true if the sample is cleared for commercial use. */
export { isCommerciallyUsable } from './provenance'

/** Convert a manifest entry into a SampleProvenance record. */
export { provenanceFromEntry } from './provenance'

// ─── Manifest ────────────────────────────────────────────────────────────────

/** Error thrown when manifest validation fails. */
export { ManifestError } from './manifest'

/** Fetch and parse a manifest.json from a URL. */
export { loadManifest } from './manifest'

/** Validate a parsed manifest object (shape + types + verification). */
export { validateManifest } from './manifest'

// ─── Loader ──────────────────────────────────────────────────────────────────

/** Loads WAV files via fetch + decodeAudioData. */
export { SampleLoader } from './loader'

// ─── Library ─────────────────────────────────────────────────────────────────

/** In-memory sample store with parallel loading + runtime import. */
export { SampleLibrary, type LibraryQuery, type LibraryLoadResult } from './library'

// ─── Voice ───────────────────────────────────────────────────────────────────

/** One sample-playback voice with per-source gain for click-free stealing. */
export { SampleVoice, type SampleVoiceInit } from './voice'

// ─── Variance rules ──────────────────────────────────────────────────────────

/** Phase-safe pitch/gain/pan variance rules per category. */
export { DEFAULT_VARIANCE_RULES, type VarianceRule } from './variance-rules'

// ─── Selector ────────────────────────────────────────────────────────────────

/** Deterministic, stateless sample selection policy. */
export { SelectionPolicy, type SelectionPolicyOptions } from './selector'

/** Pitch ratio from source MIDI to target MIDI (2^((target-source)/12)). */
export { pitchRatio } from './selector'

// ─── Realization scheduler ───────────────────────────────────────────────────

/**
 * Device-local realization scheduler. Fires voices at host-decided event.at.
 * NOT a musical scheduler — does NOT decide timing.
 */
export { RealizationScheduler, type ScheduledSampleEvent, type VoiceTriggerFn } from './realization-scheduler'

// ─── Audio graph ─────────────────────────────────────────────────────────────

/** 3-bus mixer with sidechain ducking, delay, and reverb. */
export { AudioGraph, type AudioGraphOptions } from './audio-graph'

// ─── Device ──────────────────────────────────────────────────────────────────

/** The canonical PsyDevice implementation for sample realization. */
export { SamplerDevice, type SamplerDeviceOptions } from './device'

/** Wire the scheduler's trigger callback to the voice pool + audio graph. */
export { wireSchedulerTrigger } from './device'

/** Realize a single scheduled event (choke + allocate + route + trigger). */
export { realizeScheduledEvent } from './device'

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a fully-wired SamplerDevice bundle.
 * @param opts.audioContext - The AudioContext (shared with host in production)
 * @param opts.manifestUrl - URL to the sample manifest JSON
 * @param opts.outputNode - External output (host bus) or null for ctx.destination
 * @returns Bundle with device, library, scheduler, audioGraph, voicePool, load(), dispose()
 */
export { createSamplerDevice, type CreateSamplerOptions, type SamplerBundle } from './factory'

// ─── Slicer ──────────────────────────────────────────────────────────────────

/** A detected onset (time + spectral-flux strength). */
export type { Onset, DetectOnsetsOptions } from './slicer'

/** Detect onsets in a mono signal using spectral flux. */
export { detectOnsets } from './slicer'

/** Estimate BPM from onset spacing. */
export { estimateBpmFromOnsets, type BpmEstimate } from './slicer'

/** Split an AudioBuffer at the given onset times. */
export { sliceAudioBuffer } from './slicer'

/** Downmix an AudioBuffer to a mono Float32Array. */
export { toMono as sliceToMono } from './slicer'
export { toMono } from './slicer'

// ─── Time-stretcher (Phase 1.1 + 1.2) ────────────────────────────────────────

/** Granular pitch-shift + time-stretch. */
export { granularStretch, pitchShift, timeStretch, pitchAndTempoShift } from './time-stretcher'

// ─── Sample editor (Phase 2.3) ───────────────────────────────────────────────

/** Offline sample editing: trim, fade, normalize, reverse. */
export {
  trimBuffer,
  fadeInOut,
  normalizeBuffer,
  reverseBuffer,
  applyEdits,
  type SampleEditOptions,
} from './sample-editor'
