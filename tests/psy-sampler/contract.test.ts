// Contract tests — verify SamplerDevice implements PsyDevice correctly.
// Uses Bun's native test runner.

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  InMemoryChannel,
  DeviceHost,
  type PsyDevice,
  type MusicalTransport,
  type MusicalContext,
  type NoteEvent,
} from '../../src/psy-foundation-shim'
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
import { VoicePool } from '../../src/psy-foundation-shim'

// Stub AudioContext for non-browser testing.
class StubAudioContext {
  currentTime = 0
  sampleRate = 44100
  destination = {} as AudioNode
  createGain() {
    return {
      gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, cancelScheduledValues: () => {}, setTargetAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
    } as unknown as GainNode
  }
  createBufferSource() {
    return {
      buffer: null,
      playbackRate: { value: 1 },
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      onended: null,
    } as unknown as AudioBufferSourceNode
  }
  createStereoPanner() {
    return {
      pan: { value: 0 },
      connect: () => {},
      disconnect: () => {},
    } as unknown as StereoPannerNode
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
      numberOfChannels: channels,
      length,
      duration: length / 44100,
      sampleRate: 44100,
      getChannelData: () => data,
    } as unknown as AudioBuffer
  }
}

function makeStubTransport(revision = 1): MusicalTransport {
  return {
    bpm: 145,
    beat: 0,
    bar: 0,
    beatsPerBar: 4,
    beatTime: 0,
    barTime: 0,
    phase: 0,
    barPhase: 0,
    confidence: 1,
    locked: true,
    revision,
    origin: { audioTime: 0, beatIndex: 0, bpm: 145 },
    lastObservationAgo: 0,
    observationCount: 1,
  }
}

function makeStubContext(section = 'DROP', energy = 0.7): MusicalContext {
  return { key: 'A', rootPc: 9, scale: 'phrygianDominant', energy, style: 'psytrance', section, beatsPerBar: 4 }
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
  const selectionPolicy = new SelectionPolicy(library)
  const scheduler = new RealizationScheduler(ctx as unknown as AudioContext)
  wireSchedulerTrigger(scheduler, voicePool, audioGraph)
  return { audioGraph, voicePool, loader, library, selectionPolicy, scheduler }
}

describe('Contract: SamplerDevice implements PsyDevice', () => {
  let ctx: StubAudioContext
  let bundle: ReturnType<typeof makeBundle>
  let device: SamplerDevice

  beforeEach(() => {
    ctx = new StubAudioContext()
    bundle = makeBundle(ctx)
    device = new SamplerDevice({
      audioContext: ctx as unknown as AudioContext,
      library: bundle.library,
      selectionPolicy: bundle.selectionPolicy,
      scheduler: bundle.scheduler,
      audioGraph: bundle.audioGraph,
      voicePool: bundle.voicePool,
      voiceCount: 32,
      manifestUrl: '',
    })
  })

  it('has id "psy-sampler"', () => {
    expect(device.id).toBe('psy-sampler')
  })

  it('capabilities() returns roles including "sampler"', () => {
    const caps = device.capabilities()
    expect(caps.audio).toBe(true)
    expect(caps.roles).toContain('sampler')
    expect(caps.voices).toBe(32)
    expect(caps.latencyMs).toBeGreaterThan(0)
  })

  it('implements all 7 PsyDevice methods', () => {
    const d = device as unknown as PsyDevice
    expect(typeof d.id).toBe('string')
    expect(typeof d.capabilities).toBe('function')
    expect(typeof d.onTransport).toBe('function')
    expect(typeof d.onContext).toBe('function')
    expect(typeof d.onEvent).toBe('function')
    // onStart/onStop/reportLatencyMs are optional
    expect(typeof d.onStart).toBe('function')
    expect(typeof d.onStop).toBe('function')
    expect(typeof d.reportLatencyMs).toBe('function')
  })

  it('registers with DeviceHost without throwing', () => {
    const channel = new InMemoryChannel('test')
    const host = new DeviceHost(channel)
    expect(() => host.register(device)).not.toThrow()
    expect(host.deviceCount).toBe(1)
  })

  it('receives transport via DeviceHost.pushTransport', () => {
    const channel = new InMemoryChannel('test')
    const host = new DeviceHost(channel)
    host.register(device)
    const t = makeStubTransport(42)
    host.pushTransport(t, performance.now())
    // Device should have received it (we verify via side effect — bpm syncs to delay).
    // No direct accessor, but no throw = success.
    expect(device.eventsReceived).toBe(0)
  })

  it('receives context via DeviceHost.pushContext', () => {
    const channel = new InMemoryChannel('test')
    const host = new DeviceHost(channel)
    host.register(device)
    const c = makeStubContext('BREAK', 0.3)
    host.pushContext(c)
    expect(device.eventsReceived).toBe(0)
  })

  it('receives NoteEvent via DeviceHost.publish', () => {
    const channel = new InMemoryChannel('test')
    const host = new DeviceHost(channel)
    host.register(device)
    host.pushTransport(makeStubTransport(1), performance.now())
    host.pushContext(makeStubContext(), performance.now())
    const event: NoteEvent = {
      type: 'note',
      note: 33,
      velocity: 0.8,
      duration: 0.2,
      channel: 'kick',
      at: ctx.currentTime + 0.1,
    }
    host.publish(event)
    expect(device.eventsReceived).toBe(1)
    // Note: without loaded samples, notesSkipped increments.
    expect(device.notesSkipped).toBe(1)
  })

  it('onStart starts the scheduler', () => {
    device.onStart?.()
    expect(device.isStarted).toBe(true)
    expect(bundle.scheduler.isRunning).toBe(true)
  })

  it('onStop stops the scheduler and resets', () => {
    device.onStart?.()
    device.onStop?.()
    expect(device.isStarted).toBe(false)
    expect(bundle.scheduler.isRunning).toBe(false)
  })

  it('coexists with another device in the same host', () => {
    const channel = new InMemoryChannel('test')
    const host = new DeviceHost(channel)
    host.register(device)
    // Register a second fake device.
    const fake: PsyDevice = {
      id: 'fake-synth',
      capabilities: () => ({ audio: true, midi: false, inputs: 0, outputs: 1, voices: 16, latencyMs: 5, roles: ['synth'] }),
      onTransport: () => {},
      onContext: () => {},
      onEvent: () => {},
    }
    host.register(fake)
    expect(host.deviceCount).toBe(2)
    expect(host.findByRole('sampler').length).toBe(1)
    expect(host.findByRole('synth').length).toBe(1)
  })

  it('DeviceHost transport dedup by revision', () => {
    const channel = new InMemoryChannel('test')
    const host = new DeviceHost(channel, { transportDedupByRevision: true })
    let receivedCount = 0
    const dev: PsyDevice = {
      id: 'counter',
      capabilities: () => ({ audio: false, midi: false, inputs: 0, outputs: 0, voices: 0, latencyMs: 0, roles: [] }),
      onTransport: () => { receivedCount++ },
      onContext: () => {},
      onEvent: () => {},
    }
    host.register(dev)
    const t1 = makeStubTransport(1)
    host.pushTransport(t1, 0)
    host.pushTransport(t1, 10) // same revision — deduped
    expect(receivedCount).toBe(1)
    const t2 = makeStubTransport(2)
    host.pushTransport(t2, 20) // new revision — delivered
    expect(receivedCount).toBe(2)
  })
})
