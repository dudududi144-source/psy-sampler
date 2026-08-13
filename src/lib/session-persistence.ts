// Session state persistence — saves/restores transport + mixer state to localStorage.
//
// Pattern persistence is in pattern-persistence.ts.
// This file handles: BPM, swing, masterVolume, section, energy, busState.

const STATE_KEY = 'psy-sampler:session-state'

export interface SessionState {
  bpm: number
  swing: number
  masterVolume: number
  section: string
  energy: number
  busState: {
    drum: { gain: number; muted: boolean; solo: boolean }
    music: { gain: number; muted: boolean; solo: boolean }
    atmos: { gain: number; muted: boolean; solo: boolean }
  }
}

export function saveSessionState(state: SessionState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // ignore — best-effort
  }
}

export function loadSessionState(): SessionState | null {
  try {
    const data = localStorage.getItem(STATE_KEY)
    if (!data) return null
    return JSON.parse(data) as SessionState
  } catch {
    return null
  }
}

export function clearSessionState(): void {
  try {
    localStorage.removeItem(STATE_KEY)
  } catch {
    // ignore
  }
}
