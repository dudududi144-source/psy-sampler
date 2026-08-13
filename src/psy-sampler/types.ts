// PSY Sampler — type definitions.
// All sampler-specific types live here. Foundation contracts are imported from
// the shim (verbatim from psy-foundation).

// ─── Identifiers ─────────────────────────────────────────────────────────────

/** Stable unique identifier for a loaded sample. e.g. "kick-909-02". */
export type SampleId = string

/** Logical role a sample fills in the mix. Mirrors the channel convention. */
export type SampleRole =
  | 'kick'
  | 'bass'
  | 'lead'
  | 'hat-closed'
  | 'hat-open'
  | 'clap'
  | 'perc'
  | 'texture'
  | 'fx'

/** Free-form bank tag, e.g. "909", "nord", "md", "psy3". */
export type SampleBank = string

/** Category bucket used by the manifest. */
export type SampleCategory = SampleRole

// ─── Provenance ──────────────────────────────────────────────────────────────

/**
 * License + source metadata. Every sample MUST carry this.
 * Policy (from psy4 SAMPLE_MANIFEST.json):
 *   "NEVER assume a random downloaded sample is commercially usable.
 *    All imported samples MUST have explicit license metadata."
 */
export interface SampleProvenance {
  /** Human-readable source description. */
  source: string
  /** Author or rights holder. */
  author: string
  /** License name (e.g. "CC0 1.0", "CC-BY 4.0", "PSY3 reference — no copyright restriction"). */
  license: string
  /** Optional URL to the license text or evidence of permission. */
  licenseUrl: string | null
  /** Whether the sample may be used in commercial releases. If false, sampler refuses to load. */
  commercialUse: boolean
  /** Attribution string required by the license, if any. */
  attribution: string | null
  /** ISO date the sample was acquired/created. */
  dateAcquired: string
  /** Free-form usage restrictions (e.g. "None — freely usable"). */
  usageRestrictions: string
}

// ─── Metadata ────────────────────────────────────────────────────────────────

/** Musical / character tags attached to a sample, used by SelectionPolicy. */
export interface SampleCharacter {
  /** Sonic character descriptors: "deep", "punchy", "bright", "dark", "aggressive", "warm". */
  character: string[]
  /** Genres this sample fits: "psytrance", "techno", "trance", "progressive", "dark-psy", "goa". */
  genreFit: string[]
  /** BPM range where this sample sits naturally. */
  bpmRange: [number, number]
  /** MIDI note at which the sample sounds at its native pitch (playbackRate = 1.0). */
  rootNote: number
}

/** Full metadata record for one sample. */
export interface SampleMetadata {
  id: SampleId
  /** Relative URL path to the WAV file, e.g. "samples/kick-909-02.wav". */
  file: string
  category: SampleCategory
  subcategory: SampleBank
  provenance: SampleProvenance
  character: SampleCharacter
  /** Duration in seconds (filled at load time). */
  duration: number
  /** Sample rate in Hz (filled at load time). */
  sampleRate: number
  /** Channel count (filled at load time). */
  channels: number
}

// ─── Features (computed at load time) ────────────────────────────────────────

/** Acoustic features computed once at load. Cheap — no DFT for MVP. */
export interface SampleFeatures {
  /** Peak amplitude (0..1). */
  peak: number
  /** RMS level (0..1). */
  rms: number
  /** Duration in seconds. */
  duration: number
  /** Sample rate in Hz. */
  sampleRate: number
  /** Channel count (after optional downmix). */
  channels: number
}

// ─── Asset (loaded, in-memory) ───────────────────────────────────────────────

/**
 * A fully-loaded sample ready for playback.
 * The audioBuffer is the decoded Web Audio AudioBuffer.
 * For worklet mode (future), a mono Float32Array view is also kept.
 */
export interface SampleAsset {
  metadata: SampleMetadata
  audioBuffer: AudioBuffer
  /** Mono Float32Array (channel 0, or downmix). Used for worklet transfer / analysis. */
  monoData: Float32Array
  features: SampleFeatures
}

// ─── Manifest ────────────────────────────────────────────────────────────────

/** Manifest entry as it appears in manifest.json (before features are computed). */
export interface SampleManifestEntry {
  id: SampleId
  file: string
  category: SampleCategory
  subcategory: SampleBank
  source: string
  author: string
  license: string
  licenseUrl: string | null
  commercialUse: boolean
  attribution: string | null
  dateAcquired: string
  usageRestrictions: string
  character: string[]
  genreFit: string[]
  bpmRange: [number, number]
  rootNote: number
}

export interface SampleManifest {
  version: string
  description: string
  generated: string
  licensePolicy: string
  samples: SampleManifestEntry[]
}

// ─── Channel convention ──────────────────────────────────────────────────────

/**
 * The sampler parses NoteEvent.channel (a free-form string) into a role + optional bank.
 * Convention: "role" or "role:bank". Examples: "kick", "kick:909", "hat-closed", "lead".
 *
 * This is the sampler's OWN convention — it does NOT modify the foundation's NoteEvent type.
 * The channel string is the only carrier of selection intent (GAP-S3 in audit).
 */
export interface ParsedChannel {
  role: SampleRole
  bank: SampleBank | null
}

export function parseChannel(channel: string): ParsedChannel {
  const parts = channel.split(':')
  const role = parts[0] as SampleRole
  const bank = parts.length > 1 && parts[1] ? parts[1] : null
  return { role, bank }
}

// ─── Selection inputs ────────────────────────────────────────────────────────

/** Inputs to SelectionPolicy.select(). All fields must be deterministic. */
export interface SelectionInput {
  role: SampleRole
  bank: SampleBank | null
  velocity: number
  section: string
  energy: number
  style: string
  /** Phrase position (0-based bar index within a phrase). Round-robin rotates on phrase boundary. */
  phrasePosition: number
  /** Seed for deterministic RNG. */
  seed: number
}

/** Output of SelectionPolicy.select(). */
export interface SelectionOutput {
  sampleId: SampleId
  /** playbackRate multiplier (1.0 = native pitch). */
  playbackRate: number
  /** Gain multiplier (0..1, applied on top of velocity). */
  gain: number
  /** Pan (-1..1). 0 = centre. */
  pan: number
}

// ─── Voice trigger options ───────────────────────────────────────────────────

export interface VoiceTriggerOptions {
  /** AudioContext time at which to start. */
  at: number
  /** playbackRate multiplier. */
  playbackRate: number
  /** Overall gain (post-velocity). */
  gain: number
  /** Pan (-1..1). */
  pan: number
  /** Decay in seconds (envelope). */
  decay: number
}

// ─── Bus names ───────────────────────────────────────────────────────────────

export type BusName = 'drum' | 'music' | 'atmos'

/** Maps a sample role to its default bus. */
export function roleToBus(role: SampleRole): BusName {
  switch (role) {
    case 'kick':
    case 'hat-closed':
    case 'hat-open':
    case 'clap':
    case 'perc':
      return 'drum'
    case 'bass':
    case 'lead':
      return 'music'
    case 'texture':
    case 'fx':
      return 'atmos'
    default:
      return 'drum'
  }
}
