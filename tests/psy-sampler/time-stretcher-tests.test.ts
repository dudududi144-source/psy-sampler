// Time-stretcher tests — verify granular pitch-shift + time-stretch.
//
// Phase 1.1 + 1.2: independent pitch + tempo control.
//
// These tests verify the CORE algorithmic correctness:
//   1. Output length matches the expected formula
//   2. Pitch-shift preserves duration
//   3. Time-stretch preserves pitch (zero-crossing density)
//   4. Combined pitch + tempo
//
// We DON'T verify exact sample values (granular processing has phase
// artifacts by design). We verify the structural properties.

import { describe, test, expect } from 'bun:test'
import { granularStretch, pitchShift, timeStretch } from '@/psy-sampler/time-stretcher'

/**
 * Build a fake AudioContext that can create AudioBuffers.
 * We don't need real audio — just the createBuffer method.
 */
function makeCtx(): BaseAudioContext {
  return {
    sampleRate: 44100,
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

/** Build a sine wave AudioBuffer at the given frequency + duration. */
function makeSineBuffer(
  ctx: BaseAudioContext,
  freq: number,
  durationSec: number,
  numChannels = 1,
): AudioBuffer {
  const length = Math.floor(durationSec * 44100)
  const buf = ctx.createBuffer(numChannels, length, 44100)
  for (let c = 0; c < numChannels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < length; i++) {
      data[i] = Math.sin(2 * Math.PI * freq * (i / 44100))
    }
  }
  return buf
}

/** Count zero crossings in a buffer (proxy for pitch detection). */
function countZeroCrossings(data: Float32Array): number {
  let count = 0
  for (let i = 1; i < data.length; i++) {
    if ((data[i - 1] < 0 && data[i] >= 0) || (data[i - 1] >= 0 && data[i] < 0)) {
      count++
    }
  }
  return count
}

describe('time-stretcher (Phase 1.1 + 1.2)', () => {
  describe('granularStretch — output length', () => {
    test('tempoRatio=1 → output length = source length', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = granularStretch(src, ctx, 1, 1)
      expect(out.length).toBe(src.length)
    })

    test('tempoRatio=2 (faster) → output length = source/2', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = granularStretch(src, ctx, 1, 2)
      expect(out.length).toBeLessThan(src.length * 0.6)
      expect(out.length).toBeGreaterThan(src.length * 0.4)
    })

    test('tempoRatio=0.5 (slower) → output length = source*2', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = granularStretch(src, ctx, 1, 0.5)
      expect(out.length).toBeGreaterThan(src.length * 1.8)
      expect(out.length).toBeLessThan(src.length * 2.2)
    })

    test('tempoRatio=4 → output length = source/4', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = granularStretch(src, ctx, 1, 4)
      expect(out.length).toBeLessThan(src.length * 0.3)
      expect(out.length).toBeGreaterThan(src.length * 0.2)
    })
  })

  describe('pitchShift — preserves duration', () => {
    test('pitchRatio=2 → output length = source length', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = pitchShift(src, ctx, 2)
      // Pitch-shift preserves duration.
      expect(out.length).toBe(src.length)
    })

    test('pitchRatio=0.5 → output length = source length', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = pitchShift(src, ctx, 0.5)
      expect(out.length).toBe(src.length)
    })
  })

  describe('pitchShift — pitch change verified via zero crossings', () => {
    test('pitchRatio=2 → ~2× more zero crossings (pitch doubled)', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)  // 440 Hz → ~880 crossings in 1s
      const out = pitchShift(src, ctx, 2)
      const srcCrossings = countZeroCrossings(src.getChannelData(0))
      const outCrossings = countZeroCrossings(out.getChannelData(0))
      // Pitch doubled → crossings should be ~2× (with some tolerance for
      // grain-boundary artifacts).
      expect(outCrossings).toBeGreaterThan(srcCrossings * 1.7)
      expect(outCrossings).toBeLessThan(srcCrossings * 2.3)
    })

    test('pitchRatio=0.5 → ~half the zero crossings (pitch halved)', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = pitchShift(src, ctx, 0.5)
      const srcCrossings = countZeroCrossings(src.getChannelData(0))
      const outCrossings = countZeroCrossings(out.getChannelData(0))
      // Pitch halved → crossings should be ~0.5×.
      expect(outCrossings).toBeGreaterThan(srcCrossings * 0.4)
      expect(outCrossings).toBeLessThan(srcCrossings * 0.6)
    })
  })

  describe('timeStretch — preserves pitch', () => {
    test('tempoRatio=2 (faster) → same number of zero crossings per second', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)  // 1s, 440 Hz
      const out = timeStretch(src, ctx, 2)  // 0.5s output
      const srcCrossings = countZeroCrossings(src.getChannelData(0))
      const outCrossings = countZeroCrossings(out.getChannelData(0))
      // Pitch preserved → crossings per SECOND should be the same.
      // src: srcCrossings in 1s → srcCrossings/sec
      // out: outCrossings in 0.5s → outCrossings/0.5 = 2*outCrossings/sec
      const srcRate = srcCrossings / 1.0
      const outRate = outCrossings / (out.length / 44100)
      // Allow 20% tolerance for grain artifacts.
      expect(outRate).toBeGreaterThan(srcRate * 0.7)
      expect(outRate).toBeLessThan(srcRate * 1.3)
    })

    test('tempoRatio=0.5 (slower) → same number of zero crossings per second', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 1.0)
      const out = timeStretch(src, ctx, 0.5)  // 2s output
      const srcCrossings = countZeroCrossings(src.getChannelData(0))
      const outCrossings = countZeroCrossings(out.getChannelData(0))
      const srcRate = srcCrossings / 1.0
      const outRate = outCrossings / (out.length / 44100)
      expect(outRate).toBeGreaterThan(srcRate * 0.7)
      expect(outRate).toBeLessThan(srcRate * 1.3)
    })
  })

  describe('edge cases', () => {
    test('throws on zero pitchRatio', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 0.1)
      expect(() => granularStretch(src, ctx, 0, 1)).toThrow()
    })

    test('throws on zero tempoRatio', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 0.1)
      expect(() => granularStretch(src, ctx, 1, 0)).toThrow()
    })

    test('throws on grainSize < 64', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 0.1)
      expect(() => granularStretch(src, ctx, 1, 1, 32)).toThrow()
    })

    test('identity (P=1, T=1) → output ≈ source', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 0.5)
      const out = granularStretch(src, ctx, 1, 1)
      // Output should be very close to source (within Hann window reconstruction).
      const srcData = src.getChannelData(0)
      const outData = out.getChannelData(0)
      // Sample at the middle of the buffer (away from grain edges).
      const mid = Math.floor(srcData.length / 2)
      expect(outData[mid]).toBeCloseTo(srcData[mid], 1)
    })

    test('stereo buffer — both channels processed', () => {
      const ctx = makeCtx()
      const src = makeSineBuffer(ctx, 440, 0.5, 2)  // stereo
      const out = pitchShift(src, ctx, 2)
      expect(out.numberOfChannels).toBe(2)
      // Both channels should have similar zero-crossing counts (since they
      // started identical).
      const l = countZeroCrossings(out.getChannelData(0))
      const r = countZeroCrossings(out.getChannelData(1))
      expect(Math.abs(l - r)).toBeLessThan(l * 0.1)  // within 10%
    })
  })
})
