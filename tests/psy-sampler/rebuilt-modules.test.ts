// Tests for rebuilt modules: project-persistence, live-recorder, automation.

import { describe, it, expect } from 'bun:test'
import { createProject, serializeProject, deserializeProject, validateProject } from '../../src/lib/project-persistence'
import { LiveRecorder } from '../../src/lib/live-recorder'
import { createTrack, addPoint, sampleTrack, AutomationBank } from '../../src/lib/automation'
import { DEFAULT_PATTERN } from '../../src/lib/demo-director'

describe('Project persistence (rebuilt)', () => {
  it('createProject sets version + savedAt', () => {
    const p = createProject('test', {
      bpm: 140, swing: 0, masterVolume: 0.85, section: 'DROP', energy: 0.7,
      pattern: structuredClone(DEFAULT_PATTERN),
      busState: {
        drum: { gain: 0.9, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
        music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
        atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
      },
      filterMode: 'off', pumpEnabled: false, evolveEnabled: false,
      song: { name: 'test', segments: [], savedAt: 0 },
    })
    expect(p.version).toBe('1.0.0')
    expect(p.savedAt).toBeGreaterThan(0)
    expect(p.name).toBe('test')
  })

  it('round-trips through serialize/deserialize', () => {
    const p = createProject('rt', {
      bpm: 145, swing: 25, masterVolume: 0.9, section: 'BUILD', energy: 0.8,
      pattern: structuredClone(DEFAULT_PATTERN),
      busState: {
        drum: { gain: 0.9, muted: false, solo: false, eqLow: 6, eqMid: -3, eqHigh: 2, saturation: 3 },
        music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
        atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
      },
      filterMode: 'lp', pumpEnabled: true, evolveEnabled: false,
      song: { name: 'test', segments: [{ slot: 0, bars: 4 }], savedAt: 0 },
    })
    const json = serializeProject(p)
    const restored = deserializeProject(json)
    expect(restored).not.toBeNull()
    expect(restored!.bpm).toBe(145)
    expect(restored!.busState.drum.eqLow).toBe(6)
    expect(restored!.filterMode).toBe('lp')
    expect(restored!.pumpEnabled).toBe(true)
  })

  it('validateProject rejects invalid input', () => {
    expect(validateProject(null)).toBeNull()
    expect(validateProject('string')).toBeNull()
    expect(validateProject({ bpm: 140 })).toBeNull() // missing pattern + busState
  })
})

describe('LiveRecorder (rebuilt)', () => {
  it('isRecording starts false', () => {
    const rec = new LiveRecorder({ ctx: { currentTime: 0 } as AudioContext, sourceNode: {} as AudioNode })
    expect(rec.isRecording).toBe(false)
  })

  it('elapsedMs is 0 when not recording', () => {
    const rec = new LiveRecorder({ ctx: { currentTime: 0 } as AudioContext, sourceNode: {} as AudioNode })
    expect(rec.elapsedMs).toBe(0)
  })

  it('cancel is safe when not recording', () => {
    const rec = new LiveRecorder({ ctx: { currentTime: 0 } as AudioContext, sourceNode: {} as AudioNode })
    expect(() => rec.cancel()).not.toThrow()
  })

  it('stop throws when not recording', async () => {
    const rec = new LiveRecorder({ ctx: { currentTime: 0 } as AudioContext, sourceNode: {} as AudioNode })
    await expect(rec.stop('test')).rejects.toThrow('Not recording')
  })
})

describe('Automation (rebuilt)', () => {
  it('createTrack starts empty', () => {
    const t = createTrack('master.gain', 0.85)
    expect(t.points.length).toBe(0)
    expect(t.defaultValue).toBe(0.85)
  })

  it('addPoint keeps sorted', () => {
    let t = createTrack('master.gain', 0.85)
    t = addPoint(t, 10, 0.5)
    t = addPoint(t, 2, 0.9)
    expect(t.points.map((p) => p.time)).toEqual([2, 10])
  })

  it('sampleTrack interpolates linearly', () => {
    let t = createTrack('master.gain', 0.85)
    t = addPoint(t, 0, 0)
    t = addPoint(t, 10, 100)
    expect(sampleTrack(t, 5)).toBe(50)
  })

  it('sampleTrack returns default when empty', () => {
    const t = createTrack('master.gain', 0.85)
    expect(sampleTrack(t, 100)).toBe(0.85)
  })

  it('AutomationBank manages multiple tracks', () => {
    const bank = new AutomationBank()
    bank.addPoint('master.gain', 0, 0.5)
    bank.addPoint('master.gain', 10, 0.9)
    bank.addPoint('masterFilter.freq', 5, 2000)
    const sampled = bank.sampleAll(5)
    expect(sampled['master.gain']).toBe(0.7)
    expect(sampled['masterFilter.freq']).toBe(2000)
    expect(bank.activeTracks.length).toBe(2)
  })
})
