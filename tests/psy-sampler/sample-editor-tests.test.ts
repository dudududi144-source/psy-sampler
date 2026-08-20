// Sample editor tests — verify trim, fade, normalize, reverse.
//
// Phase 2.3: offline sample editing. All functions return a NEW AudioBuffer
// (non-destructive). These tests verify the math is correct.

import { describe, test, expect } from 'bun:test'
import {
  trimBuffer,
  fadeInOut,
  normalizeBuffer,
  reverseBuffer,
  applyEdits,
} from '@/psy-sampler/sample-editor'

/** Build a fake AudioContext that can create AudioBuffers.
 * Uses sampleRate=1000 so 1 second = 1000 samples (easier math for tests).
 */
function makeCtx(): BaseAudioContext {
  return {
    sampleRate: 1000,
    createBuffer: (numChannels: number, length: number, sampleRate: number) => {
      const channels: Float32Array[] = []
      for (let c = 0; c < numChannels; c++) {
        channels.push(new Float32Array(length))
      }
      return {
        duration: length / sampleRate,
        length,
        sampleRate,
        numberOfChannels: numChannels,
        getChannelData: (ch: number) => channels[ch] ?? channels[0],
        copyFromChannel: () => {},
        copyToChannel: () => {},
      } as unknown as AudioBuffer
    },
  } as unknown as BaseAudioContext
}

/** Build a buffer with a known pattern (ramp from 0 to 1).
 * Uses sampleRate=1000 so 1 second = 1000 samples.
 */
function makeRampBuffer(ctx: BaseAudioContext, length: number): AudioBuffer {
  const buf = ctx.createBuffer(1, length, 1000)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = i / length
  }
  return buf
}

/** Build a buffer with a constant value. Uses sampleRate=1000. */
function makeConstantBuffer(ctx: BaseAudioContext, length: number, value: number): AudioBuffer {
  const buf = ctx.createBuffer(1, length, 1000)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = value
  }
  return buf
}

describe('sample-editor (Phase 2.3)', () => {
  describe('trimBuffer', () => {
    test('trims to the requested range', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 1000)  // sampleRate=1000, so 1s = 1000 samples
      const out = trimBuffer(src, ctx, 0.1, 0.2)  // samples 100-200
      expect(out.length).toBe(100)
      // First sample should be the source's sample at index 100.
      expect(out.getChannelData(0)[0]).toBeCloseTo(0.1, 2)
    })

    test('clamps start/end to buffer bounds', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 1000)
      const out = trimBuffer(src, ctx, -0.5, 100)  // end way past duration
      expect(out.length).toBeLessThanOrEqual(1000)
    })

    test('enforces end > start (minimum 1ms)', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 1000)
      const out = trimBuffer(src, ctx, 0.5, 0.5)  // equal → bumped to +1ms
      expect(out.length).toBeGreaterThan(0)
    })

    test('preserves channel count for stereo', () => {
      const ctx = makeCtx()
      const src = ctx.createBuffer(2, 1000, 44100)
      const out = trimBuffer(src, ctx, 0, 0.1)
      expect(out.numberOfChannels).toBe(2)
    })
  })

  describe('fadeInOut', () => {
    test('fade-in ramps from 0 to 1', () => {
      const ctx = makeCtx()
      const src = makeConstantBuffer(ctx, 1000, 1)  // all 1s
      const out = fadeInOut(src, ctx, 0.1, 0)  // 0.1s fade-in = 100 samples
      const data = out.getChannelData(0)
      // At sample 0, gain = 0 (fade-in starts at 0).
      expect(data[0]).toBe(0)
      // At sample 50 (middle of fade-in), gain = 0.5.
      expect(data[50]).toBeCloseTo(0.5, 1)
      // At sample 100 (end of fade-in), gain = 1.
      expect(data[100]).toBe(1)
    })

    test('fade-out ramps from 1 to 0', () => {
      const ctx = makeCtx()
      const src = makeConstantBuffer(ctx, 1000, 1)
      const out = fadeInOut(src, ctx, 0, 0.1)  // 0.1s fade-out at the end
      const data = out.getChannelData(0)
      // At the last sample, gain = 1/100 (smallest non-zero value).
      // (Formula: distFromEnd / fadeOutSamples = 1/100 = 0.01.)
      expect(data[999]).toBeLessThan(0.02)
      // At 50 samples from the end, gain ≈ 0.5.
      expect(data[950]).toBeCloseTo(0.5, 1)
      // At the start (no fade-in), gain = 1.
      expect(data[0]).toBe(1)
    })

    test('no fades = identity copy', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 100)
      const out = fadeInOut(src, ctx, 0, 0)
      for (let i = 0; i < 100; i++) {
        expect(out.getChannelData(0)[i]).toBe(src.getChannelData(0)[i])
      }
    })
  })

  describe('normalizeBuffer', () => {
    test('scales to target peak', () => {
      const ctx = makeCtx()
      const src = makeConstantBuffer(ctx, 100, 0.5)  // peak = 0.5
      const out = normalizeBuffer(src, ctx, 0.95)
      const data = out.getChannelData(0)
      // After normalization, peak should be 0.95.
      expect(Math.abs(data[0])).toBeCloseTo(0.95, 2)
    })

    test('silent buffer stays silent (no NaN)', () => {
      const ctx = makeCtx()
      const src = makeConstantBuffer(ctx, 100, 0)  // all zeros
      const out = normalizeBuffer(src, ctx, 0.95)
      const data = out.getChannelData(0)
      // Should not produce NaN (would happen if we divided by 0 peak).
      for (let i = 0; i < 100; i++) {
        expect(Number.isNaN(data[i])).toBe(false)
        expect(data[i]).toBe(0)
      }
    })

    test('preserves stereo channel independence', () => {
      const ctx = makeCtx()
      const src = ctx.createBuffer(2, 100, 44100)
      // L = 0.3 constant, R = 0.6 constant
      const l = src.getChannelData(0)
      const r = src.getChannelData(1)
      for (let i = 0; i < 100; i++) {
        l[i] = 0.3
        r[i] = 0.6
      }
      const out = normalizeBuffer(src, ctx, 0.9)
      // Peak is 0.6 (from R). Scale = 0.9 / 0.6 = 1.5.
      // L should be 0.3 * 1.5 = 0.45.
      // R should be 0.6 * 1.5 = 0.9.
      const lOut = out.getChannelData(0)
      const rOut = out.getChannelData(1)
      expect(lOut[0]).toBeCloseTo(0.45, 2)
      expect(rOut[0]).toBeCloseTo(0.9, 2)
    })
  })

  describe('reverseBuffer', () => {
    test('reverses sample order', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 5)  // 0, 0.2, 0.4, 0.6, 0.8
      const out = reverseBuffer(src, ctx)
      const data = out.getChannelData(0)
      // Should be 0.8, 0.6, 0.4, 0.2, 0.
      expect(data[0]).toBeCloseTo(0.8, 2)
      expect(data[4]).toBeCloseTo(0, 2)
    })

    test('preserves length', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 100)
      const out = reverseBuffer(src, ctx)
      expect(out.length).toBe(100)
    })
  })

  describe('applyEdits (combined)', () => {
    test('trim + reverse + fade + normalize in correct order', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 1000)  // 0 → 1 ramp
      // Trim to [0.1, 0.2] (samples 100-200), then reverse.
      const out = applyEdits(src, ctx, {
        trimStart: 0.1,
        trimEnd: 0.2,
        reverse: true,
        normalize: 0.9,
      })
      // After trim: samples 100-200 (values 0.1 → 0.2)
      // After reverse: values 0.2 → 0.1 (reversed)
      // After normalize: peak (0.2) scaled to 0.9 → all values ×4.5
      const data = out.getChannelData(0)
      // First sample (was 0.2, now 0.2 * 4.5 = 0.9)
      expect(data[0]).toBeCloseTo(0.9, 1)
    })

    test('no edits = identity (returns source unchanged structurally)', () => {
      const ctx = makeCtx()
      const src = makeRampBuffer(ctx, 100)
      const out = applyEdits(src, ctx, {})
      // Should be a copy (new buffer) with same content.
      expect(out.length).toBe(src.length)
      for (let i = 0; i < 100; i++) {
        expect(out.getChannelData(0)[i]).toBe(src.getChannelData(0)[i])
      }
    })
  })
})
