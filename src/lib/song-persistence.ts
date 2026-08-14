// Song mode persistence — save/load song arrangements to localStorage.
//
// A "song" is a sequence of segments. Each segment references a saved pattern
// slot (0-3) and specifies how many bars to play it. The director advances
// through segments automatically at bar boundaries.
//
// Example song: [{slot:0, bars:4}, {slot:1, bars:4}, {slot:0, bars:4}, {slot:2, bars:8}]
// → plays slot 0 for 4 bars, slot 1 for 4 bars, slot 0 again for 4 bars, slot 2 for 8 bars.
// This is the A→B→A→C arrangement pattern common in electronic music.
//
// Storage: 'psy-sampler:song' in localStorage (single song, editable).

import type { Pattern } from './demo-director'

export interface SongSegment {
  /** Index of the pattern slot (0-3) to play during this segment. */
  slot: number
  /** Number of bars to play this segment before advancing. */
  bars: number
}

export interface Song {
  name: string
  segments: SongSegment[]
  /** When the song was last saved (epoch ms). */
  savedAt: number
}

const SONG_KEY = 'psy-sampler:song'

/** Default empty song — no segments. */
export const EMPTY_SONG: Song = {
  name: 'untitled',
  segments: [],
  savedAt: 0,
}

/** Load the saved song. Returns EMPTY_SONG if none or invalid. */
export function loadSong(): Song {
  try {
    const data = localStorage.getItem(SONG_KEY)
    if (!data) return { ...EMPTY_SONG }
    const parsed = JSON.parse(data) as Song
    return validateSong(parsed)
  } catch {
    return { ...EMPTY_SONG }
  }
}

/** Save a song to localStorage. */
export function saveSong(song: Song): void {
  try {
    const data: Song = { ...song, savedAt: Date.now() }
    localStorage.setItem(SONG_KEY, JSON.stringify(data))
  } catch (err) {
    console.error('[psy-sampler] Failed to save song:', err)
  }
}

/** Validate a song object. Returns a clean Song with valid segments only. */
export function validateSong(obj: unknown): Song {
  if (typeof obj !== 'object' || obj === null) return { ...EMPTY_SONG }
  const raw = obj as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name : 'untitled'
  const segments: SongSegment[] = []
  if (Array.isArray(raw.segments)) {
    for (const seg of raw.segments) {
      if (typeof seg !== 'object' || seg === null) continue
      const s = seg as Record<string, unknown>
      const slot = typeof s.slot === 'number' ? Math.max(0, Math.min(3, Math.floor(s.slot))) : 0
      const bars = typeof s.bars === 'number' ? Math.max(1, Math.min(64, Math.floor(s.bars))) : 4
      segments.push({ slot, bars })
    }
  }
  return { name, segments, savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0 }
}

/**
 * Resolve a song's segments into a flat list of {pattern, bars} pairs by
 * looking up each segment's slot in the provided slot patterns.
 *
 * Segments referencing empty slots are skipped (the pattern would be null).
 * Returns an empty array if the song is empty or all slots are empty.
 */
export function resolveSong(
  song: Song,
  slotPatterns: (Pattern | null)[]
): Array<{ pattern: Pattern; bars: number; slot: number }> {
  const result: Array<{ pattern: Pattern; bars: number; slot: number }> = []
  for (const seg of song.segments) {
    const pattern = slotPatterns[seg.slot]
    if (pattern) {
      result.push({ pattern, bars: seg.bars, slot: seg.slot })
    }
  }
  return result
}

/**
 * Compute the total duration of a song in seconds, given a BPM.
 * Used for the offline render (export the entire song as one WAV).
 */
export function songDurationSec(song: Song, bpm: number): number {
  const secPerBar = (60 / bpm) * 4
  let totalBars = 0
  for (const seg of song.segments) totalBars += seg.bars
  return totalBars * secPerBar
}
