// PSY Sampler — RoundRobinBank.
// Phrase-locked variant rotation with phase-safe variance rules.
// Adapted from psy4's inline round-robin (L2052-2275 of psy4-engine.js),
// extracted into a real class with documented variance tables.

import type { SampleCategory } from './types'

/**
 * Variance rules per category.
 * Phase-safe categories (kick, clap, bass) have tight pitch variance to
 * preserve sub phase coherence. Inharmonic categories (hat) allow wider
 * pitch + pan variance.
 *
 * Source: psy4 code (L2073-2204), with doc/code reconciliation:
 *   - psy4 SAMPLE_SELECTION_RULES.md documented different values than the code.
 *   - We follow the CODE values (code is the source of truth).
 *   - "Kick never pitched beyond ±0.5%" rule (SAMPLE_SELECTION_RULES.md L138)
 *     is enforced: kick pitchVar = ±0.3% < ±0.5%. ✅
 */
export interface VarianceRule {
  /** Number of round-robin variants. */
  variants: number
  /** Pitch variance as a fraction (0.003 = ±0.3%). */
  pitchVar: number
  /** Gain variance as a fraction (0.045 = ±4.5%). */
  gainVar: number
  /** Pan variance (0.045 = ±0.045 in pan units). 0 = mono. */
  panVar: number
}

export const DEFAULT_VARIANCE_RULES: Record<SampleCategory, VarianceRule> = {
  kick:       { variants: 4, pitchVar: 0.003, gainVar: 0.045, panVar: 0 },
  bass:       { variants: 2, pitchVar: 0.002, gainVar: 0,     panVar: 0 },
  lead:       { variants: 2, pitchVar: 0.010, gainVar: 0,     panVar: 0.1 },
  'hat-closed': { variants: 4, pitchVar: 0.0045, gainVar: 0,   panVar: 0.045 },
  'hat-open':   { variants: 8, pitchVar: 0.0175, gainVar: 0,   panVar: 0.14 },
  clap:       { variants: 4, pitchVar: 0.003, gainVar: 0.030, panVar: 0 },
  perc:       { variants: 4, pitchVar: 0.005, gainVar: 0.030, panVar: 0.05 },
  texture:    { variants: 2, pitchVar: 0.020, gainVar: 0,     panVar: 0.2 },
  fx:         { variants: 2, pitchVar: 0.020, gainVar: 0,     panVar: 0.2 },
}

export interface RoundRobinResult {
  /** Variant index (0-based). */
  variant: number
  /** Pitch multiplier (1.0 ± pitchVar). */
  pitch: number
  /** Gain multiplier (1.0 ± gainVar). */
  gain: number
  /** Pan offset (± panVar). */
  pan: number
}

/**
 * Round-robin bank. Phrase-locked: the variant index rotates ONLY on phrase
 * boundary (when phrasePosition === 0). Within a phrase, the same variant
 * plays for the same category.
 *
 * This is deterministic: given the same (category, phrasePosition, internal
 * counter state), the output is identical. The counter is internal (not
 * derived from seed) but advances deterministically with phrasePosition.
 *
 * For fully-seeded determinism, the SelectionPolicy wraps this and seeds
 * the variance calculation.
 */
export class RoundRobinBank {
  private readonly rules: Record<SampleCategory, VarianceRule>
  private readonly counters = new Map<SampleCategory, number>()
  private readonly phraseVariants = new Map<SampleCategory, number>()

  constructor(rules: Record<SampleCategory, VarianceRule> = DEFAULT_VARIANCE_RULES) {
    this.rules = rules
  }

  /**
   * Get the round-robin result for a category at a given phrase position.
   *
   * @param category The sample category.
   * @param phrasePosition Bar index within the current phrase (0 = first bar of phrase).
   * @returns RoundRobinResult with variant index + variance.
   */
  next(category: SampleCategory, phrasePosition: number): RoundRobinResult {
    const rule = this.rules[category] ?? DEFAULT_VARIANCE_RULES[category]
    const variants = rule.variants

    // Rotate variant only on phrase boundary.
    if (phrasePosition === 0) {
      const prev = this.counters.get(category) ?? 0
      const next = (prev + 1) % variants
      this.counters.set(category, next)
      this.phraseVariants.set(category, next)
    }

    const variant = this.phraseVariants.get(category) ?? 0

    // microVar pattern from psy4: (variant % variants - (variants-1)/2)
    // gives a symmetric range around 0.
    const half = (variants - 1) / 2
    const microVar = (variant % variants) - half

    // Normalize -0 to 0 (avoids Object.is(-0, 0) === false in tests).
    const pitch = 1.0 + (rule.pitchVar === 0 ? 0 : microVar * rule.pitchVar / half)
    const gain = 1.0 + (rule.gainVar === 0 ? 0 : microVar * rule.gainVar / half)
    const pan = rule.panVar === 0 ? 0 : microVar * rule.panVar / half

    return { variant, pitch, gain, pan }
  }

  /** Reset all counters (e.g. on transport stop). */
  reset(): void {
    this.counters.clear()
    this.phraseVariants.clear()
  }

  /** Get the current variant for a category (without advancing). */
  currentVariant(category: SampleCategory): number {
    return this.phraseVariants.get(category) ?? 0
  }
}
