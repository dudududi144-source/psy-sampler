// Workstream A+B proof tests — velocity layers, round-robin, per-bus EQ, saturation.
//
// These tests cover the features added to close competitive gaps from
// ROADMAP-TO-100.md (Workstreams A2/A3 and B1/B3):
//   A2. Velocity layers — selector narrows candidates by event velocity
//   A3. Round-robin — hitIndex advances per-note, cycling through candidates
//   B1. Per-bus 3-band EQ — AudioGraph exposes setBusEQ / getBusEQ
//   B3. Saturation — AudioGraph exposes setBusSaturation / getBusSaturation
//
// Determinism is asserted where applicable (saturation curve is pure math,
// not Math.random — byte-identical across calls).

import { describe, it, expect } from 'bun:test'
import {
  SelectionPolicy,
  SampleLibrary,
  AudioGraph,
  type SampleAsset,
  type SampleManifestEntry,
  type SampleCategory,
} from '../../src/psy-sampler'

// ─── Stub AudioContext (supports EQ + saturation nodes) ──────────────────────

function makeStubContext(): AudioContext {
  const createBuffer = (channels: number, length: number, _rate: number) => {
    const channelData: Float32Array[] = []
    for (let c = 0; c < channels; c++) channelData.push(new Float32Array(length))
    return {
      length, numberOfChannels: channels, sampleRate: 44100, duration: length / 44100,
      getChannelData: (ch: number) => channelData[ch]!,
    } as unknown as AudioBuffer
  }
  // AudioParam stub whose setters update .value (so getBusEQ reflects sets).
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: function (v: number) { this.value = v },
    linearRampToValueAtTime: function (v: number) { this.value = v },
    exponentialRampToValueAtTime: function (v: number) { this.value = v },
    cancelScheduledValues: function () {},
    setTargetAtTime: function (v: number) { this.value = v },
  })
  return {
    currentTime: 0,
    sampleRate: 44100,
    destination: {} as AudioNode,
    createGain: () => ({
      gain: makeParam(1),
      connect: () => {}, disconnect: () => {},
    }) as unknown as GainNode,
    createBufferSource: () => ({
      buffer: null as AudioBuffer | null,
      playbackRate: { value: 1 },
      onended: null as ((ev: unknown) => void) | null,
      connect: () => {}, disconnect: () => {},
      start: () => {}, stop: () => {},
    }) as unknown as AudioBufferSourceNode,
    createStereoPanner: () => ({
      pan: { value: 0 },
      connect: () => {}, disconnect: () => {},
    }) as unknown as StereoPannerNode,
    createBiquadFilter: () => ({
      type: 'lowpass',
      frequency: makeParam(1000),
      Q: makeParam(0.7),
      gain: makeParam(0),
      connect: () => {}, disconnect: () => {},
    }) as unknown as BiquadFilterNode,
    createWaveShaper: () => ({
      curve: null as Float32Array | null,
      oversample: 'none',
      connect: () => {}, disconnect: () => {},
    }) as unknown as WaveShaperNode,
    createDelay: (_max: number) => ({
      delayTime: makeParam(0.3),
      connect: () => {}, disconnect: () => {},
    }) as unknown as DelayNode,
    createConvolver: () => ({
      buffer: null as AudioBuffer | null,
      connect: () => {}, disconnect: () => {},
    }) as unknown as ConvolverNode,
    createDynamicsCompressor: () => ({
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 },
      connect: () => {}, disconnect: () => {},
    }) as unknown as DynamicsCompressorNode,
    createAnalyser: () => ({
      fftSize: 256, connect: () => {}, disconnect: () => {},
    }) as unknown as AnalyserNode,
    createBuffer,
  } as unknown as AudioContext
}

function makeAsset(id: string, cat: SampleCategory, rootNote = 33, velocityRange?: [number, number]): SampleAsset {
  const freq = 440 * Math.pow(2, (rootNote - 69) / 12)
  const sampleRate = 44100
  const duration = 0.3
  const length = Math.floor(sampleRate * duration)
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    data[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / 0.15) * 0.9
  }
  const fakeBuffer = {
    duration, sampleRate, numberOfChannels: 1, length,
    getChannelData: () => data,
  } as unknown as AudioBuffer
  return {
    metadata: {
      id, file: `s/${id}.wav`, category: cat, subcategory: 'gen',
      provenance: { source: 'test', author: 'test', license: 'test', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'none' },
      character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote },
      duration, sampleRate, channels: 1,
      velocityRange,
    },
    audioBuffer: fakeBuffer,
    monoData: data,
    features: { peak: 0.9, rms: 0.3, duration, sampleRate, channels: 1 },
  }
}

function makeLibraryWithVelocityLayers(): SampleLibrary {
  const loader = {} as never
  const lib = new SampleLibrary(loader)
  // Kick with 2 velocity layers: soft (0-0.5) and hard (0.5-1.0)
  lib.add(makeAsset('kick-soft', 'kick', 33, [0, 0.5]), {} as SampleManifestEntry)
  lib.add(makeAsset('kick-hard', 'kick', 33, [0.5, 1.0]), {} as SampleManifestEntry)
  return lib
}

function makeLibraryWithRoundRobin(): SampleLibrary {
  const loader = {} as never
  const lib = new SampleLibrary(loader)
  // 3 hat-closed samples (no velocity ranges — all eligible)
  lib.add(makeAsset('hat-1', 'hat-closed', 60), {} as SampleManifestEntry)
  lib.add(makeAsset('hat-2', 'hat-closed', 60), {} as SampleManifestEntry)
  lib.add(makeAsset('hat-3', 'hat-closed', 60), {} as SampleManifestEntry)
  return lib
}

// ─── A2: Velocity layers ─────────────────────────────────────────────────────

describe('A2. Velocity layers', () => {
  it('selects the soft kick layer at velocity 0.3', () => {
    const lib = makeLibraryWithVelocityLayers()
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'kick', bank: null, velocity: 0.3, phraseIndex: 0, seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('kick-soft')
  })

  it('selects the hard kick layer at velocity 0.8', () => {
    const lib = makeLibraryWithVelocityLayers()
    const policy = new SelectionPolicy(lib)
    const result = policy.select({
      role: 'kick', bank: null, velocity: 0.8, phraseIndex: 0, seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('kick-hard')
  })

  it('selects the hard layer at velocity 0.51 (just above the boundary)', () => {
    const lib = makeLibraryWithVelocityLayers()
    const policy = new SelectionPolicy(lib)
    // 0.51 is clearly in [0.5, 1.0] (hard layer). At exactly 0.5 both layers
    // are eligible (inclusive bounds), so we test just above the boundary.
    const result = policy.select({
      role: 'kick', bank: null, velocity: 0.51, phraseIndex: 0, seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('kick-hard')
  })

  it('falls back to unlayered samples when velocity matches no layer', () => {
    const loader = {} as never
    const lib = new SampleLibrary(loader)
    // One layered sample (0-0.3) + one unlayered (no velocityRange)
    lib.add(makeAsset('kick-layered', 'kick', 33, [0, 0.3]), {} as SampleManifestEntry)
    lib.add(makeAsset('kick-fallback', 'kick', 33), {} as SampleManifestEntry)
    const policy = new SelectionPolicy(lib)
    // velocity 0.9 doesn't match the layered sample's [0, 0.3] → falls back to unlayered
    const result = policy.select({
      role: 'kick', bank: null, velocity: 0.9, phraseIndex: 0, seed: 42,
    })
    expect(result).not.toBeNull()
    expect(result!.sampleId).toBe('kick-fallback')
  })

  it('preserves determinism: same velocity → same layer, always', () => {
    const lib = makeLibraryWithVelocityLayers()
    const policy = new SelectionPolicy(lib)
    const r1 = policy.select({ role: 'kick', bank: null, velocity: 0.3, phraseIndex: 0, seed: 42 })
    const r2 = policy.select({ role: 'kick', bank: null, velocity: 0.3, phraseIndex: 0, seed: 42 })
    expect(r1!.sampleId).toBe(r2!.sampleId)
  })
})

// ─── A3: Round-robin (hitIndex) ───────────────────────────────────────────────

describe('A3. Round-robin (hitIndex)', () => {
  it('cycles through candidates as hitIndex advances', () => {
    const lib = makeLibraryWithRoundRobin()
    const policy = new SelectionPolicy(lib)
    const ids: string[] = []
    for (let i = 0; i < 6; i++) {
      const result = policy.select({
        role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42, hitIndex: i,
      })
      ids.push(result!.sampleId)
    }
    // 3 candidates → cycle: hat-1, hat-2, hat-3, hat-1, hat-2, hat-3
    expect(ids).toEqual(['hat-1', 'hat-2', 'hat-3', 'hat-1', 'hat-2', 'hat-3'])
  })

  it('hitIndex is deterministic: same hitIndex → same sampleId', () => {
    const lib = makeLibraryWithRoundRobin()
    const policy = new SelectionPolicy(lib)
    const r1 = policy.select({ role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42, hitIndex: 2 })
    const r2 = policy.select({ role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42, hitIndex: 2 })
    expect(r1!.sampleId).toBe(r2!.sampleId)
    expect(r1!.sampleId).toBe('hat-3')
  })

  it('falls back to phrase-locked variant when hitIndex is absent', () => {
    const lib = makeLibraryWithRoundRobin()
    const policy = new SelectionPolicy(lib)
    // No hitIndex → uses deriveVariant (phrase-locked)
    const r1 = policy.select({ role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42 })
    const r2 = policy.select({ role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42 })
    // Same phraseIndex → same variant (phrase-locked)
    expect(r1!.sampleId).toBe(r2!.sampleId)
  })

  it('hitIndex round-robin is independent of phraseIndex', () => {
    const lib = makeLibraryWithRoundRobin()
    const policy = new SelectionPolicy(lib)
    // Same hitIndex, different phraseIndex → should pick the SAME sample
    // (hitIndex overrides phrase-locked variant)
    const r1 = policy.select({ role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 0, seed: 42, hitIndex: 1 })
    const r2 = policy.select({ role: 'hat-closed', bank: null, velocity: 0.6, phraseIndex: 99, seed: 42, hitIndex: 1 })
    expect(r1!.sampleId).toBe(r2!.sampleId)
    expect(r1!.sampleId).toBe('hat-2')
  })
})

// ─── B1: Per-bus 3-band EQ ────────────────────────────────────────────────────

describe('B1. Per-bus 3-band EQ', () => {
  it('AudioGraph creates EQ nodes with flat defaults (0 dB)', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    const drumEQ = graph.getBusEQ('drum')
    expect(drumEQ.low).toBe(0)
    expect(drumEQ.mid).toBe(0)
    expect(drumEQ.high).toBe(0)
    graph.dispose()
  })

  it('setBusEQ sets the EQ gains', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusEQ('music', { low: 6, mid: -3, high: 9 })
    const eq = graph.getBusEQ('music')
    expect(eq.low).toBe(6)
    expect(eq.mid).toBe(-3)
    expect(eq.high).toBe(9)
    graph.dispose()
  })

  it('setBusEQ can set individual bands', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusEQ('drum', { low: 12 })
    expect(graph.getBusEQ('drum').low).toBe(12)
    expect(graph.getBusEQ('drum').mid).toBe(0) // unchanged
    graph.dispose()
  })

  it('setBusEQ clamps to ±24 dB', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusEQ('drum', { low: 100 })
    expect(graph.getBusEQ('drum').low).toBe(24)
    graph.setBusEQ('drum', { low: -100 })
    expect(graph.getBusEQ('drum').low).toBe(-24)
    graph.dispose()
  })

  it('different buses have independent EQ', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusEQ('drum', { low: 6 })
    graph.setBusEQ('music', { low: -6 })
    expect(graph.getBusEQ('drum').low).toBe(6)
    expect(graph.getBusEQ('music').low).toBe(-6)
    graph.dispose()
  })
})

// ─── B3: Saturation ───────────────────────────────────────────────────────────

describe('B3. Saturation (waveshaper)', () => {
  it('AudioGraph starts with saturation bypassed (drive 0)', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    expect(graph.getBusSaturation('drum')).toBe(0)
    expect(graph.getBusSaturation('music')).toBe(0)
    expect(graph.getBusSaturation('atmos')).toBe(0)
    graph.dispose()
  })

  it('setBusSaturation sets the drive', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusSaturation('drum', 5)
    expect(graph.getBusSaturation('drum')).toBe(5)
    graph.dispose()
  })

  it('setBusSaturation clamps to 0..10', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusSaturation('drum', 100)
    expect(graph.getBusSaturation('drum')).toBe(10)
    graph.setBusSaturation('drum', -5)
    expect(graph.getBusSaturation('drum')).toBe(0)
    graph.dispose()
  })

  it('different buses have independent saturation', () => {
    const ctx = makeStubContext()
    const graph = new AudioGraph(ctx)
    graph.setBusSaturation('drum', 7)
    graph.setBusSaturation('music', 3)
    expect(graph.getBusSaturation('drum')).toBe(7)
    expect(graph.getBusSaturation('music')).toBe(3)
    graph.dispose()
  })
})
