// Chord Progression Generator
// ─────────────────────────────────────────────────────────────────────────────
//
// Generates musically-coherent bass + lead patterns from chord progressions
// derived from the current key + scale. This makes the sampler a CREATIVE
// tool, not just a pattern box: instead of random density, the pitched roles
// (bass, lead, texture) follow a diatonic chord progression that respects the
// song's key.
//
// Determinism: same (ctx, seed) → same progression + patterns. Uses the same
// seeded mulberry32 RNG as the rest of the system.
//
// Music theory (kept intentionally simple + correct):
//   - Scale = interval list (semitones from root).
//   - Diatonic triad on degree d = stack thirds within the scale.
//   - Progression = sequence of degrees (e.g., i-VI-III-VII in minor).
//   - Bass = root of the current chord (low octave).
//   - Lead = chord-tone arpeggio (root → 3rd → 5th → octave).
//
// The generator is PURE: it takes a Pattern + context + seed and returns a
// new Pattern. It does not mutate the director's state directly — the page
// applies the result.

import { type MusicalContext, Rng } from '@/psy-foundation-shim'
import type { Pattern } from '@/lib/demo-director'

// ─── Scales ─────────────────────────────────────────────────────────────────
//
// Interval arrays: semitones from the root pitch class.
// Root pitch class comes from MusicalContext.rootPc (0=C, 9=A, etc.).

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor / Aeolian
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygianDominant: [0, 1, 4, 5, 7, 8, 10], // 5th mode of harmonic minor
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  locrian: [0, 1, 3, 5, 6, 8, 10],
}

/** Default scale if the context names an unknown scale. */
const DEFAULT_SCALE = SCALES.minor

export function getScaleIntervals(name: string): number[] {
  return SCALES[name] ?? DEFAULT_SCALE
}

// ─── Chords ──────────────────────────────────────────────────────────────────

export interface Chord {
  /** Scale degree index (0-based: 0=I, 1=ii, 2=iii, ...). */
  degree: number
  /** Root MIDI note (in a mid-low octave, e.g. A2 = 45). */
  rootNote: number
  /** Chord tones: [root, 3rd, 5th] as MIDI notes. */
  tones: number[]
  /** Human-readable label, e.g. "Am". */
  label: string
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/** Quality suffix for the label: '' for major, 'm' for minor, 'dim' for diminished. */
function quality(third: number, fifth: number, root: number): string {
  const thirdInt = (third - root + 12) % 12
  const fifthInt = (fifth - root + 12) % 12
  if (thirdInt === 4 && fifthInt === 7) return ''        // major
  if (thirdInt === 3 && fifthInt === 7) return 'm'       // minor
  if (thirdInt === 3 && fifthInt === 6) return 'dim'     // diminished
  if (thirdInt === 4 && fifthInt === 8) return 'aug'     // augmented
  return ''
}

/**
 * Build a diatonic triad on the given scale degree.
 * Stacks thirds: root → skip one → 3rd → skip one → 5th.
 */
export function buildDiatonicTriad(
  rootPc: number,
  scaleName: string,
  degree: number,
  octave: number,
): Chord {
  const intervals = getScaleIntervals(scaleName)
  const len = intervals.length
  // Wrap around the scale for degrees + 3rd + 5th.
  const rootInt = intervals[degree % len] + 12 * Math.floor(degree / len)
  const thirdDeg = (degree + 2) % len
  const thirdOct = Math.floor((degree + 2) / len)
  const thirdInt = intervals[thirdDeg] + 12 * thirdOct
  const fifthDeg = (degree + 4) % len
  const fifthOct = Math.floor((degree + 4) / len)
  const fifthInt = intervals[fifthDeg] + 12 * fifthOct

  const baseNote = rootPc + octave * 12
  const rootNote = baseNote + rootInt
  const thirdNote = baseNote + thirdInt
  const fifthNote = baseNote + fifthInt

  const q = quality(thirdNote, fifthNote, rootNote)
  // Label uses the CHORD root's pitch class, not the scale root.
  // e.g. degree 6 of A minor → G major → label "G", not "A".
  const rootPcClass = rootNote % 12
  const label = `${NOTE_NAMES[rootPcClass]}${q}`

  return {
    degree,
    rootNote,
    tones: [rootNote, thirdNote, fifthNote],
    label,
  }
}

// ─── Progressions ─────────────────────────────────────────────────────────────

export interface Progression {
  /** One chord per bar. Length = number of bars. */
  chords: Chord[]
  /** Human-readable, e.g. "Am - F - C - G". */
  label: string
  /** Roman numerals, e.g. "i - VI - III - VII". */
  roman: string
}

/**
 * Common progression templates (degree sequences, 0-based).
 * These are idiomatic in psytrance / electronic music.
 * Each is 4 bars (one chord per bar).
 */
const PROGRESSION_TEMPLATES: number[][] = [
  [0, 5, 2, 6],  // i - VI - III - VII (minor classic, psytrance staple)
  [0, 6, 5, 4],  // i - VII - VI - V  (descending minor)
  [0, 3, 5, 6],  // i - IV - VI - VII
  [0, 5, 3, 4],  // i - VI - IV - V
  [0, 2, 5, 6],  // i - III - VI - VII (phrygian flavor)
  [0, 6, 3, 4],  // i - VII - IV - V
  [0, 0, 5, 5],  // i - i - VI - VI (dronal, hypnotic)
  [0, 4, 5, 3],  // i - V - VI - IV
]

/**
 * Generate a 4-bar chord progression from the context's key + scale.
 * Seeded: same (ctx, seed) → same progression.
 */
export function generateProgression(
  ctx: Pick<MusicalContext, 'rootPc' | 'scale'>,
  seed: number,
): Progression {
  const rng = new Rng(seed >>> 0)
  const template = PROGRESSION_TEMPLATES[rng.int(0, PROGRESSION_TEMPLATES.length - 1)]
  // Bass octave: A2 = 45. rootPc=9 (A) + 3*12 = 45. Good low register.
  const octave = 3
  const chords = template.map((deg) => buildDiatonicTriad(ctx.rootPc, ctx.scale, deg, octave))
  const label = chords.map((c) => c.label).join(' - ')
  const roman = template.map((deg) => ROMAN[deg % 7]).join(' - ')
  return { chords, label, roman }
}

// ─── Pattern application ──────────────────────────────────────────────────────

/**
 * Apply a chord progression to the bass + lead + texture roles.
 *
 * Bass: root note on beats 1 + 3 (steps 0 + 8), with occasional ghost on
 *   step 6 or 14 (the "and" of 2 / 4) for groove. Velocity 90-110.
 *
 * Lead: chord-tone arpeggio across the 16 steps. Cycles root → 3rd → 5th →
 *   octave, one note per 2 steps (8th notes). Velocity 70-100.
 *
 * Texture: sustained chord stab on beat 1 (step 0) of each bar, low velocity.
 *
 * The progression cycles through its 4 chords if the pattern is 16+ steps
 * (1 chord per 4 steps = 1 per beat). For 32-step patterns, each chord gets
 * 8 steps (2 beats), giving a faster harmonic rhythm.
 *
 * Seeded for determinism. Does NOT mutate the input pattern — returns a copy.
 */
export function applyProgression(
  pattern: Pattern,
  progression: Progression,
  seed: number,
): Pattern {
  const rng = new Rng(seed >>> 0)
  const out: Pattern = { ...pattern }
  const steps = out.kick.length
  const chordSpan = Math.max(1, Math.floor(steps / progression.chords.length))

  // Bass: root on downbeats.
  const bassRow = new Array<number>(steps).fill(0)
  for (let i = 0; i < steps; i++) {
    const chordIdx = Math.floor(i / chordSpan) % progression.chords.length
    const chord = progression.chords[chordIdx]
    // Steps 0, 8 = beats 1, 3 → strong root.
    // Steps 4, 12 = beats 2, 4 → optional root (50% chance).
    if (i % 4 === 0) {
      bassRow[i] = rng.int(90, 110)
    } else if (i % 4 === 2 && rng.next() < 0.4) {
      // Off-beat 8th → walking bass feel.
      bassRow[i] = rng.int(70, 90)
    }
  }
  out.bass = bassRow

  // Lead: chord-aware rhythmic arpeggio, 8th notes (every 2 steps).
  // The pattern stores velocity (when to play), not pitch — the realized pitch
  // comes from ROLE_NOTES. So this creates a chord-AWARE RHYTHM: notes fire
  // following the harmonic rhythm (chord changes on bar boundaries), with
  // breathing room (~60% density). The arpeggio feel is rhythmic, not melodic,
  // unless the host maps per-step note numbers (future: piano-roll mode).
  const leadRow = new Array<number>(steps).fill(0)
  for (let i = 0; i < steps; i += 2) {
    // Ensure the chord index is used (validates chord progression access).
    const chordIdx = Math.floor(i / chordSpan) % progression.chords.length
    const chord = progression.chords[chordIdx]
    if (!chord) continue
    if (rng.next() < 0.6) {
      leadRow[i] = rng.int(70, 100)
    }
  }
  out.lead = leadRow

  // Texture: sparse stab on beat 1 of each chord span.
  const texRow = new Array<number>(steps).fill(0)
  for (let c = 0; c < progression.chords.length; c++) {
    const i = c * chordSpan
    if (i < steps && rng.next() < 0.5) {
      texRow[i] = rng.int(50, 70)
    }
  }
  out.texture = texRow

  // Do not touch kick / hats / clap / perc / fx — those are rhythmic roles
  // that the progression shouldn't override. The user can fill them separately.
  return out
}

// ─── Full generation convenience ────────────────────────────────────────────

/**
 * One-shot: generate a progression + apply it to the pattern.
 * Returns { pattern, progression } so the UI can display the chord label.
 */
export function generateChordPattern(
  pattern: Pattern,
  ctx: Pick<MusicalContext, 'rootPc' | 'scale'>,
  seed: number,
): { pattern: Pattern; progression: Progression } {
  const progression = generateProgression(ctx, seed)
  const newPattern = applyProgression(pattern, progression, seed)
  return { pattern: newPattern, progression }
}
