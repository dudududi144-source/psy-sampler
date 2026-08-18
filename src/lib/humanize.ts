// Velocity humanization — adds groove to a pattern by applying slight random
// velocity variation. This is a POST-PROCESSING step: it works on ANY pattern
// (generated or hand-edited), not just chord-progression output.
//
// What it does:
//   - For each active step (velocity > 0), applies ±(amount * 15) variation.
//   - 0 = no change (passthrough), 1 = maximum variation (±15).
//   - Clamps to 1-127 (never 0 — won't silence an active note).
//   - Does NOT change WHICH steps are active (only velocities).
//   - Does NOT touch the NoteMap (pitches are preserved).
//
// Determinism: when a seed is provided, the same (pattern, amount, seed) →
// same output. Without a seed, uses Math.random (non-deterministic, for live
// "add groove" workflow).
//
// Why this matters: a perfectly quantized pattern with fixed velocities feels
// robotic. Humanization adds the micro-variation that makes a groove feel
// alive — the difference between a drum machine and a drummer.

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
