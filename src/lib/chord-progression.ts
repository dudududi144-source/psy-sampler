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
import type { Pattern, NoteMap } from '@/lib/demo-director'

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

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Human-readable scale names for the UI. */
export const SCALE_LABELS: Record<string, string> = {
  phrygianDominant: 'Phrygian Dominant',
  minor: 'Natural Minor',
  harmonicMinor: 'Harmonic Minor',
  major: 'Major',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  mixolydian: 'Mixolydian',
  lydian: 'Lydian',
  locrian: 'Locrian',
}

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

// ─── Arpeggio patterns ───────────────────────────────────────────────────────
//
// Tone indices: 0=root, 1=3rd, 2=5th, 3=octave(root+12).
// Each pattern defines the SEQUENCE of tone indices the lead plays.
// The cycle repeats across the bar. Different patterns = different melodic
// textures from the same chords.

export type ArpeggioPattern = 'up' | 'down' | 'upDown' | 'downUp' | 'random' | 'chordal'

/** Human-readable labels for the UI. */
export const ARPEGGIO_LABELS: Record<ArpeggioPattern, string> = {
  up: 'Up (1-3-5-8)',
  down: 'Down (8-5-3-1)',
  upDown: 'Up-Down (1-3-5-8-5-3)',
  downUp: 'Down-Up (8-5-3-1-3-5)',
  random: 'Random',
  chordal: 'Chordal (root only)',
}

/** Base tone-index sequences (random uses rng at call time). */
const ARPEGGIO_SEQUENCES: Record<Exclude<ArpeggioPattern, 'random'>, number[]> = {
  up: [0, 1, 2, 3],
  down: [3, 2, 1, 0],
  upDown: [0, 1, 2, 3, 2, 1],
  downUp: [3, 2, 1, 0, 1, 2],
  chordal: [0, 0, 0, 0], // dronal — always root (psytrance staple)
}

/**
 * Get the tone index for arpeggio position `pos` using the given pattern.
 * For 'random', each position is a random choice from [0,1,2,3] via the rng.
 * Returns 0-3 (tone index into chord.tones, where 3 = root+12 octave).
 */
function getArpeggioToneIndex(pattern: ArpeggioPattern, pos: number, rng: Rng): number {
  if (pattern === 'random') {
    return rng.int(0, 3)
  }
  const seq = ARPEGGIO_SEQUENCES[pattern]
  return seq[pos % seq.length]!
}

// ─── Bass patterns ───────────────────────────────────────────────────────────
//
// Controls the bassline character — the foundation of electronic music.
// Different genres use different bass patterns:
//   root    = root on downbeats (psytrance staple, current default)
//   walking = root + 5th alternation (jazz/blues feel)
//   octave  = root + octave jumps (energetic, techno)
//   pedal   = root every step (dronal, hypnotic, darkpsy)
//   arp     = root → 5th → octave → 5th rolling (progressive)

export type BassPattern = 'root' | 'walking' | 'octave' | 'pedal' | 'arp'

/** Human-readable labels for the UI. */
export const BASS_LABELS: Record<BassPattern, string> = {
  root: 'Root (downbeats)',
  walking: 'Walking (root-5th)',
  octave: 'Octave jumps',
  pedal: 'Pedal (every step)',
  arp: 'Arpeggio (rolling)',
}

/**
 * Determine if a bass note fires at step `i` and which chord tone it uses.
 * Returns { active, toneIdx } where toneIdx is 0=root, 2=5th, 3=octave.
 * -1 means "no note at this step".
 *
 * The bass pattern controls BOTH the rhythm (when) and pitch (what):
 *   root    → beats 1+3 (steps 0,8) strong root, optional walking 5th
 *   walking → every beat (steps 0,4,8,12) alternating root/5th
 *   octave  → every beat, root then root+12 (octave jump)
 *   pedal   → every step (16ths) all root (dronal)
 *   arp     → every 8th (steps 0,2,4,...) rolling root/5th/octave/5th
 */
function getBassToneAt(
  pattern: BassPattern,
  step: number,
  rng: Rng,
): { active: boolean; toneIdx: number } {
  switch (pattern) {
    case 'root':
      // Beats 1+3 (steps 0,8 mod 16 → i%8===0): strong root.
      // Off-beat 8ths (i%4===2): 40% chance of 5th (walking feel).
      if (step % 8 === 0) return { active: true, toneIdx: 0 }
      if (step % 4 === 2 && rng.next() < 0.4) return { active: true, toneIdx: 2 }
      return { active: false, toneIdx: -1 }
    case 'walking':
      // Every beat (steps 0,4,8,12 → step%4===0), alternating root/5th.
      if (step % 4 === 0) {
        const beat = Math.floor(step / 4)
        return { active: true, toneIdx: beat % 2 === 0 ? 0 : 2 }
      }
      return { active: false, toneIdx: -1 }
    case 'octave':
      // Every beat, root then root+12 (octave). toneIdx 3 = root+12.
      if (step % 4 === 0) {
        const beat = Math.floor(step / 4)
        return { active: true, toneIdx: beat % 2 === 0 ? 0 : 3 }
      }
      return { active: false, toneIdx: -1 }
    case 'pedal':
      // Every step (16ths), always root. Dronal/hypnotic.
      return { active: true, toneIdx: 0 }
    case 'arp':
      // Every 8th (steps 0,2,4,...), rolling root/5th/octave/5th.
      if (step % 2 === 0) {
        const arpPos = Math.floor(step / 2)
        const seq = [0, 2, 3, 2] // root, 5th, octave, 5th
        return { active: true, toneIdx: seq[arpPos % seq.length]! }
      }
      return { active: false, toneIdx: -1 }
    default:
      return { active: false, toneIdx: -1 }
  }
}

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
 * Returns a new Pattern + a NoteMap (per-step pitch overrides). The velocity
 * grid controls WHEN notes fire; the NoteMap controls WHAT PITCH they fire at.
 * Together they make a full melodic sequencer — the lead plays an actual
 * chord-tone arpeggio that follows the harmony, not just a rhythmic pattern.
 *
 * Bass: root note on beats 1 + 3 (steps 0 + 8), with occasional ghost on
 *   step 6 or 14 (the "and" of 2 / 4) for groove. Velocity 90-110.
 *   Pitch: chord.rootNote (low register, e.g. A2=45).
 *
 * Lead: chord-tone arpeggio across the 16 steps. Cycles root → 3rd → 5th →
 *   octave, one note per 2 steps (8th notes). Velocity 70-100.
 *   Pitch: chord tones + 12 (one octave up for melodic register).
 *
 * Texture: sustained chord stab on beat 1 (step 0) of each bar, low velocity.
 *   Pitch: chord.rootNote + 12 (mid register).
 *
 * The progression cycles through its 4 chords if the pattern is 16+ steps
 * (1 chord per 4 steps = 1 per beat). For 32-step patterns, each chord gets
 * 8 steps (2 beats), giving a faster harmonic rhythm.
 *
 * Seeded for determinism. Does NOT mutate the input pattern — returns copies.
 */
export function applyProgression(
  pattern: Pattern,
  progression: Progression,
  seed: number,
  arpeggio: ArpeggioPattern = 'up',
  bass: BassPattern = 'root',
): { pattern: Pattern; noteMap: NoteMap } {
  const rng = new Rng(seed >>> 0)
  const out: Pattern = { ...pattern }
  const noteMap: NoteMap = {}
  const steps = out.kick.length
  const chordSpan = Math.max(1, Math.floor(steps / progression.chords.length))

  // Lead: chord-tone arpeggio, 8th notes (every 2 steps).
  // Generated FIRST so the lead is independent of the bass pattern's RNG
  // consumption (changing the bass pattern should NOT change the lead).
  // The arpeggio pattern controls the SEQUENCE of chord tones:
  //   'up' = root→3rd→5th→octave, 'down' = octave→5th→3rd→root, etc.
  // Pitch is one octave above the chord root for a melodic register.
  const leadRow = new Array<number>(steps).fill(0)
  const leadNotes: (number | null)[] = new Array(steps).fill(null)
  let arpIdx = 0
  for (let i = 0; i < steps; i += 2) {
    const chordIdx = Math.floor(i / chordSpan) % progression.chords.length
    const chord = progression.chords[chordIdx]
    if (!chord) continue
    if (rng.next() < 0.6) {
      leadRow[i] = rng.int(70, 100)
      // Get the tone index from the selected arpeggio pattern.
      const toneIdx = getArpeggioToneIndex(arpeggio, arpIdx, rng)
      // toneIdx 0-2 = chord.tones[idx]; 3 = root+12 (octave).
      const baseTone = toneIdx < 3
        ? chord.tones[toneIdx]
        : chord.tones[0] + 12 // octave
      leadNotes[i] = baseTone + 12 // one octave up for melodic register
      arpIdx++
    }
  }
  out.lead = leadRow
  noteMap.lead = leadNotes

  // Bass: pattern-controlled rhythm + pitch. The bass pattern defines both
  // WHEN notes fire (downbeats / every beat / every 16th / every 8th) and
  // WHAT pitch (root / 5th / octave). Generated AFTER the lead so the lead
  // is independent of the bass pattern choice.
  const bassRow = new Array<number>(steps).fill(0)
  const bassNotes: (number | null)[] = new Array(steps).fill(null)
  for (let i = 0; i < steps; i++) {
    const chordIdx = Math.floor(i / chordSpan) % progression.chords.length
    const chord = progression.chords[chordIdx]
    if (!chord) continue
    const { active, toneIdx } = getBassToneAt(bass, i, rng)
    if (active) {
      // Strong beats (i%4===0) = vel 90-110; off-beats = vel 70-90.
      bassRow[i] = i % 4 === 0 ? rng.int(90, 110) : rng.int(70, 90)
      // toneIdx 0=root, 2=5th, 3=root+12 (octave).
      bassNotes[i] = toneIdx < 3
        ? chord.tones[toneIdx]
        : chord.tones[0] + 12 // octave
    }
  }
  out.bass = bassRow
  noteMap.bass = bassNotes

  // Texture: sparse stab on beat 1 of each chord span. Pitch = chord root + 12.
  const texRow = new Array<number>(steps).fill(0)
  const texNotes: (number | null)[] = new Array(steps).fill(null)
  for (let c = 0; c < progression.chords.length; c++) {
    const i = c * chordSpan
    if (i < steps && rng.next() < 0.5) {
      const chord = progression.chords[c]
      if (chord) {
        texRow[i] = rng.int(50, 70)
        texNotes[i] = chord.rootNote + 12 // mid register
      }
    }
  }
  out.texture = texRow
  noteMap.texture = texNotes

  // Do not touch kick / hats / clap / perc / fx — those are rhythmic roles
  // that the progression shouldn't override. The user can fill them separately.
  return { pattern: out, noteMap }
}

// ─── Full generation convenience ────────────────────────────────────────────

/**
 * One-shot: generate a progression + apply it to the pattern.
 * Returns { pattern, noteMap, progression } so the UI can display the chord
 * label and pass the noteMap to the director.
 */
export function generateChordPattern(
  pattern: Pattern,
  ctx: Pick<MusicalContext, 'rootPc' | 'scale'>,
  seed: number,
  arpeggio: ArpeggioPattern = 'up',
  bass: BassPattern = 'root',
): { pattern: Pattern; noteMap: NoteMap; progression: Progression } {
  const progression = generateProgression(ctx, seed)
  const { pattern: newPattern, noteMap } = applyProgression(pattern, progression, seed, arpeggio, bass)
  return { pattern: newPattern, noteMap, progression }
}
