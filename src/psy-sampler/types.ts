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

/**
 * The complete set of valid sample roles. Used by parseChannel() to reject
 * unknown channels at the device boundary instead of silently treating them as
 * 'drum' (which would route junk to the drum bus — a latent correctness bug).
 */
export const KNOWN_ROLES: ReadonlySet<SampleRole> = new Set<SampleRole>([
  'kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx',
])

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
  /**
   * Velocity layer range [min, max] in 0..1 (copied from the manifest entry).
   * Absent = no velocity layering for this sample. See SampleManifestEntry.velocityRange.
   */
  velocityRange?: [number, number]
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

/**
 * Verification status of a sample asset.
 * Only VERIFIED and PROCEDURAL samples load at runtime.
 * UNKNOWN and QUARANTINED samples are refused by the loader.
 */
export type SampleVerification = 'VERIFIED' | 'PROCEDURAL' | 'UNKNOWN' | 'QUARANTINED'

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
  /**
   * Verification status. Controls whether the loader accepts this sample.
   * - VERIFIED: provenance confirmed, license cleared, commercially usable.
   * - PROCEDURAL: generated by code, no copyright (same rights as VERIFIED).
   * - UNKNOWN: provenance unconfirmed — loader refuses.
   * - QUARANTINED: suspected license issue — loader refuses.
   */
  verification: SampleVerification
  /**
   * Optional velocity layer range [min, max] in 0..1. When present, the
   * selector narrows candidates to those whose velocityRange contains the
   * event's velocity. Samples without a velocityRange are always eligible
   * (fallback layer). This enables multi-velocity sample sets (e.g. soft
   * kick @ 0–0.4, hard kick @ 0.4–1.0) — eliminating machine-gunning on
   * repeated hits at varying dynamics. Absent = no velocity layering.
   */
  velocityRange?: [number, number]
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
  /** The validated role, or null if the channel string is not a known role. */
  role: SampleRole | null
  bank: SampleBank | null
  /** The raw role token (for debug logging when invalid). */
  rawRole: string
}

/**
 * Parse a NoteEvent.channel string ("role" or "role:bank") into a structured
 * form. Returns role=null when the role token is not a known SampleRole — the
 * device MUST check for null and skip the event rather than routing junk to a
 * default bus. This is a correctness guard: previously the role was blindly
 * cast, which silently routed unknown channels to the drum bus.
 */
export function parseChannel(channel: string): ParsedChannel {
  const parts = channel.split(':')
  const rawRole = parts[0] ?? ''
  const role = KNOWN_ROLES.has(rawRole as SampleRole) ? (rawRole as SampleRole) : null
  const bank = parts.length > 1 && parts[1] ? parts[1] : null
  return { role, bank, rawRole }
}

// ─── Selection inputs ────────────────────────────────────────────────────────

/**
 * Inputs to SelectionPolicy.select(). All fields genuinely participate.
 * No fake parameters — every field drives the output.
 *
 * Removed (honesty fix): section / energy / style were accepted but never
 * used. When real context-aware selection is needed, add them back WITH
 * genuine participation.
 */
export interface SelectionInput {
  role: SampleRole
  bank: SampleBank | null
  velocity: number
  /**
   * Phrase index (which phrase we're in, 0-based). Drives variant rotation.
   * The host derives this from transport.bar (e.g. Math.floor(bar / barsPerPhrase)).
   * Same phraseIndex → same variant for the same role+seed.
   */
  phraseIndex: number
  /** Seed for deterministic RNG. Same seed + same inputs → same output. */
  seed: number
  /**
   * Optional deterministic hit counter for round-robin selection. The device
   * tracks a per-role counter that increments on every note-on; this value is
   * passed here so the selector can cycle through same-layer candidates
   * (true round-robin, advancing per-hit instead of per-phrase).
   *
   * Determinism contract: the counter is event-order-dependent (not wall-clock).
   * Two runs that receive the same NoteEvents in the same order produce the
   * same hitIndex sequence → the same round-robin selection → byte-identical
   * audio. This is how Kontakt/SMPLR round-robin works, and it's the standard
   * way to eliminate machine-gunning without breaking reproducibility.
   *
   * Absent = no round-robin (falls back to phrase-locked variant rotation).
   */
  hitIndex?: number
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
  /**
   * Loop mode (Phase 1.3). Default 'one-shot' (no loop).
   *   - 'one-shot': play buffer from startOffset to end, then stop.
   *   - 'forward':  play from loopStart, when reaching loopEnd, jump back
   *                 to loopStart and play forward again.
   *   - 'backward': play from loopEnd reversed, when reaching loopStart,
   *                 jump to loopEnd and play backward again.
   *   - 'ping-pong': play forward from loopStart to loopEnd, then backward
   *                 to loopStart, then forward again.
   *
   * For 'backward' and 'ping-pong', the source's playbackRate is
   * temporarily negated at the loop boundaries.
   */
  loop?: 'one-shot' | 'forward' | 'backward' | 'ping-pong'
  /**
   * Loop start offset in seconds (default 0). When loop mode is set,
   * playback begins at this offset and loops between loopStart and loopEnd.
   */
  loopStart?: number
  /**
   * Loop end offset in seconds (default: end of buffer). Must be > loopStart.
   */
  loopEnd?: number
  /**
   * Start offset in seconds (default 0). Used for one-shot playback or to
   * start a loop at a non-zero offset.
   */
  startOffset?: number
  /**
   * Reverse the entire buffer on playback (default false). This is
   * independent of loop mode — you can reverse a one-shot OR reverse
   * a looped sample. The reverse is achieved by negating playbackRate
   * and starting from the end.
   */
  reverse?: boolean
  /**
   * Per-voice FX chain (Phase 1.6). Each effect is optional; if absent,
   * that effect is bypassed. Effects chain in fixed order:
   *   source → sourceGain → [transient] → [bitcrusher] → lowpass → panner → output
   *
   * Inserting transient BEFORE bitcrusher matters: transient designer
   * amplifies sharp attacks (good for punch), bitcrusher adds lo-fi
   * harmonics (good for character). Order matters for sound design.
   */
  fx?: VoiceFXOptions
}

/**
 * Per-voice FX chain options (Phase 1.6).
 * Each effect is optional. When enabled, the effect node is inserted
 * into the voice's per-trigger chain. Effects are stateless across
 * triggers — a new chain gets fresh effect instances every time.
 *
 * This is the foundation for a full modulation matrix (Phase 1.7):
 * every parameter here will eventually be modulatable by LFOs,
 * envelopes, and MIDI CC.
 */
export interface VoiceFXOptions {
  /**
   * Transient designer: amplifies or attenuates the attack portion of
   * a sample. Positive values = sharper attack (more punch). Negative
   * = softer attack (more legato). Range -1..+1, 0 = bypass.
   *
   * Implementation: a WaveShaperNode with a custom curve that
   * emphasizes fast transients. Cheap (no FFT, no envelope follower).
   * For full ADSR-shaping we'd need an AudioWorklet — Phase 1.6 MVP
   * uses WaveShaper which is portable.
   */
  transient?: number
  /**
   * Bitcrusher: reduces sample bit-depth for lo-fi character. Range
   * 0..16 (bits). 16 = no effect (CD quality). 8 = crunchy. 4 = harsh.
   * 0 = silence.
   *
   * Implementation: a WaveShaperNode with a quantization curve. We use
   * WaveShaper instead of a ScriptProcessor/AudioWorklet because
   * WaveShaper is sample-accurate and runs on the audio thread natively
   * (no JS callback overhead).
   */
  bitcrusher?: number
  /**
   * Saturation drive (0..10). 0 = bypass. Higher = more harmonic content.
   * Distinct from the master bus saturation — this is per-voice.
   */
  saturation?: number
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
