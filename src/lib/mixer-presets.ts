// Mixer presets — genre-specific EQ + saturation + filter settings.
//
// These complement the pattern presets. When a user loads a "Psytrance"
// pattern preset, they can also load the "Psytrance" mixer preset to get
// genre-appropriate EQ curves, saturation levels, and filter settings.

import type { BusName } from '@/psy-sampler'
import type { BusMixerState } from '@/components/types'

export interface MixerPreset {
  name: string
  busState: Record<BusName, BusMixerState>
  filterMode: 'off' | 'lp' | 'hp'
}

export const MIXER_PRESETS: MixerPreset[] = [
  {
    name: 'Psytrance',
    busState: {
      drum: { gain: 0.95, muted: false, solo: false, eqLow: 2, eqMid: -3, eqHigh: 1, saturation: 2, delaySend: 0.1, reverbSend: 0.2 },
      music: { gain: 0.85, muted: false, solo: false, eqLow: -1, eqMid: 0, eqHigh: 2, saturation: 1, delaySend: 0.1, reverbSend: 0.2 },
      atmos: { gain: 0.65, muted: false, solo: false, eqLow: -2, eqMid: 0, eqHigh: 3, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
    },
    filterMode: 'off',
  },
  {
    name: 'Techno',
    busState: {
      drum: { gain: 0.95, muted: false, solo: false, eqLow: 4, eqMid: -2, eqHigh: 0, saturation: 4, delaySend: 0.1, reverbSend: 0.2 },
      music: { gain: 0.82, muted: false, solo: false, eqLow: -1, eqMid: 1, eqHigh: 0, saturation: 2, delaySend: 0.1, reverbSend: 0.2 },
      atmos: { gain: 0.6, muted: false, solo: false, eqLow: -3, eqMid: 0, eqHigh: 2, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
    },
    filterMode: 'off',
  },
  {
    name: 'Progressive',
    busState: {
      drum: { gain: 0.88, muted: false, solo: false, eqLow: 1, eqMid: 0, eqHigh: 2, saturation: 1, delaySend: 0.1, reverbSend: 0.2 },
      music: { gain: 0.88, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 1, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
      atmos: { gain: 0.75, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 2, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
    },
    filterMode: 'lp',
  },
  {
    name: 'Breaks',
    busState: {
      drum: { gain: 0.92, muted: false, solo: false, eqLow: 3, eqMid: -1, eqHigh: 3, saturation: 3, delaySend: 0.1, reverbSend: 0.2 },
      music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 1, saturation: 1, delaySend: 0.1, reverbSend: 0.2 },
      atmos: { gain: 0.6, muted: false, solo: false, eqLow: -2, eqMid: 1, eqHigh: 2, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
    },
    filterMode: 'off',
  },
  {
    name: 'Minimal',
    busState: {
      drum: { gain: 0.9, muted: false, solo: false, eqLow: 0, eqMid: -3, eqHigh: 0, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
      music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
      atmos: { gain: 0.5, muted: false, solo: false, eqLow: -1, eqMid: 0, eqHigh: 1, saturation: 0, delaySend: 0.1, reverbSend: 0.2 },
    },
    filterMode: 'off',
  },
  {
    name: 'Dark',
    busState: {
      drum: { gain: 0.92, muted: false, solo: false, eqLow: 5, eqMid: 2, eqHigh: -4, saturation: 5, delaySend: 0.1, reverbSend: 0.2 },
      music: { gain: 0.8, muted: false, solo: false, eqLow: 2, eqMid: 0, eqHigh: -3, saturation: 3, delaySend: 0.1, reverbSend: 0.2 },
      atmos: { gain: 0.7, muted: false, solo: false, eqLow: 3, eqMid: -2, eqHigh: -5, saturation: 2, delaySend: 0.1, reverbSend: 0.2 },
    },
    filterMode: 'hp',
  },
]
