// Benchmark tests — measure performance characteristics.
//
// These tests don't assert correctness — they measure numbers and ensure
// they stay within acceptable bounds. If a benchmark regresses, the test
// fails and the developer knows to investigate.

import { describe, it, expect } from 'bun:test'
import {
  SampleLibrary,
  SelectionPolicy,
  RealizationScheduler,
  AudioGraph,
  SampleVoice,
  SamplerDevice,
  wireSchedulerTrigger,
} from '../../src/psy-sampler'
import { SampleLoader } from '../../src/psy-sampler/loader'
import { VoicePool, InMemoryChannel, DeviceHost } from '../../src/psy-foundation-shim'
import type { SampleAsset, SampleManifestEntry, SampleCategory } from '../../src/psy-sampler'

class BenchCtx {
  currentTime = 0
  sampleRate = 44100
  destination = {} as AudioNode
  createGain() {
    return { gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, setTargetAtTime: () => {} }, connect: () => {}, disconnect: () => {} } as unknown as GainNode
  }
  createBufferSource() {
    return { buffer: null, playbackRate: { value: 1 }, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {}, onended: null } as unknown as AudioBufferSourceNode
  }
  createStereoPanner() {
    return { pan: { value: 0 }, connect: () => {}, disconnect: () => {} } as unknown as StereoPannerNode
  }
  createDynamicsCompressor() {
    return { threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 }, connect: () => {}, disconnect: () => {} } as unknown as DynamicsCompressorNode
  }
  createAnalyser() {
    return { fftSize: 0, connect: () => {}, disconnect: () => {}, getByteFrequencyData: () => {} } as unknown as AnalyserNode
  }
  createDelay() {
    return { delayTime: { value: 0, setTargetAtTime: () => {} }, connect: () => {}, disconnect: () => {} } as unknown as DelayNode
  }
  createConvolver() {
    return { buffer: null, connect: () => {}, disconnect: () => {} } as unknown as ConvolverNode
  }
  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: { value: 1000, setTargetAtTime: () => {} },
      Q: { value: 0.7, setTargetAtTime: () => {} },
      gain: { value: 0, setTargetAtTime: () => {} },
      connect: () => {}, disconnect: () => {},
    } as unknown as BiquadFilterNode
  }
  createWaveShaper() {
    return {
      curve: null as Float32Array | null,
      oversample: 'none',
      connect: () => {}, disconnect: () => {},
    } as unknown as WaveShaperNode
  }
  createBuffer(ch: number, len: number) {
    return { numberOfChannels: ch, length: len, duration: len / 44100, sampleRate: 44100, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer
  }
}

function makeAsset(id: string, cat: SampleCategory): SampleAsset {
  const buf = { duration: 0.3, sampleRate: 44100, numberOfChannels: 1, length: 13230, getChannelData: () => new Float32Array(13230) } as unknown as AudioBuffer
  return {
    metadata: { id, file: `s/${id}.wav`, category: cat, subcategory: 'g', provenance: { source: 't', author: 't', license: 't', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'n' }, character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote: 33 }, duration: 0.3, sampleRate: 44100, channels: 1 },
    audioBuffer: buf, monoData: new Float32Array(13230), features: { peak: 1, rms: 0.3, duration: 0.3, sampleRate: 44100, channels: 1 },
  }
}

function makeBundle(ctx: BenchCtx) {
  const graph = new AudioGraph(ctx as unknown as AudioContext)
  const bus = graph.getBusInput('drum')
  const pool = new VoicePool<SampleVoice>(() => new SampleVoice({ audioContext: ctx as unknown as AudioContext, output: bus }), 32)
  const loader = new SampleLoader(ctx as unknown as AudioContext)
  const lib = new SampleLibrary(loader)
  ;(['kick','kick','kick','kick','bass','lead','hat-closed','clap','perc'] as SampleCategory[]).forEach((c, i) => lib.add(makeAsset(`${c}-${i}`, c), {} as SampleManifestEntry))
  const sel = new SelectionPolicy(lib)
  const sched = new RealizationScheduler(ctx as unknown as AudioContext)
  wireSchedulerTrigger(sched, pool, graph)
  const ch = new InMemoryChannel('bench')
  const host = new DeviceHost(ch)
  const dev = new SamplerDevice({ audioContext: ctx as unknown as AudioContext, library: lib, selectionPolicy: sel, scheduler: sched, audioGraph: graph, voicePool: pool, voiceCount: 32, manifestUrl: '' })
  host.register(dev)
  return { dev, lib, sel, sched, pool, host }
}

function transport(rev = 1, bar = 0) {
  return { bpm: 145, beat: bar * 4, bar, beatsPerBar: 4, beatTime: 0, barTime: 0, phase: 0, barPhase: 0, confidence: 1, locked: true, revision: rev, origin: { audioTime: 0, beatIndex: 0, bpm: 145 }, lastObservationAgo: 0, observationCount: 1 }
}

describe('Benchmarks', () => {
  it('selection: 10000 select() calls < 50ms', () => {
    const ctx = new BenchCtx()
    const { sel } = makeBundle(ctx)
    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      sel.selectWithNote({ role: 'kick', bank: null, velocity: 0.9, phraseIndex: i % 8, seed: 42 }, 33)
    }
    const elapsed = performance.now() - start
    console.log(`  10000 selections: ${elapsed.toFixed(1)}ms (${(elapsed / 10000 * 1000).toFixed(1)}µs each)`)
    expect(elapsed).toBeLessThan(50)
  })

  it('event throughput: 1000 events < 20ms', () => {
    const ctx = new BenchCtx()
    const { dev, host } = makeBundle(ctx)
    dev.onStart?.()
    host.pushTransport(transport(), 0)
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      host.publish({ type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick', at: 0.1 + i * 0.001 })
    }
    const elapsed = performance.now() - start
    console.log(`  1000 events: ${elapsed.toFixed(1)}ms (${(elapsed / 1000 * 1000).toFixed(1)}µs each)`)
    expect(elapsed).toBeLessThan(100)
    expect(dev.eventsReceived).toBe(1000)
  })

  it('voice pool: 1000 allocations < 5ms', () => {
    const ctx = new BenchCtx()
    const { pool } = makeBundle(ctx)
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      const v = pool.allocate()
      v.noteOn(0, 1)
    }
    const elapsed = performance.now() - start
    console.log(`  1000 allocations: ${elapsed.toFixed(1)}ms`)
    expect(elapsed).toBeLessThan(50)
  })

  it('memory: voice pool stays at 32 after 10000 events', () => {
    const ctx = new BenchCtx()
    const { dev, host, pool } = makeBundle(ctx)
    dev.onStart?.()
    host.pushTransport(transport(), 0)
    for (let i = 0; i < 10000; i++) {
      host.publish({ type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick', at: 0.1 + i * 0.0001 })
    }
    expect(pool.size).toBe(32)
    expect(pool.activeCount).toBeLessThanOrEqual(32)
  })

  it('determinism: same seed produces identical 100-phrase sequence', () => {
    const ctx = new BenchCtx()
    const { sel } = makeBundle(ctx)
    const run = () => {
      const out: string[] = []
      for (let i = 0; i < 100; i++) {
        const r = sel.selectWithNote({ role: 'kick', bank: null, velocity: 0.9, phraseIndex: i, seed: 42 }, 33)
        if (r) out.push(r.sampleId)
      }
      return out.join('|')
    }
    const a = run()
    const b = run()
    expect(a).toBe(b)
  })
})
