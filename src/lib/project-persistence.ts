// Project persistence — save/load the ENTIRE sampler state to a JSON file.
//
// This is what turns the demo into a tool. A producer can:
//   1. Build a pattern + mixer settings + song arrangement
//   2. Save it as a .psy.json file (download)
//   3. Load it later (or share it with someone else)

import type { Pattern, NoteMap } from './demo-director'
import type { Song } from './song-persistence'
import type { BusName } from '@/psy-sampler'
import type { BusMixerState } from '@/components/types'

export interface ProjectState {
  version: string
  name: string
  savedAt: number
  bpm: number
  swing: number
  masterVolume: number
  section: string
  energy: number
  pattern: Pattern
  /** Per-step pitch overrides (from chord progression). Optional for backward compat. */
  noteMap?: NoteMap
  /** Root pitch class (0-11). Optional — defaults to 9 (A). */
  musicalKey?: number
  /** Scale name (e.g. 'phrygianDominant'). Optional — defaults to 'phrygianDominant'. */
  scaleName?: string
  busState: Record<BusName, BusMixerState>
  filterMode: 'off' | 'lp' | 'hp'
  pumpEnabled: boolean
  evolveEnabled: boolean
  song: Song
}

const PROJECT_VERSION = '1.0.0'

export function createProject(name: string, state: Omit<ProjectState, 'version' | 'savedAt' | 'name'>): ProjectState {
  return { ...state, version: PROJECT_VERSION, savedAt: Date.now(), name }
}

export function serializeProject(project: ProjectState): string {
  return JSON.stringify(project, null, 2)
}

export function deserializeProject(json: string): ProjectState | null {
  try {
    const parsed = JSON.parse(json) as unknown
    return validateProject(parsed)
  } catch { return null }
}

export function validateProject(obj: unknown): ProjectState | null {
  if (typeof obj !== 'object' || obj === null) return null
  const raw = obj as Record<string, unknown>
  if (typeof raw.bpm !== 'number') return null
  if (typeof raw.pattern !== 'object' || raw.pattern === null) return null
  if (typeof raw.busState !== 'object' || raw.busState === null) return null
  return {
    version: typeof raw.version === 'string' ? raw.version : PROJECT_VERSION,
    name: typeof raw.name === 'string' ? raw.name : 'untitled',
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
    bpm: raw.bpm,
    swing: typeof raw.swing === 'number' ? raw.swing : 0,
    masterVolume: typeof raw.masterVolume === 'number' ? raw.masterVolume : 0.85,
    section: typeof raw.section === 'string' ? raw.section : 'DROP',
    energy: typeof raw.energy === 'number' ? raw.energy : 0.7,
    pattern: raw.pattern as Pattern,
    noteMap: (typeof raw.noteMap === 'object' && raw.noteMap !== null ? raw.noteMap : {}) as NoteMap,
    musicalKey: typeof raw.musicalKey === 'number' ? raw.musicalKey : 9,
    scaleName: typeof raw.scaleName === 'string' ? raw.scaleName : 'phrygianDominant',
    busState: raw.busState as Record<BusName, BusMixerState>,
    filterMode: (raw.filterMode === 'lp' || raw.filterMode === 'hp' ? raw.filterMode : 'off'),
    pumpEnabled: typeof raw.pumpEnabled === 'boolean' ? raw.pumpEnabled : false,
    evolveEnabled: typeof raw.evolveEnabled === 'boolean' ? raw.evolveEnabled : false,
    song: (typeof raw.song === 'object' && raw.song !== null ? raw.song : { name: 'untitled', segments: [], savedAt: 0 }) as Song,
  }
}

export function downloadProject(project: ProjectState): void {
  const json = serializeProject(project)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${project.name.replace(/[^a-z0-9-_]/gi, '_') || 'psy-sampler-project'}.psy.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readProjectFile(file: File): Promise<ProjectState | null> {
  return file.text().then((text) => deserializeProject(text))
}
