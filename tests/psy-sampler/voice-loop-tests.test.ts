// Loop points + reverse tests — verify SampleVoice's loop mode handling.
//
// Phase 1.3 of the roadmap: "Sample reverse + Loop points (forward/backward/
// ping-pong)". These tests verify the VoiceTriggerOptions.loop enum is
// correctly translated into AudioBufferSourceNode settings.
//
// We use the same shim pattern as other voice tests: a MockAudioContext
// that records the calls made to AudioBufferSourceNode so we can assert
// on the resulting configuration (loop, loopStart, loopEnd, playbackRate,
// start offset).

import { describe, test, expect, mock } from 'bun:test'
import { SampleVoice } from '@/psy-sampler/voice'
import type { VoiceTriggerOptions } from '@/psy-sampler'
import type { AudioBuffer, AudioContext } from '../psy-foundation-shim/protocol'

/** Mock source node — records all configuration for assertions. */
class MockSource {
  buffer: AudioBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = { value: 1, cancelScheduledValues: mock(), setValueAtTime: mock() }
  onended: (() => void) | null = null
  // History of start() calls: [when, offset]
  startCalls: Array<[number, number?]> = []
  stopCalls: number[] = []
  connectTargets: unknown[] = []
  disconnectCalls = 0

  set Buffer(b: AudioBuffer | null) { this.buffer = b }
  get Buffer() { return this.buffer }

  start(when: number, offset?: number) { this.startCalls.push([when, offset]) }
  stop(when?: number) { if (typeof when === 'number') this.stopCalls.push(when) }
  connect(t: unknown) { this.connectTargets.push(t) }
  disconnect() { this.disconnectCalls++ }
}

class MockGain {
  gain = {
    value: 1,
    cancelScheduledValues: mock(),
    setValueAtTime: mock(),
    linearRampToValueAtTime: mock(),
    exponentialRampToValueAtTime: mock(),
  }
  connectTargets: unknown[] = []
  disconnectCalls = 0
  connect(t: unknown) { this.connectTargets.push(t) }
  disconnect() { this.disconnectCalls++ }
}

class MockPanner {
  pan = { value: 0 }
  connectTargets: unknown[] = []
  disconnectCalls = 0
  connect(t: unknown) { this.connectTargets.push(t) }
  disconnect() { this.disconnectCalls++ }
}

class MockBiquad {
  type = 'lowpass'
  frequency = { value: 1000 }
  Q = { value: 0.7 }
  oversample = 'none'
  connectTargets: unknown[] = []
  disconnectCalls = 0
  connect(t: unknown) { this.connectTargets.push(t) }
  disconnect() { this.disconnectCalls++ }
}

class MockContext {
  currentTime = 0
  sampleRate = 44100
  destination = { connect: mock(), disconnect: mock() }
  sources: MockSource[] = []
  gains: MockGain[] = []
  panners: MockPanner[] = []
  biquads: MockBiquad[] = []

  createBufferSource() {
    const s = new MockSource()
    this.sources.push(s)
    return s
  }
  createGain() {
    const g = new MockGain()
    this.gains.push(g)
    return g
  }
  createStereoPanner() {
    const p = new MockPanner()
    this.panners.push(p)
    return p
  }
  createBiquadFilter() {
    const b = new MockBiquad()
    this.biquads.push(b)
    return b
  }
}

/** Build a fake AudioBuffer with a known duration. */
function makeBuffer(duration: number): AudioBuffer {
  return {
    duration,
    length: Math.floor(duration * 44100),
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(Math.floor(duration * 44100)),
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer
}

describe('SampleVoice loop + reverse (Phase 1.3)', () => {
  function makeVoice() {
    const ctx = new MockContext()
    const output = { connect: mock(), disconnect: mock() } as unknown as AudioNode
    const voice = new SampleVoice({ audioContext: ctx as unknown as AudioContext, output })
    return { ctx, voice, output }
  }

  function trigger(voice: SampleVoice, buffer: AudioBuffer, opts: Partial<VoiceTriggerOptions>) {
    voice.trigger(buffer, {
      at: 0,
      playbackRate: 1,
      gain: 0.5,
      pan: 0,
      decay: 0.5,
      ...opts,
    } as VoiceTriggerOptions)
  }

  test('one-shot (default) — loop=false, no reverse', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(1.0)
    trigger(voice, buf, {})
    const src = ctx.sources[0]
    expect(src.loop).toBe(false)
    expect(src.playbackRate.value).toBe(1)
    expect(src.startCalls[0]).toEqual([0, 0])  // when=0, offset=0
  })

  test('reverse one-shot — playbackRate negative, offset from end', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(2.0)
    trigger(voice, buf, { reverse: true })
    const src = ctx.sources[0]
    expect(src.loop).toBe(false)
    expect(src.playbackRate.value).toBe(-1)  // negated
    // Offset = bufDuration - startOffset (default 0) = 2.0
    expect(src.startCalls[0]).toEqual([0, 2.0])
  })

  test('forward loop — loop=true, loopStart/loopEnd set, playbackRate positive', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(4.0)
    trigger(voice, buf, {
      loop: 'forward',
      loopStart: 1.0,
      loopEnd: 3.0,
      decay: 10,  // long decay so the loop actually runs
    })
    const src = ctx.sources[0]
    expect(src.loop).toBe(true)
    expect(src.loopStart).toBe(1.0)
    expect(src.loopEnd).toBe(3.0)
    expect(src.playbackRate.value).toBe(1)  // positive (forward)
    // Start at loopStart (since loopMode=forward, not reverse)
    expect(src.startCalls[0]).toEqual([0, 1.0])
  })

  test('backward loop — loop=true, playbackRate negative', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(4.0)
    trigger(voice, buf, {
      loop: 'backward',
      loopStart: 1.0,
      loopEnd: 3.0,
      decay: 10,
    })
    const src = ctx.sources[0]
    expect(src.loop).toBe(true)
    expect(src.loopStart).toBe(1.0)
    expect(src.loopEnd).toBe(3.0)
    expect(src.playbackRate.value).toBe(-1)  // negative (backward)
    // Start at loopEnd (since loopMode=backward)
    expect(src.startCalls[0]).toEqual([0, 3.0])
  })

  test('ping-pong loop — schedules playbackRate sign-flips', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(4.0)
    trigger(voice, buf, {
      loop: 'ping-pong',
      loopStart: 1.0,
      loopEnd: 3.0,
      playbackRate: 1.0,
      decay: 10,  // long enough for multiple cycles
    })
    const src = ctx.sources[0]
    expect(src.loop).toBe(true)
    expect(src.loopStart).toBe(1.0)
    expect(src.loopEnd).toBe(3.0)
    expect(src.playbackRate.value).toBe(1)  // initial rate positive

    // Verify setValueAtTime was called for sign-flips (multiple times).
    const pr = src.playbackRate
    expect(pr.setValueAtTime).toHaveBeenCalled()
    // At minimum: initial + first flip + return = 3 calls (but could be more).
    expect(pr.setValueAtTime.mock.calls.length).toBeGreaterThan(2)

    // Verify the values alternate between +rate and -rate.
    const values = pr.setValueAtTime.mock.calls.map(c => c[0])
    // First should be the positive rate.
    expect(values[0]).toBe(1)
    // Second should be the negative rate (after forward phase).
    expect(values[1]).toBe(-1)
    // Third should be positive again (after backward phase).
    expect(values[2]).toBe(1)
  })

  test('reverse + forward loop — start at loopEnd, playbackRate negative', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(4.0)
    trigger(voice, buf, {
      loop: 'forward',
      reverse: true,
      loopStart: 1.0,
      loopEnd: 3.0,
      decay: 10,
    })
    const src = ctx.sources[0]
    expect(src.loop).toBe(true)
    // Reverse + forward → playbackRate negated, start at loopEnd
    expect(src.playbackRate.value).toBe(-1)
    expect(src.startCalls[0]).toEqual([0, 3.0])
  })

  test('loopStart clamped to buffer bounds', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(2.0)
    trigger(voice, buf, {
      loop: 'forward',
      loopStart: -1,  // invalid — should clamp to 0
      loopEnd: 100,   // invalid — should clamp to bufDuration
      decay: 10,
    })
    const src = ctx.sources[0]
    expect(src.loopStart).toBe(0)
    expect(src.loopEnd).toBe(2.0)  // clamped to bufDuration
  })

  test('loopEnd enforced > loopStart (minimum 1ms gap)', () => {
    const { voice, ctx } = makeVoice()
    const buf = makeBuffer(2.0)
    trigger(voice, buf, {
      loop: 'forward',
      loopStart: 1.0,
      loopEnd: 1.0,  // equal — should be bumped to 1.001
      decay: 10,
    })
    const src = ctx.sources[0]
    expect(src.loopEnd).toBeGreaterThan(1.0)
    expect(src.loopEnd).toBeGreaterThanOrEqual(1.001)
  })
})
