// PSY Sampler — variance rules per sample category.
// Adapted from psy4's inline round-robin (L2052-2275 of psy4-engine.js),
// extracted into documented data.
//
// Phase-safe categories (kick, clap, bass) have tight pitch variance to
// preserve sub phase coherence. Inharmonic categories (hat) allow wider
// pitch + pan variance.
//
// Source: psy4 code (L2073-2204), with doc/code reconciliation:
//   - psy4 SAMPLE_SELECTION_RULES.md documented different values than the code.
//   - We follow the CODE values (code is the source of truth).
//   - "Kick never pitched beyond ±0.5%" rule (SAMPLE_SELECTION_RULES.md L138)
//     is enforced: kick pitchVar = ±0.3% < ±0.5%. ✅

import type { SampleCategory } from './types'

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
  kick:         { variants: 4, pitchVar: 0.003, gainVar: 0.045, panVar: 0 },
  bass:         { variants: 2, pitchVar: 0.002, gainVar: 0,     panVar: 0 },
  lead:         { variants: 2, pitchVar: 0.010, gainVar: 0,     panVar: 0.1 },
  'hat-closed': { variants: 4, pitchVar: 0.0045, gainVar: 0,    panVar: 0.045 },
  'hat-open':   { variants: 8, pitchVar: 0.0175, gainVar: 0,    panVar: 0.14 },
  clap:         { variants: 4, pitchVar: 0.003, gainVar: 0.030, panVar: 0 },
  perc:         { variants: 4, pitchVar: 0.005, gainVar: 0.030, panVar: 0.05 },
  texture:      { variants: 2, pitchVar: 0.020, gainVar: 0,     panVar: 0.2 },
  fx:           { variants: 2, pitchVar: 0.020, gainVar: 0,     panVar: 0.2 },
}
