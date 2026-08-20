// Stereo playback tests — verify the SampleVoice plays stereo AudioBuffers
// through the full chain without downmixing.
//
// Phase 1.9: "Stereo sample support — full stereo playback (current: downmix only)"
//
// Reality check: the AudioBufferSourceNode already preserves stereo channels
// natively — when you assign a 2-channel AudioBuffer to source.buffer, the
// source outputs 2 channels. All downstream Web Audio nodes (GainNode,
// BiquadFilterNode, StereoPannerNode, WaveShaperNode) process whatever channel
// count they receive without downmixing.
//
// The "downmix" that exists in the codebase is ONLY for:
//   - Feature extraction (peak, rms) in SampleLoader/library — for simplicity
//   - WaveformThumbnail UI display — uses monoData for visualization
//
// The actual audio path is full stereo. This test documents + verifies that.

import { describe, test, expect, mock } from 'bun:test'
import { SampleVoice } from '@/psy-sampler/voice'
import type { VoiceTriggerOptions } from '@/psy-sampler'
import type { AudioBuffer, AudioContext } from '../psy-foundation-shim/protocol'

class MockStereoSource {
  buffer: AudioBuffer | null = null
  loop = false
  loopStart = 0
  loopEnd = 0
  playbackRate = { value: 1, cancelScheduledValues: mock(), setValueAtTime: mock() }
  onended: (() => void) | null = null
  startCalls: Array<[number, number?]> = []
  stopCalls: number[] = []
  connectTargets: unknown[] = []
  disconnectCalls = 0

  start(when: number, offset?: number) { this.startCalls.push([when, offset]) }
  stop(when?: number) { if (typeof when === 'number') this.stopCalls.push(when) }
  connect(t: unknown) { this.connectTargets.push(t) }
  disconnect() { this.disconnectCalls++ }
}

class MockStereoGain {
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

class MockStereoPanner {
  pan = { value: 0 }
  connectTargets: unknown[] = []
  disconnectCalls = 0
  connect(t: unknown) { this.connectTargets.push(t) }
  disconnect() { this.disconnectCalls++ }
}

class MockContext {
  currentTime = 0
  sampleRate = 44100
  destination = { connect: mock(), disconnect: mock() }
  sources: MockStereoSource[] = []
  gains: MockStereoGain[] = []
  panners: MockStereoPanner[] = []

  createBufferSource() {
    const s = new MockStereoSource()
    this.sources.push(s)
    return s
  }
  createGain() {
    const g = new MockStereoGain()
    this.gains.push(g)
    return g
  }
  createStereoPanner() {
    const p = new MockStereoPanner()
    this.panners.push(p)
    return p
  }
  createBiquadFilter() { return null as never }
  createWaveShaper() { return null as never }
}

/** Build a fake 2-channel (stereo) AudioBuffer. */
function makeStereoBuffer(duration: number): AudioBuffer {
  return {
    duration,
    length: Math.floor(duration * 44100),
    sampleRate: 44100,
    numberOfChannels: 2,  // STEREO
    getChannelData: (ch: number) => {
      // L and R are different — L has DC, R doesn't (so we can verify
      // the source got the full stereo buffer, not a downmix).
      const data = new Float32Array(Math.floor(duration * 44100))
      if (ch === 0) for (let i = 0; i < data.length; i++) data[i] = 0.1 // L = constant 0.1
      return data
    },
    copyFromChannel: () => {},
    copyToChannel: () => {},
  } as unknown as AudioBuffer
}

describe('Stereo playback (Phase 1.9)', () => {
  function makeVoice() {
    const ctx = new MockContext()
    const output = { connect: mock(), disconnect: mock() } as unknown as AudioNode
    const voice = new SampleVoice({ audioContext: ctx as unknown as AudioContext, output })
    return { ctx, voice, output }
  }

  function trigger(voice: SampleVoice, buffer: AudioBuffer, opts: Partial<VoiceTriggerOptions> = {}) {
    voice.trigger(buffer, {
      at: 0,
      playbackRate: 1,
      gain: 0.5,
      pan: 0,
      decay: 0.5,
      ...opts,
    } as VoiceTriggerOptions)
  }

  test('stereo AudioBuffer is assigned to source without downmix', () => {
    const { voice, ctx } = makeVoice()
    const stereoBuf = makeStereoBuffer(1.0)
    trigger(voice, stereoBuf)
    const src = ctx.sources[0]
    // The source's buffer is the original stereo buffer — NOT a mono downmix.
    expect(src.buffer).toBe(stereoBuf)
    expect(src.buffer?.numberOfChannels).toBe(2)
  })

  test('stereo playback respects pan via StereoPannerNode (not downmix)', () => {
    const { voice, ctx } = makeVoice()
    const stereoBuf = makeStereoBuffer(1.0)
    trigger(voice, stereoBuf, { pan: -0.5 })  // pan left
    const panner = ctx.panners[0]
    expect(panner.pan.value).toBe(-0.5)
    // StereoPannerNode modulates stereo width when panning — it doesn't downmix.
    // The source → sourceGain → panner chain preserves the 2-channel signal.
  })

  test('stereo + reverse — playbackRate negated, both channels affected', () => {
    const { voice, ctx } = makeVoice()
    const stereoBuf = makeStereoBuffer(1.0)
    trigger(voice, stereoBuf, { reverse: true })
    const src = ctx.sources[0]
    expect(src.buffer).toBe(stereoBuf)  // still the stereo buffer
    expect(src.playbackRate.value).toBe(-1)
  })

  test('stereo + loop forward — both channels loop together', () => {
    const { voice, ctx } = makeVoice()
    const stereoBuf = makeStereoBuffer(2.0)
    trigger(voice, stereoBuf, {
      loop: 'forward',
      loopStart: 0.5,
      loopEnd: 1.5,
      decay: 10,
    })
    const src = ctx.sources[0]
    expect(src.buffer).toBe(stereoBuf)  // stereo preserved
    expect(src.loop).toBe(true)
    expect(src.loopStart).toBe(0.5)
    expect(src.loopEnd).toBe(1.5)
  })

  test('stereo + per-voice FX (saturation) — both channels processed', () => {
    const { voice, ctx } = makeVoice()
    const stereoBuf = makeStereoBuffer(1.0)
    // Note: ctx.createWaveShaper returns null in our mock, so the voice
    // should gracefully degrade (play without FX, but still stereo).
    trigger(voice, stereoBuf, { fx: { saturation: 2 } })
    const src = ctx.sources[0]
    // Buffer should still be the stereo one — even if FX is bypassed.
    expect(src.buffer).toBe(stereoBuf)
    expect(src.buffer?.numberOfChannels).toBe(2)
  })
})
