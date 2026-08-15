// Session state persistence — saves/restores the FULL UI state to localStorage.
//
// This includes everything EXCEPT the pattern (which is in pattern-persistence.ts)
// and the samples (which are loaded from the manifest). When the user reloads
// the page, the entire session is restored: transport, mixer, song, automation,
// probabilities, filter, toggles — everything.
//
// This is the difference between "demo that forgets your settings" and
// "tool that remembers where you left off".

const STATE_KEY = 'psy-sampler:session-state'

export interface SessionState {
  // Transport
  bpm: number
  swing: number
  masterVolume: number
  section: string
  energy: number
  // Mixer (full — includes EQ + saturation)
  busState: {
    drum: { gain: number; muted: boolean; solo: boolean; eqLow: number; eqMid: number; eqHigh: number; saturation: number }
    music: { gain: number; muted: boolean; solo: boolean; eqLow: number; eqMid: number; eqHigh: number; saturation: number }
    atmos: { gain: number; muted: boolean; solo: boolean; eqLow: number; eqMid: number; eqHigh: number; saturation: number }
  }
  // Master filter
  filterMode: 'off' | 'lp' | 'hp'
  // Toggles
  pumpEnabled: boolean
  evolveEnabled: boolean
  // Pattern length
  stepCount: number
  // Per-step probabilities
  probabilities: Record<string, Record<number, number>>
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
    const parsed = JSON.parse(data) as Partial<SessionState>
    // Merge with defaults to handle older saved states that lack new fields.
    return {
      bpm: parsed.bpm ?? 145,
      swing: parsed.swing ?? 0,
      masterVolume: parsed.masterVolume ?? 0.85,
      section: parsed.section ?? 'DROP',
      energy: parsed.energy ?? 0.7,
      busState: parsed.busState ?? {
        drum: { gain: 0.9, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
        music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
        atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
      },
      filterMode: parsed.filterMode ?? 'off',
      pumpEnabled: parsed.pumpEnabled ?? false,
      evolveEnabled: parsed.evolveEnabled ?? false,
      stepCount: parsed.stepCount ?? 16,
      probabilities: parsed.probabilities ?? {},
    }
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
