// Selection tests — verify deterministic sample selection.

import { describe, it, expect } from 'bun:test'
import {
  SelectionPolicy,
  pitchRatio,
  SampleLibrary,
  SampleLoader,
} from '../../src/psy-sampler'
import type { SampleAsset, SampleManifestEntry } from '../../src/psy-sampler'
import { Rng } from '../../src/psy-foundation-shim'

// Minimal in-memory sample for testing (no AudioBuffer needed for selection logic).
function makeFakeAsset(id: string, category: string, subcategory: string, rootNote = 33): SampleAsset {
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
  it('same input sequence → same output sequence (determinism)', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    // Run a full phrase sequence (positions 0-7) twice.
    const runOnce = () => {
      const policy = new SelectionPolicy(lib)
      const outputs = []
      for (let pos = 0; pos < 8; pos++) {
        const r = policy.select({
          role: 'kick', bank: null, velocity: 0.8, section: 'DROP',
          energy: 0.7, style: 'psytrance', phrasePosition: pos, seed: 42,
        })
        outputs.push(r)
      }
      return outputs
    }
    const run1 = runOnce()
    const run2 = runOnce()
    // Both runs must produce identical sequences.
    expect(run1.length).toBe(run2.length)
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i]).toEqual(run2[i])
    }
  })

  it('no Math.random — same sequence is byte-identical across runs', () => {
    const lib = makeLibraryWith(makeFakeAsset('kick-1', 'kick', 'a'))
    // If Math.random were used, two runs would diverge.
    const runOnce = () => {
      const policy = new SelectionPolicy(lib)
      const out = []
      for (let pos = 0; pos < 8; pos++) {
        out.push(JSON.stringify(policy.select({
          role: 'kick', bank: null, velocity: 0.8, section: 'DROP',
          energy: 0.7, style: 'psytrance', phrasePosition: pos, seed: 1,
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
      role: 'clap', bank: null, velocity: 0.8, section: 'DROP',
      energy: 0.7, style: 'psytrance', phrasePosition: 0, seed: 1,
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
      role: 'kick', bank: 'a', velocity: 0.8, section: 'DROP',
      energy: 0.7, style: 'psytrance', phrasePosition: 0, seed: 1,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toMatch(/^kick-a/)
  })

  it('phrase-locked: within a phrase, same sampleId for all positions', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    const baseInput = (pos: number) => ({
      role: 'kick' as const, bank: null, velocity: 0.8, section: 'DROP',
      energy: 0.7, style: 'psytrance', phrasePosition: pos, seed: 1,
    })
    // Position 0 sets the variant; positions 1-7 should keep the same sampleId.
    const r0 = policy.select(baseInput(0))
    for (let pos = 1; pos < 8; pos++) {
      const r = policy.select(baseInput(pos))
      expect(r!.sampleId).toBe(r0!.sampleId)
    }
  })

  it('kick pitch variance never exceeds ±0.5%', () => {
    const lib = makeLibraryWith(
      makeFakeAsset('kick-1', 'kick', 'a'),
      makeFakeAsset('kick-2', 'kick', 'b'),
      makeFakeAsset('kick-3', 'kick', 'c'),
      makeFakeAsset('kick-4', 'kick', 'd'),
    )
    const policy = new SelectionPolicy(lib)
    for (let phrase = 0; phrase < 16; phrase++) {
      const r = policy.select({
        role: 'kick', bank: null, velocity: 0.8, section: 'DROP',
        energy: 0.7, style: 'psytrance', phrasePosition: phrase, seed: 1,
      })
      expect(r).not.toBeNull()
      const pitchDeviation = Math.abs(r!.playbackRate - 1.0)
      expect(pitchDeviation).toBeLessThanOrEqual(0.005) // ±0.5%
    }
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
