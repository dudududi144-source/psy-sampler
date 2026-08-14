// Pattern persistence — save/load patterns to localStorage.
//
// 4 named slots + autosave of current pattern on every toggle.
// Patterns are stored as JSON in the 'psy-sampler:' namespace.

import type { Pattern } from './demo-director'
import type { SampleRole } from '@/psy-sampler'

const STORAGE_PREFIX = 'psy-sampler:pattern:'
const AUTOSAVE_KEY = 'psy-sampler:pattern:__autosave__'
const SLOT_COUNT = 4

export interface PatternSlot {
  name: string
  pattern: Pattern
  savedAt: number
}

/** Get all 4 slot names (empty string if not saved). */
export function getSlotNames(): string[] {
  const names: string[] = []
  for (let i = 0; i < SLOT_COUNT; i++) {
    try {
      const data = localStorage.getItem(`${STORAGE_PREFIX}slot-${i}`)
      if (data) {
        const parsed = JSON.parse(data) as PatternSlot
        names.push(parsed.name)
      } else {
        names.push('')
      }
    } catch {
      names.push('')
    }
  }
  return names
}

/** Save a pattern to a slot. */
export function saveToSlot(slot: number, name: string, pattern: Pattern): void {
  if (slot < 0 || slot >= SLOT_COUNT) return
  const data: PatternSlot = { name, pattern, savedAt: Date.now() }
  try {
    localStorage.setItem(`${STORAGE_PREFIX}slot-${slot}`, JSON.stringify(data))
  } catch (err) {
    console.error('[psy-sampler] Failed to save pattern:', err)
  }
}

/** Load a pattern from a slot. Returns null if empty or invalid. */
export function loadFromSlot(slot: number): PatternSlot | null {
  if (slot < 0 || slot >= SLOT_COUNT) return null
  try {
    const data = localStorage.getItem(`${STORAGE_PREFIX}slot-${slot}`)
    if (!data) return null
    const parsed = JSON.parse(data) as PatternSlot
    // FIX Bug 4: validate the pattern shape before returning.
    parsed.pattern = validatePattern(parsed.pattern)
    return parsed
  } catch {
    return null
  }
}

/** Clear a slot. */
export function clearSlot(slot: number): void {
  if (slot < 0 || slot >= SLOT_COUNT) return
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}slot-${slot}`)
  } catch {
    // ignore
  }
}

/** Autosave the current pattern (called on every toggle). */
export function autosavePattern(pattern: Pattern): void {
  try {
    const data: PatternSlot = { name: 'autosave', pattern, savedAt: Date.now() }
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data))
  } catch {
    // ignore — autosave is best-effort
  }
}

/** Load the autosaved pattern. Returns null if none or invalid. */
export function loadAutosave(): Pattern | null {
  try {
    const data = localStorage.getItem(AUTOSAVE_KEY)
    if (!data) return null
    const parsed = JSON.parse(data) as PatternSlot
    // FIX Bug 4: validate the pattern shape.
    return validatePattern(parsed.pattern)
  } catch {
    return null
  }
}

// ─── Pattern validation ──────────────────────────────────────────────────────

const REQUIRED_ROLES: SampleRole[] = [
  'kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx'
]
const STEPS = 16

/**
 * Validate a pattern object. Ensures all 9 roles exist and each has 16 numbers.
 * Accepts BOTH legacy boolean[] patterns (true→100, false→0) and new number[] patterns
 * — this is the migration path for autosaved/saved patterns from before E1.
 * Falls back to DEFAULT_PATTERN for missing/invalid roles.
 */
export function validatePattern(obj: unknown): Pattern {
  if (typeof obj !== 'object' || obj === null) {
    return structuredClone(DEFAULT_PATTERN)
  }
  const result = structuredClone(DEFAULT_PATTERN)
  const raw = obj as Record<string, unknown>
  for (const role of REQUIRED_ROLES) {
    const row = raw[role]
    if (Array.isArray(row) && row.length === STEPS) {
      // Migrate: boolean true → velocity 100, false → 0. number → clamp 0..127.
      result[role] = row.map((v) => {
        if (typeof v === 'boolean') return v ? 100 : 0
        if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(127, Math.round(v)))
        return 0
      })
    }
    // else: keep the default (all zeros)
  }
  return result
}

// Import DEFAULT_PATTERN for fallback (lazy to avoid circular dependency).
import { DEFAULT_PATTERN } from './demo-director'

// ─── Pattern presets ─────────────────────────────────────────────────────────

export interface PatternPreset {
  name: string
  bpm: number
  pattern: Pattern
}

function emptyRow(): number[] {
  return new Array(16).fill(0)
}

function makePattern(overrides: Partial<Record<SampleRole, number[]>>): Pattern {
  const base: Pattern = {
    kick: emptyRow(),
    bass: emptyRow(),
    lead: emptyRow(),
    'hat-closed': emptyRow(),
    'hat-open': emptyRow(),
    clap: emptyRow(),
    perc: emptyRow(),
    texture: emptyRow(),
    fx: emptyRow(),
  }
  for (const [role, row] of Object.entries(overrides)) {
    if (role in base) {
      base[role as SampleRole] = row ?? emptyRow()
    }
  }
  return base
}

function fourOnFloor(steps: number[] = [0, 4, 8, 12], velocity = 100): number[] {
  const row = emptyRow()
  for (const s of steps) row[s] = velocity
  return row
}

function offbeat(steps: number[] = [2, 6, 10, 14], velocity = 70): number[] {
  const row = emptyRow()
  for (const s of steps) row[s] = velocity
  return row
}

function everyStep(velocity = 100): number[] {
  return new Array(16).fill(velocity)
}

function sparseSteps(steps: number[], velocity = 100): number[] {
  const row = emptyRow()
  for (const s of steps) row[s] = velocity
  return row
}

export const PATTERN_PRESETS: PatternPreset[] = [
  {
    name: 'Psytrance',
    bpm: 145,
    pattern: makePattern({
      kick: fourOnFloor(),
      bass: everyStep(),
      'hat-closed': offbeat([1, 3, 5, 7, 9, 11, 13, 15]),
      'hat-open': sparseSteps([6, 14]),
      clap: sparseSteps([4, 12]),
      perc: sparseSteps([2, 7, 10]),
      lead: sparseSteps([8, 11]),
    }),
  },
  {
    name: 'Techno',
    bpm: 128,
    pattern: makePattern({
      kick: fourOnFloor(),
      bass: sparseSteps([0, 4, 8, 12]),
      'hat-closed': offbeat([2, 6, 10, 14]),
      clap: sparseSteps([4, 12]),
      perc: sparseSteps([3, 7, 11, 15]),
    }),
  },
  {
    name: 'Progressive',
    bpm: 128,
    pattern: makePattern({
      kick: fourOnFloor(),
      bass: sparseSteps([0, 3, 8, 11]),
      'hat-closed': offbeat([2, 6, 10, 14]),
      perc: sparseSteps([5, 13]),
      lead: sparseSteps([4, 7, 12]),
    }),
  },
  {
    name: 'Breaks',
    bpm: 135,
    pattern: makePattern({
      kick: sparseSteps([0, 6, 10]),
      'hat-closed': sparseSteps([2, 4, 8, 12, 14]),
      'hat-open': sparseSteps([7, 15]),
      clap: sparseSteps([4, 12]),
      perc: sparseSteps([1, 3, 5, 9, 11, 13]),
      bass: sparseSteps([0, 6, 10]),
    }),
  },
  {
    name: 'Minimal',
    bpm: 130,
    pattern: makePattern({
      kick: fourOnFloor(),
      'hat-closed': offbeat([2, 6, 10, 14]),
      perc: sparseSteps([7]),
    }),
  },
  {
    name: 'Dark',
    bpm: 140,
    pattern: makePattern({
      kick: sparseSteps([0, 3, 8, 11]),
      bass: sparseSteps([0, 2, 4, 6, 8, 10, 12, 14]),
      'hat-closed': everyStep(),
      clap: sparseSteps([4, 12]),
      texture: sparseSteps([0]),
    }),
  },
]
