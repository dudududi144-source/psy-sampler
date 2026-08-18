// Mixer presets tests — verifies the 6 genre-specific presets.

import { describe, it, expect } from 'bun:test'
import { MIXER_PRESETS, type MixerPreset } from '../../src/lib/mixer-presets'
import type { BusName } from '../../src/psy-sampler'

describe('Mixer Presets', () => {
  it('has 6 presets', () => {
    expect(MIXER_PRESETS.length).toBe(6)
  })

  it('each preset has a unique name', () => {
    const names = MIXER_PRESETS.map((p) => p.name)
    expect(new Set(names).size).toBe(6)
  })

  it('each preset has all 3 buses', () => {
    for (const preset of MIXER_PRESETS) {
      expect(preset.busState.drum).toBeDefined()
      expect(preset.busState.music).toBeDefined()
      expect(preset.busState.atmos).toBeDefined()
    }
  })

  it('each bus has EQ + saturation fields', () => {
    for (const preset of MIXER_PRESETS) {
      for (const bus of ['drum', 'music', 'atmos'] as const) {
        const bs = preset.busState[bus]
        expect(typeof bs.eqLow).toBe('number')
        expect(typeof bs.eqMid).toBe('number')
        expect(typeof bs.eqHigh).toBe('number')
        expect(typeof bs.saturation).toBe('number')
        expect(typeof bs.gain).toBe('number')
        expect(typeof bs.muted).toBe('boolean')
        expect(typeof bs.solo).toBe('boolean')
      }
    }
  })

  it('EQ values are within ±24 dB range', () => {
    for (const preset of MIXER_PRESETS) {
      for (const bus of ['drum', 'music', 'atmos'] as const) {
        const bs = preset.busState[bus]
        expect(Math.abs(bs.eqLow)).toBeLessThanOrEqual(24)
        expect(Math.abs(bs.eqMid)).toBeLessThanOrEqual(24)
        expect(Math.abs(bs.eqHigh)).toBeLessThanOrEqual(24)
      }
    }
  })

  it('saturation values are 0-10 range', () => {
    for (const preset of MIXER_PRESETS) {
      for (const bus of ['drum', 'music', 'atmos'] as const) {
        const s = preset.busState[bus].saturation
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(10)
      }
    }
  })

  it('filterMode is valid', () => {
    for (const preset of MIXER_PRESETS) {
      expect(['off', 'lp', 'hp']).toContain(preset.filterMode)
    }
  })

  it('Psytrance has punchy drums (eqLow > 0)', () => {
    const psy = MIXER_PRESETS.find((p) => p.name === 'Psytrance')!
    expect(psy.busState.drum.eqLow).toBeGreaterThan(0)
  })

  it('Dark has high saturation (drum >= 4)', () => {
    const dark = MIXER_PRESETS.find((p) => p.name === 'Dark')!
    expect(dark.busState.drum.saturation).toBeGreaterThanOrEqual(4)
  })

  it('Minimal has zero saturation', () => {
    const min = MIXER_PRESETS.find((p) => p.name === 'Minimal')!
    expect(min.busState.drum.saturation).toBe(0)
    expect(min.busState.music.saturation).toBe(0)
    expect(min.busState.atmos.saturation).toBe(0)
  })

  it('Progressive uses LP filter', () => {
    const prog = MIXER_PRESETS.find((p) => p.name === 'Progressive')!
    expect(prog.filterMode).toBe('lp')
  })

  it('Dark uses HP filter', () => {
    const dark = MIXER_PRESETS.find((p) => p.name === 'Dark')!
    expect(dark.filterMode).toBe('hp')
  })

  it('gain values are 0-1.5 range', () => {
    for (const preset of MIXER_PRESETS) {
      for (const bus of ['drum', 'music', 'atmos'] as const) {
        const g = preset.busState[bus].gain
        expect(g).toBeGreaterThan(0)
        expect(g).toBeLessThanOrEqual(1.5)
      }
    }
  })

  it('no bus is muted or soloed in presets', () => {
    for (const preset of MIXER_PRESETS) {
      for (const bus of ['drum', 'music', 'atmos'] as const) {
        expect(preset.busState[bus].muted).toBe(false)
        expect(preset.busState[bus].solo).toBe(false)
      }
    }
  })
})
