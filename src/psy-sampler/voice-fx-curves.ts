// voice-fx-curves — WaveShaper curves for per-voice FX (Phase 1.6).
//
// WaveShaperNode is the most portable way to add non-linear processing
// (transient design, bitcrushing, saturation) to a Web Audio voice chain.
// It runs natively on the audio thread (no JS callback overhead) and is
// supported by every modern browser.
//
// Each function here returns a Float32Array of length N (typically 1024
// or 65536 for high-resolution curves) that the WaveShaperNode uses as a
// lookup table. The curve maps input sample value x ∈ [-1, +1] to an
// output sample value y = curve[idx(x)] where idx scales x from [-1, +1]
// to [0, N-1].
//
// Implementation notes:
//   - 65536 entries gives ~16-bit resolution (good for bitcrusher)
//   - All curves are ODD functions (curve[-x] = -curve[x]) to avoid DC offset
//   - Bitcrusher curve is quantized: rounds to 2^bits levels

const CURVE_SIZE = 65536

/**
 * The Float32Array type used by WaveShaperNode.curve. Older TS lib
 * versions used Float32Array<ArrayBufferLike>; newer ones use
 * Float32Array<ArrayBuffer>. We cast at the call site to match the
 * target's expectation.
 */
export type CurveArray = Float32Array<ArrayBuffer>

/** Map input x ∈ [-1, +1] to array index [0, CURVE_SIZE-1]. */
function xToIdx(x: number): number {
  // x = -1 → 0, x = 0 → CURVE_SIZE/2, x = +1 → CURVE_SIZE-1
  return Math.max(0, Math.min(CURVE_SIZE - 1, Math.floor((x + 1) * 0.5 * (CURVE_SIZE - 1))))
}

/**
 * Build a transient designer curve.
 *
 * Positive `amount` emphasizes fast changes in amplitude (sharpens attacks).
 * Negative `amount` softens them (more legato).
 *
 * Implementation: a waveshaper curve that's mostly linear near 0 (preserves
 * sustained content) but boosts/compresses the high-amplitude region
 * (where transients live). For positive amount, the curve is convex
 * (gentle expansion). For negative amount, concave (compression).
 *
 * @param amount Range -1..+1. 0 = bypass (linear curve).
 */
export function transientCurve(amount: number): CurveArray {
  const curve = new Float32Array(CURVE_SIZE)
  const amt = Math.max(-1, Math.min(1, amount))
  if (amt === 0) {
    // Bypass — linear identity curve.
    for (let i = 0; i < CURVE_SIZE; i++) {
      curve[i] = (i / (CURVE_SIZE - 1)) * 2 - 1
    }
    return curve
  }
  // For positive amt: convex curve (expansion). Formula:
  //   y = sign(x) * (1 - (1 - |x|)^k) where k = 1 + amt*3 (k > 1 = expansion)
  // For negative amt: concave curve (compression). Formula:
  //   y = sign(x) * |x|^(1 - amt) where exponent < 1 = compression
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1  // x ∈ [-1, +1]
    const absX = Math.abs(x)
    let y: number
    if (amt > 0) {
      const k = 1 + amt * 3  // k ∈ (1, 4] for amt ∈ (0, 1]
      y = 1 - Math.pow(1 - absX, k)
    } else {
      const exponent = 1 - amt  // amt < 0 → exponent > 1 = compression
      y = Math.pow(absX, exponent)
    }
    curve[i] = Math.sign(x) * y
  }
  return curve
}

/**
 * Build a bitcrusher curve.
 *
 * Reduces effective bit depth by quantizing the output to 2^bits levels.
 * 16 bits = no audible effect (CD quality). 8 bits = crunchy. 4 bits =
 * harsh, lo-fi. 0 bits = silence.
 *
 * @param bits Range 0..16. 16 or absent = bypass.
 */
export function bitcrusherCurve(bits: number): CurveArray {
  const curve = new Float32Array(CURVE_SIZE)
  const b = Math.max(0, Math.min(16, Math.floor(bits)))
  if (b >= 16) {
    // Bypass — linear identity.
    for (let i = 0; i < CURVE_SIZE; i++) {
      curve[i] = (i / (CURVE_SIZE - 1)) * 2 - 1
    }
    return curve
  }
  // Quantize: levels = 2^bits. Step size = 2 / levels.
  const levels = Math.pow(2, b)
  const step = 2 / levels
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1
    // Quantize: round to nearest step level, center at 0.
    const quantized = Math.round(x / step) * step
    curve[i] = Math.max(-1, Math.min(1, quantized))
  }
  return curve
}

/**
 * Build a saturation curve.
 *
 * Soft-clipping saturation using tanh. `drive` 0 = bypass (linear).
 * Higher drive = more harmonic content + louder perceived volume.
 *
 * @param drive Range 0..10. 0 = bypass. 1.5 = subtle warmth. 4 = noticeable. 10 = extreme.
 */
export function saturationCurve(drive: number): CurveArray {
  const curve = new Float32Array(CURVE_SIZE)
  const d = Math.max(0, Math.min(10, drive))
  if (d <= 0.01) {
    // Bypass — linear.
    for (let i = 0; i < CURVE_SIZE; i++) {
      curve[i] = (i / (CURVE_SIZE - 1)) * 2 - 1
    }
    return curve
  }
  // tanh(x * drive) / tanh(drive) — normalizes so max output = 1
  const norm = 1 / Math.tanh(d)
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1
    curve[i] = Math.tanh(x * d) * norm
  }
  return curve
}

/**
 * Build a combined curve (cascaded effects).
 *
 * For efficiency, when multiple FX are active, we can pre-compute a
 * single curve that applies them all at once. This avoids creating 3
 * separate WaveShaperNodes.
 *
 * Order: transient → bitcrusher → saturation (matches the chain order).
 *
 * @param opts The VoiceFXOptions.
 */
export function combinedFxCurve(opts: {
  transient?: number
  bitcrusher?: number
  saturation?: number
}): CurveArray {
  const hasTransient = typeof opts.transient === 'number' && Math.abs(opts.transient!) > 0.01
  const hasBitcrusher = typeof opts.bitcrusher === 'number' && opts.bitcrusher! < 16
  const hasSaturation = typeof opts.saturation === 'number' && opts.saturation! > 0.01

  if (!hasTransient && !hasBitcrusher && !hasSaturation) {
    // Bypass — linear.
    const curve = new Float32Array(CURVE_SIZE)
    for (let i = 0; i < CURVE_SIZE; i++) {
      curve[i] = (i / (CURVE_SIZE - 1)) * 2 - 1
    }
    return curve
  }

  // Pre-compute individual curves (we'd cache these in production).
  const t = hasTransient ? transientCurve(opts.transient!) : null
  const b = hasBitcrusher ? bitcrusherCurve(opts.bitcrusher!) : null
  const s = hasSaturation ? saturationCurve(opts.saturation!) : null

  // Combine: for each input x, apply transient → bitcrusher → saturation.
  const curve = new Float32Array(CURVE_SIZE)
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = (i / (CURVE_SIZE - 1)) * 2 - 1
    let y = x
    if (t) y = t[xToIdx(y)]
    if (b) y = b[xToIdx(y)]
    if (s) y = s[xToIdx(y)]
    curve[i] = y
  }
  return curve
}
