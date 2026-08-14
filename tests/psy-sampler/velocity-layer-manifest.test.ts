// Velocity-layer + round-robin manifest integration tests.
//
// These tests load the REAL manifest.json and verify that:
//   1. The manifest contains velocity-layer samples (kick-soft, kick-hard, etc.)
//   2. The manifest contains round-robin samples (hat-closed-rr-1/2/3, etc.)
//   3. SelectionPolicy picks the correct velocity layer based on event velocity
//   4. SelectionPolicy cycles through round-robin variants via hitIndex
//
// This is the end-to-end proof that the generated samples + manifest + selector
// all work together — not just unit tests of the selector in isolation.

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { validateManifest } from '../../src/psy-sampler/manifest'
import { SelectionPolicy, SampleLibrary, SampleLoader } from '../../src/psy-sampler'
import type { SampleManifest } from '../../src/psy-sampler'

// ─── Load + validate the real manifest ───────────────────────────────────────

const manifestRaw = JSON.parse(
  readFileSync('public/samples/manifest.json', 'utf8')
)
const manifest: SampleManifest = validateManifest(manifestRaw)

// ─── Manifest structure ──────────────────────────────────────────────────────

describe('Velocity-layer + round-robin manifest', () => {
  it('manifest has ≥31 samples (19 original + 12 velocity/RR)', () => {
    expect(manifest.samples.length).toBeGreaterThanOrEqual(31)
  })

  it('manifest has velocity-layer kick samples', () => {
    const kicks = manifest.samples.filter((s) => s.category === 'kick')
    const layered = kicks.filter((s) => s.velocityRange)
    expect(layered.length).toBeGreaterThanOrEqual(2)
    const ids = layered.map((s) => s.id)
    expect(ids).toContain('kick-soft')
    expect(ids).toContain('kick-hard')
  })

  it('manifest has round-robin hat-closed samples (≥3)', () => {
    const hats = manifest.samples.filter((s) => s.category === 'hat-closed')
    const rr = hats.filter((s) => s.id.includes('rr'))
    expect(rr.length).toBeGreaterThanOrEqual(3)
  })

  it('manifest has round-robin perc samples (≥3)', () => {
    const percs = manifest.samples.filter((s) => s.category === 'perc')
    const rr = percs.filter((s) => s.id.includes('rr'))
    expect(rr.length).toBeGreaterThanOrEqual(3)
  })

  it('velocity-layer kick-soft has range [0, 0.5]', () => {
    const soft = manifest.samples.find((s) => s.id === 'kick-soft')
    expect(soft).toBeDefined()
    expect(soft!.velocityRange).toEqual([0, 0.5])
  })

  it('velocity-layer kick-hard has range [0.5, 1.0]', () => {
    const hard = manifest.samples.find((s) => s.id === 'kick-hard')
    expect(hard).toBeDefined()
    expect(hard!.velocityRange).toEqual([0.5, 1.0])
  })

  it('all velocity-layer samples have commercialUse=true', () => {
    const layered = manifest.samples.filter((s) => s.velocityRange)
    for (const s of layered) {
      expect(s.commercialUse).toBe(true)
    }
  })

  it('all velocity-layer samples have verification=PROCEDURAL', () => {
    const layered = manifest.samples.filter((s) => s.velocityRange)
    for (const s of layered) {
      expect(s.verification).toBe('PROCEDURAL')
    }
  })
})

// ─── SelectionPolicy with velocity layers ────────────────────────────────────
//
// We can't load the actual WAVs in a test (no AudioContext to decode), but we
// can verify the selector's velocity-layer filtering logic against the manifest
// entries. We build a minimal library with stub assets that have the same
// velocityRange metadata.

import type { SampleAsset, SampleManifestEntry, SampleCategory } from '../../src/psy-sampler'

function makeStubAsset(id: string, category: SampleCategory, velocityRange?: [number, number]): SampleAsset {
  const data = new Float32Array(1024)
  const fakeBuffer = {
    length: 1024, numberOfChannels: 1, sampleRate: 44100, duration: 1024 / 44100,
    getChannelData: () => data,
  } as unknown as AudioBuffer
  return {
    metadata: {
      id, file: `samples/${id}.wav`, category, subcategory: 'velocity-layer',
      provenance: { source: 'test', author: 'test', license: 'test', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'none' },
      character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote: 33 },
      duration: 0.3, sampleRate: 44100, channels: 1,
      velocityRange,
    },
    audioBuffer: fakeBuffer,
    monoData: data,
    features: { peak: 0.9, rms: 0.3, duration: 0.3, sampleRate: 44100, channels: 1 },
  }
}

function makeVelocityLayerLibrary(): SampleLibrary {
  const lib = new SampleLibrary({} as never)
  // Mirror the manifest: kick-soft [0,0.5], kick-hard [0.5,1.0], plus an
  // unlayered kick for fallback testing.
  lib.add(makeStubAsset('kick-soft', 'kick', [0, 0.5]), {} as SampleManifestEntry)
  lib.add(makeStubAsset('kick-hard', 'kick', [0.5, 1.0]), {} as SampleManifestEntry)
  lib.add(makeStubAsset('kick-unlayered', 'kick'), {} as SampleManifestEntry)
  // Round-robin hats (no velocity range)
  lib.add(makeStubAsset('hat-closed-rr-1', 'hat-closed'), {} as SampleManifestEntry)
  lib.add(makeStubAsset('hat-closed-rr-2', 'hat-closed'), {} as SampleManifestEntry)
  lib.add(makeStubAsset('hat-closed-rr-3', 'hat-closed'), {} as SampleManifestEntry)
  return lib
}

describe('SelectionPolicy — velocity-layer selection with real manifest structure', () => {
  it('picks kick-soft at velocity 0.3', () => {
    const lib = makeVelocityLayerLibrary()
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'kick', bank: null, velocity: 0.3, phraseIndex: 0, seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('kick-soft')
  })

  it('picks kick-hard at velocity 0.8', () => {
    const lib = makeVelocityLayerLibrary()
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'kick', bank: null, velocity: 0.8, phraseIndex: 0, seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('kick-hard')
  })

  it('falls back to unlayered kick when velocity matches no layer', () => {
    const lib = makeVelocityLayerLibrary()
    const policy = new SelectionPolicy(lib)
    // Remove the layered kicks, keep only unlayered → should pick unlayered.
    // (Can't easily remove from lib, so we test with a lib that only has unlayered.)
    const lib2 = new SampleLibrary({} as never)
    lib2.add(makeStubAsset('kick-only', 'kick'), {} as SampleManifestEntry)
    const policy2 = new SelectionPolicy(lib2)
    const result = policy2.select({
      role: 'kick', bank: null, velocity: 0.5, phraseIndex: 0, seed: 42,
    })
    expect(result!.sampleId).toBe('kick-only')
  })

  it('round-robin cycles through hat-closed variants via hitIndex', () => {
    const lib = makeVelocityLayerLibrary()
    const policy = new SelectionPolicy(lib)
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      const result = policy.select({
        role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42, hitIndex: i,
      })
      ids.push(result!.sampleId)
    }
    // 3 variants → cycle: rr-1, rr-2, rr-3, rr-1, rr-2, rr-3
    expect(ids).toEqual([
      'hat-closed-rr-1', 'hat-closed-rr-2', 'hat-closed-rr-3',
      'hat-closed-rr-1', 'hat-closed-rr-2', 'hat-closed-rr-3',
    ])
  })

  it('deterministic: same velocity + same hitIndex → same sampleId', () => {
    const lib = makeVelocityLayerLibrary()
    const policy = new SelectionPolicy(lib)
    const r1 = policy.select({ role: 'kick', bank: null, velocity: 0.3, phraseIndex: 0, seed: 42 })
    const r2 = policy.select({ role: 'kick', bank: null, velocity: 0.3, phraseIndex: 0, seed: 42 })
    expect(r1!.sampleId).toBe(r2!.sampleId)
  })
})

// ─── WAV file existence ──────────────────────────────────────────────────────

import { existsSync } from 'node:fs'
import { join } from 'node:path'

describe('Generated WAV files exist', () => {
  const expectedWavs = [
    'kick_soft.wav', 'kick_hard.wav',
    'clap_soft.wav', 'clap_hard.wav',
    'hat_closed_rr1.wav', 'hat_closed_rr2.wav', 'hat_closed_rr3.wav',
    'perc_rr1.wav', 'perc_rr2.wav', 'perc_rr3.wav',
    'hat_open_rr1.wav', 'hat_open_rr2.wav',
  ]
  for (const wav of expectedWavs) {
    it(`${wav} exists`, () => {
      const path = join('public', 'samples', wav)
      expect(existsSync(path)).toBe(true)
    })
  }
})
