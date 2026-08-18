// Pattern statistics — analysis functions that compute metrics from a pattern.
//
// These are READ-ONLY: they don't modify the pattern, they just report on it.
// Used by the pattern editor to show density, velocity range, and note count
// so the user can see at a glance how busy the pattern is.

import type { Pattern } from './demo-director'
import type { SampleRole } from '@/psy-sampler'

export interface PatternStats {
  /** Total number of steps across all roles (steps × 9). */
  totalSteps: number
  /** Number of active notes (velocity > 0) across all roles. */
  activeNotes: number
  /** Density = activeNotes / totalSteps, as a fraction 0..1. */
  density: number
  /** Mean velocity of active notes (1-127). 0 if no active notes. */
  avgVelocity: number
  /** Minimum active velocity (1-127). 0 if no active notes. */
  minVelocity: number
  /** Maximum active velocity (1-127). 0 if no active notes. */
  maxVelocity: number
  /** Per-role active note count. */
  perRole: Record<SampleRole, number>
}

/**
 * Compute statistics from a pattern.
 *
 * @param pattern The 9×N velocity grid.
 * @returns PatternStats — active notes, density, velocity range, per-role count.
 */
export function patternStats(pattern: Pattern): PatternStats {
  const roles = Object.keys(pattern) as SampleRole[]
  const steps = pattern[roles[0] ?? 'kick']?.length ?? 0
  const totalSteps = steps * roles.length
  let activeNotes = 0
  let velSum = 0
  let minVel = 127
  let maxVel = 1
  const perRole = {} as Record<SampleRole, number>

  for (const role of roles) {
    const row = pattern[role]
    if (!row) {
      perRole[role] = 0
      continue
    }
    let roleCount = 0
    for (const vel of row) {
      if (vel > 0) {
        activeNotes++
        roleCount++
        velSum += vel
        if (vel < minVel) minVel = vel
        if (vel > maxVel) maxVel = vel
      }
    }
    perRole[role] = roleCount
  }

  return {
    totalSteps,
    activeNotes,
    density: totalSteps > 0 ? activeNotes / totalSteps : 0,
    avgVelocity: activeNotes > 0 ? Math.round(velSum / activeNotes) : 0,
    minVelocity: activeNotes > 0 ? minVel : 0,
    maxVelocity: activeNotes > 0 ? maxVel : 0,
    perRole,
  }
}
