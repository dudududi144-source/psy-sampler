// Shared types + constants for the PSY Sampler UI.
//
// Pure type/const module — no React, no side effects.
// Imported by both `app/page.tsx` and the split component files.

import type {
  SampleRole,
  BusName,
} from '@/psy-sampler'
import type {
  MusicalContext,
  DeviceCapabilities,
  MusicalTransport,
} from '@/psy-foundation-shim'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeviceStats {
  eventsReceived: number
  notesTriggered: number
  notesSkipped: number
  activeVoices: number
  pendingEvents: number
  librarySize: number
  isStarted: boolean
  lastEvent: {
    channel: string
    note: number
    velocity: number
    at: number
    sampleId?: string
    triggered: boolean
  } | null
  lastTransport: MusicalTransport | null
  lastContext: MusicalContext | null
  capabilities: DeviceCapabilities
}

export interface EventLogEntry {
  id: number
  channel: string
  note: number
  velocity: number
  at: number
  sampleId?: string
  triggered: boolean
  receivedAt: number // Date.now()
}

export interface LoadProgress {
  loaded: number
  total: number
}

export interface BusMixerState {
  gain: number
  muted: boolean
  solo: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const ROLES: SampleRole[] = ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx']
export const STEPS = 16
export const ROLE_COLORS: Record<SampleRole, string> = {
  kick: '#00ffc8',
  bass: '#ff2e88',
  lead: '#b967ff',
  'hat-closed': '#fbbf24',
  'hat-open': '#fb923c',
  clap: '#a3e635',
  perc: '#22d3ee',
  texture: '#f472b6',
  fx: '#e879f9',
}
export const ROLE_LABEL: Record<SampleRole, string> = {
  kick: 'KCK',
  bass: 'BAS',
  lead: 'LID',
  'hat-closed': 'HAT',
  'hat-open': 'HOT',
  clap: 'CLP',
  perc: 'PRC',
  texture: 'TXT',
  fx: 'FX ',
}
export const BUS_NAMES: BusName[] = ['drum', 'music', 'atmos']
export const BUS_COLORS: Record<BusName, string> = {
  drum: '#00ffc8',
  music: '#ff2e88',
  atmos: '#b967ff',
}
export const BUS_ROLES: Record<BusName, SampleRole[]> = {
  drum: ['kick', 'hat-closed', 'hat-open', 'clap', 'perc'],
  music: ['bass', 'lead'],
  atmos: ['texture', 'fx'],
}
export const SECTIONS = ['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER']
export const EVENT_LOG_MAX = 50
export const NOW_PLAYING_MS = 220
