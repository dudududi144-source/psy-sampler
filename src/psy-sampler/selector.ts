// PSY Sampler — SelectionPolicy.
// Deterministic sample selection. Genuinely seeded — no mutable counters, no fake parameters.
//
// Inputs that drive selection: role, bank, velocity, phrasePosition, seed.
// All five genuinely participate. No dead inputs.
//
// Determinism contract:
//   Same (seed, role, bank, velocity, phrasePosition) + same library → same output, always.
//   No Math.random(). No mutable internal state. Stateless derivation.
//
// What was removed (honesty fix):
//   section / energy / style were accepted but never used. Removed from the API.
//   When real context-aware selection is needed (e.g. "softer kicks in BREAK"),
//   add them back WITH genuine participation — not as theater.

import { Rng } from '../psy-foundation-shim/voice-pool'
import type { SampleLibrary } from './library'
import type {
  SelectionInput,
  SelectionOutput,
  SampleId,
  SampleRole,
  SampleBank,
} from './types'
import { DEFAULT_VARIANCE_RULES, type VarianceRule } from './variance-rules'

/**
 * Pitch ratio from a source MIDI note to a target MIDI note.
 * ratio = 2^((target - source) / 12)
 * Safe fallback: if source is NaN/0, returns 1.0.
 */
export function pitchRatio(sourceMidi: number, targetMidi: number): number {
  if (!Number.isFinite(sourceMidi) || sourceMidi === 0) return 1.0
  return Math.pow(2, (targetMidi - sourceMidi) / 12)
}

export interface SelectionPolicyOptions {
  /** Default decay per category, in seconds. */
  defaultDecay?: Partial<Record<SampleRole, number>>
  /** Override variance rules. */
  varianceRules?: Record<SampleRole, VarianceRule>
}

/**
 * Deterministic, stateless sample selection.
 *
 * The variant index is derived purely from (seed, role, phrasePosition) via
 * a seeded Rng — NO mutable counters. Same inputs always produce the same
 * variant, the same pitch/gain/pan variance, and the same sampleId.
 *
 * This replaces the previous RoundRobinBank which had mutable internal state
 * and produced different outputs for identical inputs.
 */
export class SelectionPolicy {
  private readonly defaultDecay: Partial<Record<SampleRole, number>>
  private readonly varianceRules: Record<SampleRole, VarianceRule>

  constructor(
    private readonly library: SampleLibrary,
    opts: SelectionPolicyOptions = {}
  ) {
    this.varianceRules = opts.varianceRules ?? DEFAULT_VARIANCE_RULES
    this.defaultDecay = opts.defaultDecay ?? {
      kick: 0.3,
      bass: 0.4,
      lead: 0.5,
      'hat-closed': 0.05,
      'hat-open': 0.2,
      clap: 0.15,
      perc: 0.1,
      texture: 1.5,
      fx: 0.8,
    }
  }

  /**
   * Select a sample + playback parameters for the given input.
   * Returns null if no sample is available for the role (graceful — caller skips).
   *
   * Determinism: same (seed, role, bank, velocity, phraseIndex) + same library
   * → identical output, always. No mutable state. No Math.random().
   */
  select(input: SelectionInput): SelectionOutput | null {
    // 1. Find candidate sampleIds for this role (+ optional bank filter).
    const candidates = this.findCandidates(input.role, input.bank)
    if (candidates.length === 0) return null

    // 2. Derive variant index purely from (seed, role, phraseIndex).
    //    Stateless: no mutable counters. Same inputs → same variant.
    const variant = this.deriveVariant(input.seed, input.role, input.phraseIndex)

    // 3. Pick the sampleId at the variant index (wrap if fewer samples than variants).
    const sampleId = candidates[variant % candidates.length] as SampleId

    // 4. Derive pitch/gain/pan variance from the variant (deterministic).
    const rule = this.varianceRules[input.role] ?? DEFAULT_VARIANCE_RULES[input.role]
    const { pitch, gain, pan } = this.deriveVariance(variant, rule)

    // 5. Gain = velocity × variance gain. Clamp to [0, 1.5].
    const finalGain = Math.max(0, Math.min(1.5, input.velocity * gain))

    // 6. Pan (clamped).
    const finalPan = Math.max(-1, Math.min(1, pan))

    return { sampleId, playbackRate: pitch, gain: finalGain, pan: finalPan }
  }

  /**
   * Select with an explicit target MIDI note (for pitched roles).
   * Combines variant pitch variance with note-derived pitch ratio.
   */
  selectWithNote(input: SelectionInput, targetMidi: number): SelectionOutput | null {
    const base = this.select(input)
    if (base === null) return null
    const asset = this.library.get(base.sampleId)
    if (!asset) return base
    const rootNote = asset.metadata.character.rootNote
    const noteRatio = pitchRatio(rootNote, targetMidi)
    return {
      ...base,
      playbackRate: base.playbackRate * noteRatio,
    }
  }

  /** Decay (envelope length) for a role. */
  decayFor(role: SampleRole): number {
    return this.defaultDecay[role] ?? 0.3
  }

  /** No-op (stateless — kept for API compatibility with device.ts). */
  reset(): void {}

  // ─── internals ──────────────────────────────────────────────────────────────

  /**
   * Derive a variant index deterministically from (seed, role, phraseIndex).
   * Uses a seeded Rng (mulberry32). Stateless — no mutable counters.
   *
   * The variant is stable for all bars within a phrase (same phraseIndex →
   * same variant), and changes when phraseIndex advances. This gives
   * phrase-locked round-robin rotation without mutable state.
   */
  private deriveVariant(seed: number, role: SampleRole, phraseIndex: number): number {
    const rule = this.varianceRules[role] ?? DEFAULT_VARIANCE_RULES[role]
    const variants = rule.variants

    // Derive a per-role, per-seed sub-RNG. The role string is hashed into
    // the seed so different roles at the same phraseIndex get different
    // variants (otherwise kick and hat would always pick the same index).
    const roleSeed = this.hashSeed(seed, role)
    const rng = new Rng(roleSeed)

    // Advance the RNG (phraseIndex + 1) times and pick the last value.
    // This gives a stable per-phrase variant that rotates on phrase boundary.
    const idx = Math.max(0, Math.floor(phraseIndex))
    let variant = 0
    for (let i = 0; i <= idx; i++) {
      variant = rng.int(0, variants - 1)
    }
    return variant
  }

  /**
   * Derive pitch/gain/pan variance from a variant index + rule.
   * Deterministic: same (variant, rule) → same variance.
   */
  private deriveVariance(variant: number, rule: VarianceRule): {
    pitch: number
    gain: number
    pan: number
  } {
    const variants = rule.variants
    const half = (variants - 1) / 2
    const microVar = (variant % variants) - half

    // Normalize -0 to 0.
    const pitch = 1.0 + (rule.pitchVar === 0 ? 0 : (microVar * rule.pitchVar) / half)
    const gain = 1.0 + (rule.gainVar === 0 ? 0 : (microVar * rule.gainVar) / half)
    const pan = rule.panVar === 0 ? 0 : (microVar * rule.panVar) / half

    return { pitch, gain, pan }
  }

  private findCandidates(role: SampleRole, bank: SampleBank | null): SampleId[] {
    let candidates = this.library.query({ category: role })
    if (bank !== null) {
      const filtered = candidates.filter((id) => {
        const asset = this.library.get(id)
        return asset?.metadata.subcategory === bank
      })
      if (filtered.length > 0) candidates = filtered
    }
    return candidates
  }

  /** Hash a role string into a 32-bit integer to combine with the seed. */
  private hashSeed(seed: number, role: string): number {
    let h = seed >>> 0
    for (let i = 0; i < role.length; i++) {
      h = Math.imul(h ^ role.charCodeAt(i), 0x01000193) >>> 0
    }
    return h
  }
}
