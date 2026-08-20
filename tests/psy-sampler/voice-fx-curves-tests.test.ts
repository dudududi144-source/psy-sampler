// Voice FX curve tests — verify the WaveShaper curves for transient,
// bitcrusher, and saturation are mathematically correct.
//
// Phase 1.6 of the roadmap: per-voice FX chain. These tests verify the
// pure-math curve generators (no Web Audio dependency).

import { describe, test, expect } from 'bun:test'
import {
  transientCurve,
  bitcrusherCurve,
  saturationCurve,
  combinedFxCurve,
  type CurveArray,
} from '@/psy-sampler/voice-fx-curves'

const CURVE_SIZE = 65536

/** Get the value at input x ∈ [-1, +1] from a curve. */
function valueAt(curve: CurveArray, x: number): number {
  // Mirror the WaveShaper's index calculation: x ∈ [-1, +1] → [0, N-1].
  const idx = Math.max(0, Math.min(CURVE_SIZE - 1, Math.floor((x + 1) * 0.5 * (CURVE_SIZE - 1))))
  return curve[idx]
}

describe('voice FX curves (Phase 1.6)', () => {
  describe('transientCurve', () => {
    test('zero amount = linear identity curve', () => {
      const curve = transientCurve(0)
      expect(curve.length).toBe(CURVE_SIZE)
      // At x=0, y should be 0.
      expect(valueAt(curve, 0)).toBeCloseTo(0, 2)
      // At x=0.5, y should be 0.5 (linear).
      expect(valueAt(curve, 0.5)).toBeCloseTo(0.5, 2)
      // At x=-0.5, y should be -0.5 (linear).
      expect(valueAt(curve, -0.5)).toBeCloseTo(-0.5, 2)
      // At x=1, y should be 1.
      expect(valueAt(curve, 1)).toBeCloseTo(1, 2)
    })

    test('positive amount = expansion (output > input near 1)', () => {
      const curve = transientCurve(0.5)
      // With expansion, at x=0.5, y > 0.5 (boosted).
      expect(valueAt(curve, 0.5)).toBeGreaterThan(0.5)
      // Max output is still 1 (no clipping).
      expect(valueAt(curve, 1)).toBeCloseTo(1, 2)
    })

    test('negative amount = compression (output < input near 1)', () => {
      const curve = transientCurve(-0.5)
      // With compression, at x=0.5, y < 0.5.
      expect(valueAt(curve, 0.5)).toBeLessThan(0.5)
      // Max output is still 1.
      expect(valueAt(curve, 1)).toBeCloseTo(1, 2)
    })

    test('odd function: curve[-x] = -curve[x] (no DC offset)', () => {
      const curve = transientCurve(0.5)
      // For odd function: curve(-x) = -curve(x).
      expect(valueAt(curve, -0.3)).toBeCloseTo(-valueAt(curve, 0.3), 3)
      expect(valueAt(curve, -0.7)).toBeCloseTo(-valueAt(curve, 0.7), 3)
    })
  })

  describe('bitcrusherCurve', () => {
    test('16 bits = no effect (linear)', () => {
      const curve = bitcrusherCurve(16)
      expect(valueAt(curve, 0.5)).toBeCloseTo(0.5, 2)
      expect(valueAt(curve, -0.5)).toBeCloseTo(-0.5, 2)
    })

    test('4 bits = 16 quantization levels', () => {
      const curve = bitcrusherCurve(4)
      // 4 bits = 16 levels. Step size = 2/16 = 0.125.
      // At x=0.5, nearest level = 0.5 (already on a level boundary).
      expect(valueAt(curve, 0.5)).toBeCloseTo(0.5, 3)
      // At x=0.55, nearest level = 0.5 (since 0.55/0.125 = 4.4 → rounds to 4 → 0.5).
      expect(valueAt(curve, 0.55)).toBeCloseTo(0.5, 3)
      // At x=0.57, nearest level = 0.625 (0.57/0.125 = 4.56 → rounds to 5 → 0.625).
      expect(valueAt(curve, 0.57)).toBeCloseTo(0.625, 3)
    })

    test('8 bits = 256 quantization levels (subtler)', () => {
      const curve = bitcrusherCurve(8)
      // 8 bits = 256 levels. Step size = 2/256 = 0.0078125.
      // At x=0.5, should still be close to 0.5 (small steps).
      expect(valueAt(curve, 0.5)).toBeCloseTo(0.5, 2)
    })

    test('0 bits = extreme quantization (few levels)', () => {
      const curve = bitcrusherCurve(0)
      // 0 bits = 1 level. All samples quantize to 0.
      expect(valueAt(curve, 0.5)).toBeCloseTo(0, 3)
      expect(valueAt(curve, -0.5)).toBeCloseTo(0, 3)
    })
  })

  describe('saturationCurve', () => {
    test('zero drive = linear', () => {
      const curve = saturationCurve(0)
      expect(valueAt(curve, 0.5)).toBeCloseTo(0.5, 2)
    })

    test('positive drive = soft clipping (tanh)', () => {
      const curve = saturationCurve(2)
      // At x=0, y=0 (tanh(0)=0).
      expect(valueAt(curve, 0)).toBeCloseTo(0, 3)
      // At x=1, y=1 (normalized).
      expect(valueAt(curve, 1)).toBeCloseTo(1, 2)
      // Saturation compresses high values: at x=0.5, y > 0.5 (boosted by tanh).
      // tanh(0.5*2)/tanh(2) = 0.7616/0.964 ≈ 0.79
      expect(valueAt(curve, 0.5)).toBeGreaterThan(0.5)
      expect(valueAt(curve, 0.5)).toBeLessThan(1)
    })

    test('odd function: no DC offset', () => {
      const curve = saturationCurve(2)
      expect(valueAt(curve, -0.3)).toBeCloseTo(-valueAt(curve, 0.3), 3)
    })
  })

  describe('combinedFxCurve', () => {
    test('no FX = linear identity', () => {
      const curve = combinedFxCurve({})
      expect(valueAt(curve, 0.5)).toBeCloseTo(0.5, 2)
      expect(valueAt(curve, -0.5)).toBeCloseTo(-0.5, 2)
    })

    test('saturation only = same as saturationCurve alone', () => {
      const combined = combinedFxCurve({ saturation: 2 })
      const alone = saturationCurve(2)
      // Sample at several points — should be identical.
      for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        expect(valueAt(combined, x)).toBeCloseTo(valueAt(alone, x), 3)
      }
    })

    test('bitcrusher + saturation = bitcrusher output passed through saturation', () => {
      const combined = combinedFxCurve({ bitcrusher: 4, saturation: 2 })
      const bc = bitcrusherCurve(4)
      const sat = saturationCurve(2)
      // For each input x: apply bc first, then sat to the bc output.
      // At x=0.55: bc output = 0.5 (quantized). Then sat(0.5, drive=2) = ?
      const bcOut = valueAt(bc, 0.55)
      const expected = valueAt(sat, bcOut)
      expect(valueAt(combined, 0.55)).toBeCloseTo(expected, 3)
    })

    test('odd function: combined curves are odd', () => {
      const curve = combinedFxCurve({ transient: 0.5, bitcrusher: 6, saturation: 1.5 })
      expect(valueAt(curve, -0.4)).toBeCloseTo(-valueAt(curve, 0.4), 3)
    })
  })
})
