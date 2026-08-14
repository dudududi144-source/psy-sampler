// C2 proof tests — runtime sample import with provenance enforcement.
//
// These tests verify SampleLibrary.addFromBuffer():
//   - Accepts a decoded AudioBuffer + provenance, adds to library
//   - Refuses samples with commercialUse=false (license policy)
//   - Refuses samples missing license or source
//   - Imported samples participate in selection (queryable by category)
//   - Features (peak, rms, duration) are computed correctly
//   - Imported samples coexist with manifest-loaded samples

import { describe, it, expect } from 'bun:test'
import { SampleLibrary, SelectionPolicy } from '../../src/psy-sampler'
import type { SampleCategory } from '../../src/psy-sampler'

// ─── Stub AudioBuffer ────────────────────────────────────────────────────────

function makeStubBuffer(durationSec: number, sampleRate = 44100, channels = 1): AudioBuffer {
  const length = Math.floor(sampleRate * durationSec)
  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) {
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      // Sine wave at 440Hz, 0.8 amplitude
      data[i] = Math.sin(2 * Math.PI * 440 * (i / sampleRate)) * 0.8
    }
    channelData.push(data)
  }
  return {
    length,
    numberOfChannels: channels,
    sampleRate,
    duration: durationSec,
    getChannelData: (ch: number) => channelData[ch]!,
  } as unknown as AudioBuffer
}

function makeValidProvenance() {
  return {
    source: 'freesound.org/user123',
    author: 'Jane Doe',
    license: 'CC0 1.0',
    licenseUrl: null,
    commercialUse: true,
    attribution: null,
    usageRestrictions: 'None',
    dateAcquired: '2026-01-01',
  }
}

// ─── addFromBuffer: success path ─────────────────────────────────────────────

describe('C2. addFromBuffer — successful import', () => {
  it('adds a sample with valid provenance', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.5)
    const added = lib.addFromBuffer('user-1', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: makeValidProvenance(),
      rootNote: 33,
    })
    expect(added).toBe(true)
    expect(lib.size).toBe(1)
    expect(lib.get('user-1')).toBeDefined()
  })

  it('computes features (peak, rms, duration) from the buffer', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.5, 44100, 1)
    lib.addFromBuffer('user-1', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: makeValidProvenance(),
    })
    const asset = lib.get('user-1')!
    expect(asset.features.duration).toBeCloseTo(0.5, 1)
    expect(asset.features.sampleRate).toBe(44100)
    expect(asset.features.channels).toBe(1)
    // Sine wave at 0.8 amplitude → peak ≈ 0.8
    expect(asset.features.peak).toBeGreaterThan(0.7)
    expect(asset.features.peak).toBeLessThan(0.81)
    // RMS of a sine wave at amplitude A is A/√2 ≈ 0.566
    expect(asset.features.rms).toBeGreaterThan(0.5)
    expect(asset.features.rms).toBeLessThan(0.6)
  })

  it('imports a stereo buffer (downmixes to mono for features)', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3, 44100, 2)
    const added = lib.addFromBuffer('user-stereo', buffer, {
      category: 'lead',
      subcategory: 'user',
      provenance: makeValidProvenance(),
    })
    expect(added).toBe(true)
    const asset = lib.get('user-stereo')!
    expect(asset.metadata.channels).toBe(2)
    expect(asset.monoData.length).toBe(Math.floor(44100 * 0.3))
  })

  it('imports with velocityRange (for velocity-layer selection)', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    lib.addFromBuffer('user-vel', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: makeValidProvenance(),
      velocityRange: [0, 0.5],
    })
    const asset = lib.get('user-vel')!
    expect(asset.metadata.velocityRange).toEqual([0, 0.5])
  })

  it('sets dateAcquired to today if not provided', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    // Pass provenance WITHOUT dateAcquired — verify the library defaults it.
    const { dateAcquired: _omit, ...provenanceWithoutDate } = makeValidProvenance()
    lib.addFromBuffer('user-1', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: provenanceWithoutDate,
    })
    const asset = lib.get('user-1')!
    const today = new Date().toISOString().slice(0, 10)
    expect(asset.metadata.provenance.dateAcquired).toBe(today)
  })

  it('imported sample is queryable by category (participates in selection)', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    lib.addFromBuffer('user-kick', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: makeValidProvenance(),
    })
    const results = lib.query({ category: 'kick' })
    expect(results).toContain('user-kick')
  })

  it('imported sample works with SelectionPolicy', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    lib.addFromBuffer('user-kick', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: makeValidProvenance(),
    })
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'kick',
      bank: null,
      velocity: 0.8,
      phraseIndex: 0,
      seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('user-kick')
  })
})

// ─── addFromBuffer: provenance enforcement (refusal path) ───────────────────

describe('C2. addFromBuffer — provenance enforcement (refuses)', () => {
  it('refuses samples with commercialUse=false', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    const provenance = { ...makeValidProvenance(), commercialUse: false }
    const added = lib.addFromBuffer('user-bad', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance,
    })
    expect(added).toBe(false)
    expect(lib.size).toBe(0)
    expect(lib.get('user-bad')).toBeUndefined()
  })

  it('refuses samples missing license', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    const provenance = { ...makeValidProvenance(), license: '' }
    const added = lib.addFromBuffer('user-nolicense', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance,
    })
    expect(added).toBe(false)
    expect(lib.size).toBe(0)
  })

  it('refuses samples missing source', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    const provenance = { ...makeValidProvenance(), source: '' }
    const added = lib.addFromBuffer('user-nosource', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance,
    })
    expect(added).toBe(false)
    expect(lib.size).toBe(0)
  })

  it('refuses samples with null source', () => {
    const lib = new SampleLibrary({} as never)
    const buffer = makeStubBuffer(0.3)
    const provenance = { ...makeValidProvenance(), source: null as unknown as string }
    const added = lib.addFromBuffer('user-nullsource', buffer, {
      category: 'kick',
      subcategory: 'user',
      provenance,
    })
    expect(added).toBe(false)
  })
})

// ─── addFromBuffer: coexistence with manifest samples ────────────────────────

describe('C2. addFromBuffer — coexistence with manifest samples', () => {
  it('imported samples coexist with manually-added samples', () => {
    const lib = new SampleLibrary({} as never)
    // Add a "manifest" sample via add()
    const manifestBuffer = makeStubBuffer(0.2)
    const manifestAsset = {
      metadata: {
        id: 'kick-procedural',
        file: 'samples/kick.wav',
        category: 'kick' as SampleCategory,
        subcategory: 'gen',
        provenance: makeValidProvenance(),
        character: { character: [], genreFit: [], bpmRange: [120, 160] as [number, number], rootNote: 33 },
        duration: 0.2, sampleRate: 44100, channels: 1,
      },
      audioBuffer: manifestBuffer,
      monoData: new Float32Array(100),
      features: { peak: 0.9, rms: 0.3, duration: 0.2, sampleRate: 44100, channels: 1 },
    }
    lib.add(manifestAsset, {} as never)

    // Add a user-imported sample via addFromBuffer()
    const importBuffer = makeStubBuffer(0.4)
    const added = lib.addFromBuffer('user-kick', importBuffer, {
      category: 'kick',
      subcategory: 'user',
      provenance: makeValidProvenance(),
    })
    expect(added).toBe(true)
    expect(lib.size).toBe(2)

    // Both are queryable as kicks
    const kicks = lib.query({ category: 'kick' })
    expect(kicks).toContain('kick-procedural')
    expect(kicks).toContain('user-kick')
  })

  it('dedupes by id (importing same id replaces)', () => {
    const lib = new SampleLibrary({} as never)
    const buffer1 = makeStubBuffer(0.3)
    const buffer2 = makeStubBuffer(0.5)
    lib.addFromBuffer('user-1', buffer1, {
      category: 'kick', subcategory: 'user', provenance: makeValidProvenance(),
    })
    lib.addFromBuffer('user-1', buffer2, {
      category: 'kick', subcategory: 'user', provenance: makeValidProvenance(),
    })
    expect(lib.size).toBe(1)
    // The second import should have replaced the first (duration 0.5)
    expect(lib.get('user-1')!.features.duration).toBeCloseTo(0.5, 1)
  })
})
