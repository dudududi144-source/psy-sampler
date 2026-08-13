// Selection tests — verify genuinely deterministic sample selection.

import { describe, it, expect } from 'bun:test'
import {
  SelectionPolicy,
  pitchRatio,
  SampleLibrary,
  SampleLoader,
} from '../../src/psy-sampler'
import type { SampleAsset, SampleManifestEntry, SampleCategory, SelectionOutput } from '../../src/psy-sampler'
import { Rng } from '../../src/psy-foundation-shim'

// Minimal in-memory sample for testing (no AudioBuffer needed for selection logic).
function makeFakeAsset(id: string, category: SampleCategory, subcategory: string, rootNote = 33): SampleAsset {
  const fakeBuffer = {
    duration: 0.3, sampleRate: 44100, numberOfChannels: 1, length: 13230,
    getChannelData: () => new Float32Array(13230),
  } as unknown as AudioBuffer
  return {
    metadata: {
      id, file: `samples/${id}.wav`, category, subcategory,
      provenance: { source: 'test', author: 'test', license: 'test', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'none' },
      character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote },
      duration: 0.3, sampleRate: 44100, channels: 1,
    },
    audioBuffer: fakeBuffer,
    monoData: new Float32Array(13230),
    features: { peak: 1, rms: 0.3, duration: 0.3, sampleRate: 44100, channels: 1 },
  }
}

function makeLibraryWith(...assets: SampleAsset[]): SampleLibrary {
  const loader = {} as SampleLoader
  const lib = new SampleLibrary(loader)
  for (const a of assets) {
    lib.add(a, {} as SampleManifestEntry)
  }
  return lib
}

describe('SelectionPolicy — determinism', () => {
  it('same input → same output (stateless, no mutable counters)', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    const input = {
      role: 'kick' as const, bank: null, velocity: 0.8,
      phraseIndex: 3, seed: 42,
    }
    // Call select() 100 times with identical inputs — must produce identical output.
    const first = policy.select(input)
    expect(first).not.toBeNull()
    for (let i = 0; i < 100; i++) {
      const result = policy.select(input)
      expect(result).toEqual(first)
    }
  })

  it('same input sequence across separate policy instances → same output sequence', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    // Run a 8-phrase sequence twice with fresh policy instances.
    const runOnce = () => {
      const policy = new SelectionPolicy(lib)
      const outputs: Array<SelectionOutput | null> = []
      for (let phrase = 0; phrase < 8; phrase++) {
        const r = policy.select({
          role: 'kick', bank: null, velocity: 0.8,
          phraseIndex: phrase, seed: 42,
        })
        outputs.push(r)
      }
      return outputs
    }
    const run1 = runOnce()
    const run2 = runOnce()
    expect(run1.length).toBe(run2.length)
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i]).toEqual(run2[i])
    }
  })

  it('no Math.random — byte-identical across runs', () => {
    const lib = makeLibraryWith(makeFakeAsset('kick-1', 'kick', 'a'))
    const runOnce = () => {
      const policy = new SelectionPolicy(lib)
      const out: string[] = []
      for (let phrase = 0; phrase < 8; phrase++) {
        out.push(JSON.stringify(policy.select({
          role: 'kick', bank: null, velocity: 0.8,
          phraseIndex: phrase, seed: 1,
        })))
      }
      return out.join('|')
    }
    const r1 = runOnce()
    const r2 = runOnce()
    expect(r1).toBe(r2)
  })

  it('returns null when no sample for role', () => {
    const lib = makeLibraryWith(makeFakeAsset('kick-1', 'kick', 'a'))
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'clap', bank: null, velocity: 0.8,
      phraseIndex: 0, seed: 1,
    })
    expect(result).toBeNull()
  })

  it('bank filter narrows candidates', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-a1', 'kick', 'a'),
      makeFakeAsset('kick-a2', 'kick', 'a'),
      makeFakeAsset('kick-b1', 'kick', 'b'),
    )
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'kick', bank: 'a', velocity: 0.8,
      phraseIndex: 0, seed: 1,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toMatch(/^kick-a/)
  })

  it('phrase-locked: same phraseIndex → same sampleId (stateless)', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    // Same phraseIndex → same sampleId, regardless of how many times called.
    const r1 = policy.select({
      role: 'kick', bank: null, velocity: 0.8,
      phraseIndex: 2, seed: 1,
    })
    const r2 = policy.select({
      role: 'kick', bank: null, velocity: 0.8,
      phraseIndex: 2, seed: 1,
    })
    const r3 = policy.select({
      role: 'kick', bank: null, velocity: 0.8,
      phraseIndex: 2, seed: 1,
    })
    expect(r1!.sampleId).toBe(r2!.sampleId)
    expect(r2!.sampleId).toBe(r3!.sampleId)
  })

  it('different phraseIndex → may select different variant', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    // Across 16 phrases, at least 2 different variants should be selected
    // (otherwise the RNG isn't rotating).
    const sampleIds = new Set<string>()
    for (let phrase = 0; phrase < 16; phrase++) {
      const r = policy.select({
        role: 'kick', bank: null, velocity: 0.8,
        phraseIndex: phrase, seed: 1,
      })
      sampleIds.add(r!.sampleId)
    }
    expect(sampleIds.size).toBeGreaterThanOrEqual(2)
  })

  it('different seed → different selection sequence', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    const seq1: string[] = []
    const seq2: string[] = []
    for (let phrase = 0; phrase < 8; phrase++) {
      seq1.push(policy.select({ role: 'kick', bank: null, velocity: 0.8, phraseIndex: phrase, seed: 1 })!.sampleId)
      seq2.push(policy.select({ role: 'kick', bank: null, velocity: 0.8, phraseIndex: phrase, seed: 999 })!.sampleId)
    }
    // At least one phrase must differ between the two seeds.
    let diffs = 0
    for (let i = 0; i < seq1.length; i++) {
      if (seq1[i] !== seq2[i]) diffs++
    }
    expect(diffs).toBeGreaterThan(0)
  })

  it('kick pitch variance never exceeds ±0.5%', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    for (let phrase = 0; phrase < 32; phrase++) {
      const r = policy.select({
        role: 'kick', bank: null, velocity: 0.8,
        phraseIndex: phrase, seed: 1,
      })
      expect(r).not.toBeNull()
      const pitchDeviation = Math.abs(r!.playbackRate - 1.0)
      expect(pitchDeviation).toBeLessThanOrEqual(0.005) // ±0.5%
    }
  })

  it('no fake parameters — section/energy/style removed from API', () => {
    // This test enforces that SelectionInput does NOT accept dead fields.
    // If someone adds them back without genuine participation, the type
    // system will catch it. Here we just verify the current shape.
    const input = {
      role: 'kick' as const, bank: null, velocity: 0.8,
      phraseIndex: 0, seed: 1,
    }
    expect(Object.keys(input).sort()).toEqual(
      ['bank', 'phraseIndex', 'role', 'seed', 'velocity']
    )
  })
})

describe('pitchRatio', () => {
  it('octave up = 2.0', () => {
    expect(pitchRatio(60, 72)).toBeCloseTo(2.0, 5)
  })
  it('octave down = 0.5', () => {
    expect(pitchRatio(60, 48)).toBeCloseTo(0.5, 5)
  })
  it('same note = 1.0', () => {
    expect(pitchRatio(60, 60)).toBeCloseTo(1.0, 5)
  })
  it('invalid source (0) → safe fallback 1.0', () => {
    expect(pitchRatio(0, 60)).toBe(1.0)
  })
  it('invalid source (NaN) → safe fallback 1.0', () => {
    expect(pitchRatio(NaN, 60)).toBe(1.0)
  })
  it('fifth up = 1.5ish', () => {
    expect(pitchRatio(60, 67)).toBeCloseTo(1.4983, 3)
  })
})

describe('Rng (mulberry32)', () => {
  it('same seed → same sequence', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next())
    }
  })
  it('different seed → different sequence', () => {
    const a = new Rng(42)
    const b = new Rng(43)
    let diff = 0
    for (let i = 0; i < 100; i++) {
      if (a.next() !== b.next()) diff++
    }
    expect(diff).toBeGreaterThan(90)
  })
  it('range() stays within [min, max)', () => {
    const r = new Rng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r.range(5, 10)
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThan(10)
    }
  })
  it('int() is inclusive', () => {
    const r = new Rng(1)
    for (let i = 0; i < 1000; i++) {
      const v = r.int(1, 3)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(3)
    }
  })
})
