// Velocity humanization + quantization — post-processing steps that work on
// ANY pattern (generated or hand-edited).
//
// HUMANIZE: adds groove via random variation (±amount * 15 per note).
// QUANTIZE: snaps velocities to standard tiers (removes variation).
//
// Together they form a complete velocity workflow:
//   1. Generate (D) → velocities are random
//   2. Quantize (Q) → snap to standard steps (clean, punchy)
//   3. Humanize (H) → add subtle variation on top (groove, alive)
//
// Both:
//   - Do NOT change which steps are active (0 stays 0, >0 stays >0).
//   - Do NOT touch the NoteMap (pitches are preserved).
//   - Return a new pattern (input is NOT mutated).

import type { Pattern } from './demo-director'
import type { SampleRole } from '@/psy-sampler'
import { Rng } from '@/psy-foundation-shim'

/** Maximum velocity variation in MIDI units (±15 = ~12% of 127). */
const MAX_VARIATION = 15

/**
 * Apply velocity humanization to a pattern.
 *
 * @param pattern The input pattern (9×N velocity grid).
 * @param amount 0-1. 0 = no change, 1 = ±15 variation per note.
 * @param seed Optional seed for determinism. If omitted, uses Math.random.
 * @returns A new pattern with humanized velocities (input is NOT mutated).
 */
export function humanizePattern(pattern: Pattern, amount: number, seed?: number): Pattern {
  const amt = Math.max(0, Math.min(1, amount))
  if (amt === 0) return structuredClone(pattern) // passthrough

  const rng = seed !== undefined ? new Rng(seed >>> 0) : null
  const variation = amt * MAX_VARIATION

  const out: Pattern = { ...pattern }
  for (const role of Object.keys(out) as SampleRole[]) {
    const row = out[role]
    if (!row) continue
    const newRow = new Array<number>(row.length)
    for (let i = 0; i < row.length; i++) {
      const vel = row[i]!
      if (vel <= 0) {
        // Silent step — keep silent.
        newRow[i] = 0
        continue
      }
      // Apply ±variation. rng for deterministic, Math.random for live.
      const offset = rng !== null
        ? (rng.next() * 2 - 1) * variation
        : (Math.random() * 2 - 1) * variation
      // Clamp to 1-127 (never 0 — won't silence an active note).
      newRow[i] = Math.max(1, Math.min(127, Math.round(vel + offset)))
    }
    out[role] = newRow
  }
  return out
}

// ─── Quantization ───────────────────────────────────────────────────────────

/** Standard velocity tiers for quantization. Each tier is a "step" value. */
const QUANTIZE_TIERS: Record<number, number[]> = {
  3: [0, 100, 127],          // off, normal, accent — the most musical
  4: [0, 64, 100, 127],      // off, soft, normal, accent
  5: [0, 32, 64, 96, 127],   // off, very-soft, soft, normal, accent
}

/**
 * Snap each velocity to the nearest standard tier value.
 *
 * @param pattern The input pattern.
 * @param tiers 3 (default), 4, or 5. More tiers = finer granularity.
 * @returns A new pattern with snapped velocities (input is NOT mutated).
 *
 * Silent steps (0) stay 0. Active notes snap to the nearest tier ≥1 (never
 * silenced). This is the complement to humanize: quantize REMOVES variation,
 * humanize ADDS it. The standard workflow is quantize → humanize for clean
 * but groovy velocities.
 */
export function quantizePattern(pattern: Pattern, tiers: number = 3): Pattern {
  const steps = QUANTIZE_TIERS[tiers] ?? QUANTIZE_TIERS[3]!
  const out: Pattern = { ...pattern }
  for (const role of Object.keys(out) as SampleRole[]) {
    const row = out[role]
    if (!row) continue
    const newRow = new Array<number>(row.length)
    for (let i = 0; i < row.length; i++) {
      const vel = row[i]!
      if (vel <= 0) {
        newRow[i] = 0 // silent stays silent
        continue
      }
      // Find the nearest tier. Active notes never snap to 0 (min is steps[1]).
      let nearest = steps[1]! // the lowest non-zero tier
      let minDist = Math.abs(vel - nearest)
      for (let t = 1; t < steps.length; t++) {
        const dist = Math.abs(vel - steps[t]!)
        if (dist < minDist) {
          minDist = dist
          nearest = steps[t]!
        }
      }
      newRow[i] = nearest
    }
    out[role] = newRow
  }
  return out
}
