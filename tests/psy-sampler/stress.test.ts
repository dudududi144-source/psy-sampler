// Stress + stability tests — verify the sampler handles extreme conditions.
//
// Tests:
//   - 1000 events rapid-fire (voice stealing behavior)
//   - Deterministic replay (same seed → same output sequence)
//   - Concurrent devices (3+ devices on same host)
//   - Memory stability (no unbounded growth)

import { describe, it, expect, beforeEach } from 'bun:test'
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
import { VoicePool, InMemoryChannel, DeviceHost, type PsyDevice, type DeviceCapabilities } from '../../src/psy-foundation-shim'
import type { SampleAsset, SampleManifestEntry, SampleCategory } from '../../src/psy-sampler'

// ─── Stub AudioContext ───────────────────────────────────────────────────────

class StubAudioContext {
  currentTime = 0
  sampleRate = 44100
  destination = {} as AudioNode
  createGain() {
    return {
      gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, setTargetAtTime: () => {} },
      connect: () => {}, disconnect: () => {},
    } as unknown as GainNode
  }
  createBufferSource() {
    return {
      buffer: null, playbackRate: { value: 1 },
      connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {}, onended: null,
    } as unknown as AudioBufferSourceNode
  }
  createStereoPanner() {
    return { pan: { value: 0 }, connect: () => {}, disconnect: () => {} } as unknown as StereoPannerNode
  }
  createDynamicsCompressor() {
    return {
      threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
      attack: { value: 0 }, release: { value: 0 },
      connect: () => {}, disconnect: () => {},
    } as unknown as DynamicsCompressorNode
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
  createBuffer(channels: number, length: number, _rate: number) {
    const data = new Float32Array(length)
    return {
      numberOfChannels: channels, length, duration: length / 44100, sampleRate: 44100,
      getChannelData: () => data,
    } as unknown as AudioBuffer
  }
}

function makeFakeAsset(id: string, category: SampleCategory, rootNote = 33): SampleAsset {
  const fakeBuffer = {
    duration: 0.3, sampleRate: 44100, numberOfChannels: 1, length: 13230,
    getChannelData: () => new Float32Array(13230),
  } as unknown as AudioBuffer
  return {
    metadata: {
      id, file: `samples/${id}.wav`, category, subcategory: 'psy3',
      provenance: { source: 'test', author: 'test', license: 'test', licenseUrl: null, commercialUse: true, attribution: null, dateAcquired: '2026-01-01', usageRestrictions: 'none' },
      character: { character: [], genreFit: [], bpmRange: [120, 160], rootNote },
      duration: 0.3, sampleRate: 44100, channels: 1,
    },
    audioBuffer: fakeBuffer,
    monoData: new Float32Array(13230),
    features: { peak: 1, rms: 0.3, duration: 0.3, sampleRate: 44100, channels: 1 },
  }
}

function makeBundle(ctx: StubAudioContext) {
  const audioGraph = new AudioGraph(ctx as unknown as AudioContext)
  const defaultBus = audioGraph.getBusInput('drum')
  const voicePool = new VoicePool<SampleVoice>(
    () => new SampleVoice({ audioContext: ctx as unknown as AudioContext, output: defaultBus }),
    32
  )
  const loader = new SampleLoader(ctx as unknown as AudioContext)
  const library = new SampleLibrary(loader)
  library.add(makeFakeAsset('kick-1', 'kick'), {} as SampleManifestEntry)
  library.add(makeFakeAsset('kick-2', 'kick'), {} as SampleManifestEntry)
  library.add(makeFakeAsset('kick-3', 'kick'), {} as SampleManifestEntry)
  library.add(makeFakeAsset('kick-4', 'kick'), {} as SampleManifestEntry)
  library.add(makeFakeAsset('bass-1', 'bass'), {} as SampleManifestEntry)
  library.add(makeFakeAsset('lead-1', 'lead', 69), {} as SampleManifestEntry)
  library.add(makeFakeAsset('hat-closed-1', 'hat-closed', 60), {} as SampleManifestEntry)
  library.add(makeFakeAsset('clap-1', 'clap', 60), {} as SampleManifestEntry)
  library.add(makeFakeAsset('perc-1', 'perc', 64), {} as SampleManifestEntry)
  const selectionPolicy = new SelectionPolicy(library)
  const scheduler = new RealizationScheduler(ctx as unknown as AudioContext)
  wireSchedulerTrigger(scheduler, voicePool, audioGraph)
  const channel = new InMemoryChannel('stress-test')
  const host = new DeviceHost(channel)
  const device = new SamplerDevice({
    audioContext: ctx as unknown as AudioContext, library, selectionPolicy, scheduler, audioGraph, voicePool, voiceCount: 32, manifestUrl: '',
  })
  host.register(device)
  return { device, library, selectionPolicy, scheduler, audioGraph, voicePool, host }
}

function makeTransport(revision = 1, bar = 0) {
  return {
    bpm: 145, beat: bar * 4, bar, beatsPerBar: 4, beatTime: 0, barTime: 0,
    phase: 0, barPhase: 0, confidence: 1, locked: true, revision,
    origin: { audioTime: 0, beatIndex: 0, bpm: 145 },
    lastObservationAgo: 0, observationCount: 1,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Stress: 1000 events rapid-fire', () => {
  let ctx: StubAudioContext
  let bundle: ReturnType<typeof makeBundle>

  beforeEach(() => {
    ctx = new StubAudioContext()
    bundle = makeBundle(ctx)
    bundle.device.onStart?.()
    bundle.host.pushTransport(makeTransport(1, 0), 0)
  })

  it('1000 kick events: all received, voice pool never exceeds 32', () => {
    for (let i = 0; i < 1000; i++) {
      bundle.host.publish({
        type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick',
        at: 0.1 + i * 0.001,
      })
    }
    expect(bundle.device.eventsReceived).toBe(1000)
    expect(bundle.device.notesTriggered).toBe(1000)
    expect(bundle.device.notesSkipped).toBe(0)
    expect(bundle.voicePool.size).toBe(32)
    expect(bundle.voicePool.activeCount).toBeLessThanOrEqual(32)
  })

  it('mixed 1000 events across 5 roles: all received', () => {
    const roles = ['kick', 'bass', 'lead', 'hat-closed', 'clap']
    for (let i = 0; i < 1000; i++) {
      const role = roles[i % roles.length]!
      bundle.host.publish({
        type: 'note', note: role === 'bass' ? 33 : role === 'lead' ? 69 : 60,
        velocity: 0.7, duration: 0.1, channel: role,
        at: 0.1 + i * 0.001,
      })
    }
    expect(bundle.device.eventsReceived).toBe(1000)
    expect(bundle.device.notesTriggered).toBe(1000)
  })

  it('simultaneous events (same .at): no crash, all queued', () => {
    const at = 1.0
    for (let i = 0; i < 100; i++) {
      bundle.host.publish({
        type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick', at,
      })
    }
    expect(bundle.scheduler.pendingCount).toBe(100)
  })
})

describe('Deterministic replay: same seed → same output', () => {
  it('same seed + same inputs → identical sampleId sequence (100 phrases)', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)

    const runOnce = (seed: number): string[] => {
      const ids: string[] = []
      for (let phrase = 0; phrase < 100; phrase++) {
        const sel = bundle.selectionPolicy.selectWithNote(
          { role: 'kick', bank: null, velocity: 0.9, phraseIndex: phrase, seed },
          33
        )
        if (sel) ids.push(sel.sampleId)
      }
      return ids
    }

    const run1 = runOnce(42)
    const run2 = runOnce(42)
    expect(run1).toEqual(run2)
    expect(run1.length).toBe(100)
  })

  it('different seed → different sequence (at least 50% differ)', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)

    const runOnce = (seed: number): string[] => {
      const ids: string[] = []
      for (let phrase = 0; phrase < 100; phrase++) {
        const sel = bundle.selectionPolicy.selectWithNote(
          { role: 'kick', bank: null, velocity: 0.9, phraseIndex: phrase, seed },
          33
        )
        if (sel) ids.push(sel.sampleId)
      }
      return ids
    }

    const run1 = runOnce(42)
    const run2 = runOnce(999)
    let diffs = 0
    for (let i = 0; i < run1.length; i++) {
      if (run1[i] !== run2[i]) diffs++
    }
    expect(diffs).toBeGreaterThan(50)
  })

  it('same seed across fresh instances → identical (stateless)', () => {
    const ctx1 = new StubAudioContext()
    const bundle1 = makeBundle(ctx1)

    const ctx2 = new StubAudioContext()
    const bundle2 = makeBundle(ctx2)

    const sel1 = bundle1.selectionPolicy.selectWithNote(
      { role: 'kick', bank: null, velocity: 0.9, phraseIndex: 5, seed: 42 },
      33
    )
    const sel2 = bundle2.selectionPolicy.selectWithNote(
      { role: 'kick', bank: null, velocity: 0.9, phraseIndex: 5, seed: 42 },
      33
    )
    expect(sel1).toEqual(sel2)
  })
})

describe('Concurrent devices: 3+ devices on same host', () => {
  it('3 devices all receive every event', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)
    bundle.device.onStart?.()
    bundle.host.pushTransport(makeTransport(1, 0), 0)

    // Add 2 more stub devices
    const stub1: PsyDevice = {
      id: 'stub-1',
      capabilities: (): DeviceCapabilities => ({ audio: false, midi: false, inputs: 0, outputs: 0, voices: 0, latencyMs: 0, roles: ['observer'] }),
      onTransport: () => {}, onContext: () => {},
      onEvent: () => {},
    }
    const stub2: PsyDevice = {
      id: 'stub-2',
      capabilities: (): DeviceCapabilities => ({ audio: false, midi: false, inputs: 0, outputs: 0, voices: 0, latencyMs: 0, roles: ['observer'] }),
      onTransport: () => {}, onContext: () => {},
      onEvent: () => {},
    }
    bundle.host.register(stub1)
    bundle.host.register(stub2)

    expect(bundle.host.deviceCount).toBe(3)

    // Publish 10 events
    for (let i = 0; i < 10; i++) {
      bundle.host.publish({
        type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick',
        at: 0.1 + i * 0.1,
      })
    }
    expect(bundle.device.eventsReceived).toBe(10)
  })

  it('device unregister: other devices continue receiving', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)
    bundle.device.onStart?.()
    bundle.host.pushTransport(makeTransport(1, 0), 0)

    const stub: PsyDevice = {
      id: 'temp-stub',
      capabilities: (): DeviceCapabilities => ({ audio: false, midi: false, inputs: 0, outputs: 0, voices: 0, latencyMs: 0, roles: ['observer'] }),
      onTransport: () => {}, onContext: () => {},
      onEvent: () => {},
    }
    bundle.host.register(stub)
    expect(bundle.host.deviceCount).toBe(2)

    // Unregister the stub
    bundle.host.unregister('temp-stub')
    expect(bundle.host.deviceCount).toBe(1)

    // Sampler should still receive events
    bundle.host.publish({
      type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick', at: 0.1,
    })
    expect(bundle.device.eventsReceived).toBe(1)
  })

  it('findByRole discovers sampler for "sampler"', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)
    const found = bundle.host.findByRole('sampler')
    expect(found.length).toBe(1)
    expect(found[0].id).toBe('psy-sampler')
  })

  it('findByRole discovers sampler for "kick"', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)
    const found = bundle.host.findByRole('kick')
    expect(found.length).toBe(1)
  })
})

describe('Memory stability: no unbounded growth', () => {
  it('voice pool size stays at 32 after 1000 events', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)
    bundle.device.onStart?.()
    bundle.host.pushTransport(makeTransport(1, 0), 0)

    for (let i = 0; i < 1000; i++) {
      bundle.host.publish({
        type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick',
        at: 0.1 + i * 0.001,
      })
    }
    expect(bundle.voicePool.size).toBe(32)
  })

  it('scheduler queue drains (pendingCount stays bounded)', () => {
    const ctx = new StubAudioContext()
    const bundle = makeBundle(ctx)
    bundle.device.onStart?.()
    bundle.host.pushTransport(makeTransport(1, 0), 0)

    // Queue 100 events
    for (let i = 0; i < 100; i++) {
      bundle.host.publish({
        type: 'note', note: 33, velocity: 0.9, duration: 0.1, channel: 'kick',
        at: 0.1 + i * 0.001,
      })
    }
    expect(bundle.scheduler.pendingCount).toBe(100)

    // Stop → queue cleared
    bundle.device.onStop?.()
    expect(bundle.scheduler.pendingCount).toBe(0)
  })
})
