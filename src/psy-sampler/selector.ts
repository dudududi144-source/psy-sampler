// PSY Sampler — SelectionPolicy.
// Deterministic sample selection. Genuinely seeded — no mutable counters, no fake parameters.
//
// Inputs that drive selection: role, bank, velocity, phraseIndex, seed.
// All five genuinely participate. No dead inputs.
//
// Determinism contract:
//   Same (seed, role, bank, velocity, phraseIndex) + same library → same output, always.
//   No Math.random(). No mutable internal state. Stateless derivation.
//
// Pitch handling:
//   Pitched roles (bass, lead) use pitchRatio(rootNote, targetMidi).
//   Unpitched roles (kick, hat-closed, hat-open, clap, perc, texture, fx) skip pitchRatio
//   entirely — they play at native pitch (playbackRate = 1.0 × variance only).
//   This fixes the kick-2-octaves-up bug where note.midi ?? 60 was treated as authoritative.

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
 * Roles that are pitched — they use pitchRatio(rootNote, targetMidi).
 * All other roles are unpitched — they play at native pitch.
 */
const PITCHED_ROLES: Set<SampleRole> = new Set(['bass', 'lead'])

/**
 * Pitch ratio from a source MIDI note to a target MIDI note.
 * ratio = 2^((target - source) / 12)
 * Safe fallback: if source is NaN/0 (uninitialized), returns 1.0.
 * targetMidi=0 (C-1) is valid and computes a real ratio.
 */
export function pitchRatio(sourceMidi: number, targetMidi: number): number {
  if (!Number.isFinite(sourceMidi) || sourceMidi === 0) return 1.0
  if (!Number.isFinite(targetMidi)) return 1.0
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
 * The variant index is derived purely from (seed, role, phraseIndex) via
 * a seeded Rng — NO mutable counters, NO O(n) loops. O(1) hash-based derivation.
 *
 * Same inputs always produce the same variant, the same pitch/gain/pan variance,
 * and the same sampleId.
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
   * Determinism: same (seed, role, bank, velocity, phraseIndex, hitIndex) + same
   * library → identical output, always. No mutable state. No Math.random().
   *
   * Velocity layers: if any candidate for this role has a velocityRange, the
   * selector narrows to those whose range contains the event velocity. Samples
   * without a velocityRange are always eligible (fallback layer). This enables
   * multi-velocity sample sets without machine-gunning.
   *
   * Round-robin: if hitIndex is provided AND multiple candidates remain after
   * velocity-layer filtering, the selector cycles through them by hitIndex
   * (true per-hit round-robin, advancing every note-on). If hitIndex is absent,
   * falls back to phrase-locked variant rotation (changes every phrase).
   */
  select(input: SelectionInput): SelectionOutput | null {
    // 1. Find candidate sampleIds for this role (+ optional bank filter).
    const allCandidates = this.findCandidates(input.role, input.bank)
    if (allCandidates.length === 0) return null

    // 2. Velocity-layer filtering: if ANY candidate has a velocityRange, narrow
    //    to those whose range contains the event velocity. If none match, fall
    //    back to candidates WITHOUT a velocityRange (the default layer).
    const candidates = this.filterByVelocity(allCandidates, input.velocity)
    if (candidates.length === 0) return null

    // 3. Pick the variant index.
    //    - If hitIndex is provided → round-robin: candidates[hitIndex % len].
    //      This advances per-hit, eliminating machine-gunning on repeated notes.
    //    - Else → phrase-locked variant: deriveVariant(seed, role, phraseIndex).
    //      This changes every phrase, providing musical variation.
    let variant: number
    let sampleId: SampleId
    if (input.hitIndex !== undefined && candidates.length > 1) {
      variant = input.hitIndex % candidates.length
      sampleId = candidates[variant]!
    } else {
      variant = this.deriveVariant(input.seed, input.role, input.phraseIndex)
      sampleId = candidates[variant % candidates.length]!
    }

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
   * Select with an explicit target MIDI note.
   *
   * For PITCHED roles (bass, lead): combines variant pitch variance with
   * note-derived pitch ratio (pitchRatio(rootNote, targetMidi)).
   *
   * For UNPITCHED roles (kick, hat, clap, perc, texture, fx): ignores targetMidi
   * entirely — plays at native pitch. This fixes the bug where note.midi ?? 60
   * was treated as authoritative pitch for unpitched voices, causing kicks to
   * play 2 octaves up.
   */
  selectWithNote(input: SelectionInput, targetMidi: number): SelectionOutput | null {
    const base = this.select(input)
    if (base === null) return null

    // Unpitched roles: no pitch shifting. Return base (variant variance only).
    if (!PITCHED_ROLES.has(input.role)) {
      return base
    }

    // Pitched roles: apply pitchRatio(rootNote, targetMidi).
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
   * O(1) — hash-based, no loop. Uses a single Rng.next() call.
   *
   * The variant is stable for all bars within a phrase (same phraseIndex →
   * same variant), and changes when phraseIndex advances.
   */
  private deriveVariant(seed: number, role: SampleRole, phraseIndex: number): number {
    const rule = this.varianceRules[role] ?? DEFAULT_VARIANCE_RULES[role]
    const variants = rule.variants

    // Combine seed + role + phraseIndex into a single hash → one Rng call.
    const combinedSeed = this.hashSeed3(seed, role, Math.max(0, Math.floor(phraseIndex)))
    const rng = new Rng(combinedSeed)
    return rng.int(0, variants - 1)
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
    // Guard: variants < 2 would divide by zero (half = (variants-1)/2 = 0).
    if (variants < 2) {
      return { pitch: 1.0, gain: 1.0, pan: 0 }
    }
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

  /**
   * Narrow candidates by velocity layer. If ANY candidate has a velocityRange,
   * keep only those whose [min, max] contains `velocity`. If none match the
   * velocity, fall back to candidates WITHOUT a velocityRange (default layer).
   * If NO candidate has a velocityRange, return all (no layering configured).
   */
  private filterByVelocity(candidates: SampleId[], velocity: number): SampleId[] {
    const withRange: SampleId[] = []
    const withoutRange: SampleId[] = []
    for (const id of candidates) {
      const asset = this.library.get(id)
      if (!asset) continue
      const vr = asset.metadata.velocityRange
      if (vr) {
        const [min, max] = vr
        if (velocity >= min && velocity <= max) withRange.push(id)
      } else {
        withoutRange.push(id)
      }
    }
    // Prefer velocity-matched layers. Fall back to unlayered samples if no match.
    if (withRange.length > 0) return withRange
    return withoutRange
  }

  /** Hash (seed, role, phraseIndex) into a single 32-bit integer. O(1). */
  private hashSeed3(seed: number, role: string, phraseIndex: number): number {
    let h = (seed >>> 0) ^ (phraseIndex * 0x9e3779b9)
    for (let i = 0; i < role.length; i++) {
      h = Math.imul(h ^ role.charCodeAt(i), 0x01000193) >>> 0
    }
    return h
  }
}
