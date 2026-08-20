// sample-editor — offline AudioBuffer editing utilities (Phase 2.3).
//
// Pure functions for non-destructive (returns NEW buffer) sample editing:
//   - trimBuffer(source, ctx, startSec, endSec) → new buffer with [start, end]
//   - fadeInOut(source, ctx, fadeInSec, fadeOutSec) → applies linear fades
//   - normalizeBuffer(source, ctx, targetPeak=0.95) → scales to target peak
//   - reverseBuffer(source, ctx) → reverses sample order
//   - applyEdits(source, ctx, opts) → all-in-one (trim → reverse → fade → normalize)
//
// All functions return a NEW AudioBuffer — the source is never mutated.
// This is the "non-destructive editing" principle: the user can always
// undo by re-loading the original sample.
//
// Used by the SampleEditModal component (Phase 2.3.2) to provide a
// basic sample editor in the browser. No cloud, no server — all client-side.

/**
 * Trim an AudioBuffer to the given time range.
 *
 * @param source   The input AudioBuffer.
 * @param ctx      The AudioContext (for creating the output buffer).
 * @param startSec Start time in seconds.
 * @param endSec   End time in seconds (must be > startSec, clamped to duration).
 * @returns A NEW AudioBuffer containing samples [startSec, endSec].
 */
export function trimBuffer(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  startSec: number,
  endSec: number,
): AudioBuffer {
  const sr = source.sampleRate
  const dur = source.duration
  const start = Math.max(0, Math.min(dur - 0.001, startSec))
  const end = Math.max(start + 0.001, Math.min(dur, endSec))
  const startSample = Math.floor(start * sr)
  const endSample = Math.floor(end * sr)
  const newLength = endSample - startSample
  const numChannels = source.numberOfChannels
  const output = ctx.createBuffer(numChannels, newLength, sr)
  for (let ch = 0; ch < numChannels; ch++) {
    const src = source.getChannelData(ch)
    const dst = output.getChannelData(ch)
    for (let i = 0; i < newLength; i++) {
      dst[i] = src[startSample + i] ?? 0
    }
  }
  return output
}

/**
 * Apply linear fade-in and fade-out to an AudioBuffer.
 *
 * @param source      The input AudioBuffer.
 * @param ctx         The AudioContext.
 * @param fadeInSec   Fade-in duration in seconds (0 = no fade-in).
 * @param fadeOutSec  Fade-out duration in seconds (0 = no fade-out).
 * @returns A NEW AudioBuffer with fades applied.
 */
export function fadeInOut(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  fadeInSec: number,
  fadeOutSec: number,
): AudioBuffer {
  const sr = source.sampleRate
  const len = source.length
  const numChannels = source.numberOfChannels
  const output = ctx.createBuffer(numChannels, len, sr)
  const fadeInSamples = Math.max(0, Math.min(len, Math.floor(fadeInSec * sr)))
  const fadeOutSamples = Math.max(0, Math.min(len, Math.floor(fadeOutSec * sr)))
  for (let ch = 0; ch < numChannels; ch++) {
    const src = source.getChannelData(ch)
    const dst = output.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      let gain = 1
      // Linear fade-in: 0 → 1 over fadeInSamples.
      if (i < fadeInSamples && fadeInSamples > 0) {
        gain *= i / fadeInSamples
      }
      // Linear fade-out: 1 → 0 over last fadeOutSamples.
      const distFromEnd = len - i
      if (distFromEnd < fadeOutSamples && fadeOutSamples > 0) {
        gain *= distFromEnd / fadeOutSamples
      }
      dst[i] = src[i] * gain
    }
  }
  return output
}

/**
 * Normalize an AudioBuffer to a target peak amplitude.
 *
 * @param source     The input AudioBuffer.
 * @param ctx        The AudioContext.
 * @param targetPeak Target peak (0..1). Default 0.95 (leaves headroom).
 * @returns A NEW AudioBuffer scaled so the peak = targetPeak.
 *          If source is silent (peak=0), returns a copy unchanged.
 */
export function normalizeBuffer(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  targetPeak: number = 0.95,
): AudioBuffer {
  const sr = source.sampleRate
  const len = source.length
  const numChannels = source.numberOfChannels
  // Find peak across all channels.
  let peak = 0
  for (let ch = 0; ch < numChannels; ch++) {
    const data = source.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
  }
  const output = ctx.createBuffer(numChannels, len, sr)
  // If silent, just copy (don't multiply by 0).
  if (peak < 1e-6) {
    for (let ch = 0; ch < numChannels; ch++) {
      output.getChannelData(ch).set(source.getChannelData(ch))
    }
    return output
  }
  const scale = targetPeak / peak
  for (let ch = 0; ch < numChannels; ch++) {
    const src = source.getChannelData(ch)
    const dst = output.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      dst[i] = src[i] * scale
    }
  }
  return output
}

/**
 * Reverse an AudioBuffer (sample order flipped).
 *
 * @param source The input AudioBuffer.
 * @param ctx    The AudioContext.
 * @returns A NEW AudioBuffer with samples in reverse order.
 */
export function reverseBuffer(
  source: AudioBuffer,
  ctx: BaseAudioContext,
): AudioBuffer {
  const sr = source.sampleRate
  const len = source.length
  const numChannels = source.numberOfChannels
  const output = ctx.createBuffer(numChannels, len, sr)
  for (let ch = 0; ch < numChannels; ch++) {
    const src = source.getChannelData(ch)
    const dst = output.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      dst[i] = src[len - 1 - i]
    }
  }
  return output
}

/**
 * Apply all edits in the standard order: trim → reverse → fade → normalize.
 *
 * Order rationale:
 *   1. Trim first (reduces buffer size, speeds up subsequent operations)
 *   2. Reverse (if requested) before fades (so fades apply to the correct ends)
 *   3. Fade in/out (applies to the reversed buffer if reversed)
 *   4. Normalize LAST (so the final peak is the target, regardless of fades)
 *
 * @param source The input AudioBuffer.
 * @param ctx    The AudioContext.
 * @param opts   Edit options (all optional, default = no-op).
 * @returns A NEW AudioBuffer with all edits applied.
 */
export interface SampleEditOptions {
  /** Trim start time in seconds (default 0). */
  trimStart?: number
  /** Trim end time in seconds (default: end of buffer). */
  trimEnd?: number
  /** Reverse the buffer (default false). */
  reverse?: boolean
  /** Fade-in duration in seconds (default 0). */
  fadeIn?: number
  /** Fade-out duration in seconds (default 0). */
  fadeOut?: number
  /** Normalize to this peak (0..1). Set to 0 to skip normalization (default 0 = skip). */
  normalize?: number
}

export function applyEdits(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  opts: SampleEditOptions,
): AudioBuffer {
  let buf = source
  // 1. Trim
  if (typeof opts.trimStart === 'number' || typeof opts.trimEnd === 'number') {
    buf = trimBuffer(buf, ctx, opts.trimStart ?? 0, opts.trimEnd ?? buf.duration)
  }
  // 2. Reverse
  if (opts.reverse) {
    buf = reverseBuffer(buf, ctx)
  }
  // 3. Fades
  if ((opts.fadeIn ?? 0) > 0 || (opts.fadeOut ?? 0) > 0) {
    buf = fadeInOut(buf, ctx, opts.fadeIn ?? 0, opts.fadeOut ?? 0)
  }
  // 4. Normalize (last)
  if (typeof opts.normalize === 'number' && opts.normalize > 0) {
    buf = normalizeBuffer(buf, ctx, opts.normalize)
  }
  return buf
}
