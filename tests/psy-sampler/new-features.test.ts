// Tests for new features: randomize, pattern length, sample removal, session persistence.

import { describe, it, expect } from 'bun:test'
import { DemoDirector, DEFAULT_PATTERN, type Pattern } from '../../src/lib/demo-director'
import { SampleLibrary } from '../../src/psy-sampler'
import type { DeviceHost, NoteEvent } from '../../src/psy-foundation-shim'
import { saveSessionState, loadSessionState, clearSessionState, type SessionState } from '../../src/lib/session-persistence'

class CaptureHost implements Pick<DeviceHost, 'publish' | 'pushTransport' | 'pushContext'> {
  events: NoteEvent[] = []
  publish(event: NoteEvent): void { this.events.push(event) }
  pushTransport(): void {}
  pushContext(): void {}
}

function makeDirector(pattern?: Pattern, steps?: number): DemoDirector {
  const host = new CaptureHost()
  const transport = {
    start: () => {}, stop: () => {}, setBpm: () => {},
    snapshot: () => ({ bpm: 140, bar: 0, beat: 0, revision: 1, isPlaying: true }),
    currentBpm: 140,
  } as never
  const ctx = { currentTime: 0, sampleRate: 44100, destination: {} as AudioNode } as unknown as AudioContext
  return new DemoDirector(
    { host: host as unknown as DeviceHost, transport, audioContext: ctx, initialPattern: pattern, steps },
    () => {}
  )
}

// ─── Randomize Pattern ────────────────────────────────────────────────────────

describe('Randomize Pattern', () => {
  it('produces a non-empty pattern', () => {
    const director = makeDirector()
    director.randomizePattern(42)
    const pattern = director.getPattern()
    // Kick should have at least 4 notes (4-on-floor).
    const kickNotes = pattern.kick.filter((v) => v > 0).length
    expect(kickNotes).toBeGreaterThanOrEqual(4)
  })

  it('is deterministic — same seed → same pattern', () => {
    const d1 = makeDirector()
    const d2 = makeDirector()
    d1.randomizePattern(42)
    d2.randomizePattern(42)
    expect(JSON.stringify(d1.getPattern())).toBe(JSON.stringify(d2.getPattern()))
  })

  it('different seeds → different patterns', () => {
    const d1 = makeDirector()
    const d2 = makeDirector()
    d1.randomizePattern(42)
    d2.randomizePattern(99)
    expect(JSON.stringify(d1.getPattern())).not.toBe(JSON.stringify(d2.getPattern()))
  })

  it('kick 4-on-floor: steps 0,4,8,12 are always on', () => {
    const director = makeDirector()
    director.randomizePattern(42)
    const kick = director.getPattern().kick
    expect(kick[0]).toBeGreaterThan(0)
    expect(kick[4]).toBeGreaterThan(0)
    expect(kick[8]).toBeGreaterThan(0)
    expect(kick[12]).toBeGreaterThan(0)
  })

  it('clap on steps 4 and 12', () => {
    const director = makeDirector()
    director.randomizePattern(42)
    const clap = director.getPattern().clap
    expect(clap[4]).toBeGreaterThan(0)
    expect(clap[12]).toBeGreaterThan(0)
  })

  it('velocities are within MIDI range (0-127)', () => {
    const director = makeDirector()
    director.randomizePattern(42)
    for (const role of Object.keys(director.getPattern()) as Array<keyof Pattern>) {
      const row = director.getPattern()[role]!
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(127)
      }
    }
  })

  it('respects pattern length (32 steps)', () => {
    const director = makeDirector(undefined, 32)
    director.randomizePattern(42)
    expect(director.getPattern().kick.length).toBe(32)
  })
})

// ─── Pattern Length ───────────────────────────────────────────────────────────

describe('Pattern Length', () => {
  it('default is 16 steps', () => {
    const director = makeDirector()
    expect(director.stepCount).toBe(16)
  })

  it('can be set to 8', () => {
    const director = makeDirector()
    director.setStepCount(8)
    expect(director.stepCount).toBe(8)
    expect(director.getPattern().kick.length).toBe(8)
  })

  it('can be set to 32', () => {
    const director = makeDirector()
    director.setStepCount(32)
    expect(director.stepCount).toBe(32)
    expect(director.getPattern().kick.length).toBe(32)
  })

  it('padding with zeros when expanding', () => {
    const director = makeDirector()
    director.setStepCount(32)
    // Steps 16-31 should be 0 (padded).
    const kick = director.getPattern().kick
    for (let i = 16; i < 32; i++) {
      expect(kick[i]).toBe(0)
    }
  })

  it('truncating when shrinking', () => {
    const director = makeDirector()
    director.setStepCount(32)
    // Set a note at step 20.
    director.getPattern().kick[20] = 100
    director.setStepCount(16)
    expect(director.getPattern().kick.length).toBe(16)
    // Step 20 is gone.
    expect(director.getPattern().kick[20] ?? -1).toBe(-1)
  })

  it('rejects invalid lengths', () => {
    const director = makeDirector()
    director.setStepCount(7)
    expect(director.stepCount).toBe(16) // unchanged
    director.setStepCount(64)
    expect(director.stepCount).toBe(16) // unchanged
  })
})

// ─── Sample Removal ───────────────────────────────────────────────────────────

describe('Sample Removal', () => {
  it('remove returns true for existing sample', () => {
    const lib = new SampleLibrary({} as never)
    // Use add() to add a stub asset.
    const data = new Float32Array(100)
    const fakeBuffer = { length: 100, numberOfChannels: 1, sampleRate: 44100, duration: 0.01, getChannelData: () => data } as unknown as AudioBuffer
    lib.add({
      metadata: {
        id: 'test-1', file: 'test.wav', category: 'kick', subcategory: 'test',
        provenance: { source: 'test', author: 'test', license: 'test', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'none' },
        character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote: 33 },
        duration: 0.01, sampleRate: 44100, channels: 1,
      },
      audioBuffer: fakeBuffer, monoData: data,
      features: { peak: 0.9, rms: 0.3, duration: 0.01, sampleRate: 44100, channels: 1 },
    }, {} as never)
    expect(lib.size).toBe(1)
    expect(lib.remove('test-1')).toBe(true)
    expect(lib.size).toBe(0)
  })

  it('remove returns false for non-existing sample', () => {
    const lib = new SampleLibrary({} as never)
    expect(lib.remove('nonexistent')).toBe(false)
  })

  it('remove cleans up byCategory index', () => {
    const lib = new SampleLibrary({} as never)
    const data = new Float32Array(100)
    const fakeBuffer = { length: 100, numberOfChannels: 1, sampleRate: 44100, duration: 0.01, getChannelData: () => data } as unknown as AudioBuffer
    lib.add({
      metadata: {
        id: 'kick-1', file: 'k.wav', category: 'kick', subcategory: 'gen',
        provenance: { source: 't', author: 't', license: 't', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'n' },
        character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote: 33 },
        duration: 0.01, sampleRate: 44100, channels: 1,
      },
      audioBuffer: fakeBuffer, monoData: data,
      features: { peak: 0.9, rms: 0.3, duration: 0.01, sampleRate: 44100, channels: 1 },
    }, {} as never)
    expect(lib.query({ category: 'kick' }).length).toBe(1)
    lib.remove('kick-1')
    expect(lib.query({ category: 'kick' }).length).toBe(0)
  })
})

// ─── Session Persistence (extended) ──────────────────────────────────────────

describe('Session Persistence (extended)', () => {
  it('saves and restores full state including filterMode + stepCount', () => {
    // Mock localStorage
    const store = new Map<string, string>()
    ;(globalThis as { localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }

    const state: SessionState = {
      bpm: 138,
      swing: 35,
      masterVolume: 0.75,
      section: 'BUILD',
      energy: 0.6,
      busState: {
        drum: { gain: 0.8, muted: false, solo: false, eqLow: 5, eqMid: -2, eqHigh: 3, saturation: 2 },
        music: { gain: 0.9, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
        atmos: { gain: 0.6, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
      },
      filterMode: 'lp',
      pumpEnabled: true,
      evolveEnabled: false,
      stepCount: 32,
      probabilities: { kick: { 0: 0.5 } },
    }
    saveSessionState(state)
    const loaded = loadSessionState()
    expect(loaded).not.toBeNull()
    expect(loaded!.bpm).toBe(138)
    expect(loaded!.filterMode).toBe('lp')
    expect(loaded!.pumpEnabled).toBe(true)
    expect(loaded!.stepCount).toBe(32)
    expect(loaded!.busState.drum.eqLow).toBe(5)
    expect(loaded!.busState.drum.saturation).toBe(2)
    expect(loaded!.probabilities.kick?.[0]).toBe(0.5)

    clearSessionState()
  })

  it('loadSessionState returns null when nothing saved', () => {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void } }).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    }
    expect(loadSessionState()).toBeNull()
  })
})
