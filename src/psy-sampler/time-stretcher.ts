// time-stretcher — granular pitch-shifter + time-stretcher for AudioBuffers.
//
// Phase 1.1 + 1.2: independent pitch + tempo control.
//
// The Web Audio API's native playbackRate couples pitch and tempo:
//   - playbackRate = 2 → plays 2× faster AND 1 octave higher
//   - playbackRate = 0.5 → plays 2× slower AND 1 octave lower
//
// For commercial-grade sampling we need INDEPENDENT control:
//   - "play this sample at 1.5× speed but at original pitch" (time-stretch)
//   - "play this sample at original speed but 1 octave higher" (pitch-shift)
//
// ─── Algorithm ─────────────────────────────────────────────────────────────
//
// We use a 2-step approach for TRUE independent control:
//
//   pitchShift(P) = timeStretch(resample(source, P), 1/P)
//     1. Resample by P: changes pitch by P AND duration by 1/P (coupled)
//     2. Time-stretch by 1/P: restores duration, preserves pitch
//     Net: pitch up by P, duration preserved ✓
//
//   timeStretch(T) = granular(source, 1, T)
//     - Pure granular time-stretch: read at rate 1, place grains at varying hops
//     - Pitch preserved, duration scaled by 1/T ✓
//
// The granular core (granularStretch) handles the time-stretch step. It uses
// overlapping Hann-windowed grains with COLA (Constant Overlap Add) reconstruction.
//
// Quality: this is a BASIC implementation. For studio-quality, use élastique
// (commercial) or Rubber Band (open source, WASM port available). This granular
// approach is good enough for the MVP and works in pure JS.
//
// Known artifacts:
//   - Phase discontinuities at grain boundaries (no phase locking)
//   - For pitched material with strong harmonics, can sound "phasey"
//   - Phase-locked version (PSOLA) requires pitch detection — out of scope

/**
 * Granular time-stretch an AudioBuffer (preserve pitch, change duration).
 *
 * This is the CORE algorithm. It places Hann-windowed grains at output_hop
 * intervals, reading from source at the ORIGINAL rate (pitch preserved).
 * The source position advances at output_hop * tempoRatio per grain, so:
 *   - tempoRatio > 1: source advances faster than output → output shorter
 *   - tempoRatio < 1: source advances slower than output → output longer
 *
 * @param source     The input AudioBuffer (mono or stereo).
 * @param ctx        The AudioContext (used to create the output AudioBuffer).
 * @param tempoRatio Tempo multiplier (1 = original, 2 = 2× faster, 0.5 = 2× slower).
 * @param grainSize  Grain size in samples (default 2048). Larger = smoother
 *                   but more latency. 1024-4096 typical.
 * @returns A NEW AudioBuffer with the duration changed, pitch preserved.
 */
export function granularStretch(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  pitchRatio: number,
  tempoRatio: number,
  grainSize: number = 2048,
): AudioBuffer {
  if (pitchRatio <= 0 || tempoRatio <= 0) {
    throw new Error(`granularStretch: ratios must be > 0 (got pitch=${pitchRatio}, tempo=${tempoRatio})`)
  }
  if (grainSize < 64) {
    throw new Error(`granularStretch: grainSize must be >= 64 (got ${grainSize})`)
  }

  // The 2-step approach: first resample (changes pitch + duration coupled),
  // then time-stretch to restore duration.
  //
  // Step 1: resample by pitchRatio. This is fast (linear interpolation).
  // Result: pitched up/down by P, duration = source_length / P.
  const resampled = resampleBuffer(source, ctx, pitchRatio)

  // Step 2: time-stretch by 1/pitchRatio to restore original duration.
  // After step 1, duration = source_duration / P. We want duration = source_duration / T.
  // So we need to time-stretch by (source_duration / P) / (source_duration / T) = T / P.
  const stretchFactor = tempoRatio / pitchRatio
  return granularTimeStretch(resampled, ctx, stretchFactor, grainSize)
}

/**
 * Pure granular time-stretch (preserve pitch, change duration).
 * Internal helper — used by granularStretch after resampling.
 *
 * @param source     The input AudioBuffer.
 * @param ctx        The AudioContext.
 * @param tempoRatio Tempo multiplier (2 = 2× faster output).
 * @param grainSize  Grain size in samples.
 */
function granularTimeStretch(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  tempoRatio: number,
  grainSize: number,
): AudioBuffer {
  const numChannels = source.numberOfChannels
  const sourceRate = source.sampleRate
  const sourceLength = source.length
  const outputLength = Math.max(1, Math.floor(sourceLength / tempoRatio))
  const output = ctx.createBuffer(numChannels, outputLength, sourceRate)

  // Hann window (COLA-compliant for 50% overlap).
  const window = new Float32Array(grainSize)
  for (let i = 0; i < grainSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grainSize - 1))
  }

  // Output hop = grainSize / 2 (50% overlap → COLA in output).
  const outputHop = Math.floor(grainSize / 2)
  // Source hop = outputHop * tempoRatio (so source advances at rate T per output).
  const sourceHop = outputHop * tempoRatio

  for (let ch = 0; ch < numChannels; ch++) {
    const srcData = source.getChannelData(ch)
    const outData = output.getChannelData(ch)
    outData.fill(0)

    let grainIdx = 0
    let outPos = 0
    while (outPos < outputLength) {
      const srcPos = grainIdx * sourceHop
      // Within-grain read rate = 1 (preserve pitch within grain).
      for (let i = 0; i < grainSize; i++) {
        const outIdx = outPos + i
        if (outIdx >= outputLength) break
        // Linear interpolation for source position.
        const srcSamplePos = srcPos + i
        const srcIdxInt = Math.floor(srcSamplePos)
        const frac = srcSamplePos - srcIdxInt
        const s0 = srcIdxInt >= 0 && srcIdxInt < sourceLength ? srcData[srcIdxInt] : 0
        const s1 = srcIdxInt + 1 >= 0 && srcIdxInt + 1 < sourceLength ? srcData[srcIdxInt + 1] : 0
        const sample = s0 * (1 - frac) + s1 * frac
        outData[outIdx] += sample * window[i]
      }
      outPos += outputHop
      grainIdx++
    }
  }
  return output
}

/**
 * Resample an AudioBuffer by a ratio (changes BOTH pitch and duration).
 * This is the "playbackRate" equivalent — produces the same result as
 * playing at that rate, but as a NEW offline-rendered buffer.
 *
 * @param source  The input AudioBuffer.
 * @param ctx     The AudioContext.
 * @param ratio   Resample ratio (2 = 2× faster + 1 octave up).
 * @returns A NEW AudioBuffer with length = source.length / ratio.
 */
function resampleBuffer(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  ratio: number,
): AudioBuffer {
  const numChannels = source.numberOfChannels
  const sourceRate = source.sampleRate
  const sourceLength = source.length
  const outputLength = Math.max(1, Math.floor(sourceLength / ratio))
  const output = ctx.createBuffer(numChannels, outputLength, sourceRate)

  for (let ch = 0; ch < numChannels; ch++) {
    const srcData = source.getChannelData(ch)
    const outData = output.getChannelData(ch)
    for (let i = 0; i < outputLength; i++) {
      // Source position for this output sample.
      const srcPos = i * ratio
      const srcIdxInt = Math.floor(srcPos)
      const frac = srcPos - srcIdxInt
      const s0 = srcIdxInt >= 0 && srcIdxInt < sourceLength ? srcData[srcIdxInt] : 0
      const s1 = srcIdxInt + 1 >= 0 && srcIdxInt + 1 < sourceLength ? srcData[srcIdxInt + 1] : 0
      outData[i] = s0 * (1 - frac) + s1 * frac
    }
  }
  return output
}

/**
 * Pitch-shift only (preserve duration). Convenience wrapper.
 *
 * Implementation: resample by P (changes pitch + duration) then time-stretch
 * by P (restores duration, preserves pitch). Net: pitch up by P, same duration.
 *
 * @param source     The input AudioBuffer.
 * @param ctx        The AudioContext.
 * @param pitchRatio Pitch multiplier (2 = +1 octave, 0.5 = -1 octave).
 * @returns A NEW AudioBuffer with the pitch shifted, same duration.
 */
export function pitchShift(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  pitchRatio: number,
): AudioBuffer {
  // tempoRatio=1 → output length = source_length (preserved).
  return granularStretch(source, ctx, pitchRatio, 1, 2048)
}

/**
 * Time-stretch only (preserve pitch). Convenience wrapper.
 *
 * @param source     The input AudioBuffer.
 * @param ctx        The AudioContext.
 * @param tempoRatio Tempo multiplier (2 = 2× faster, 0.5 = 2× slower).
 * @returns A NEW AudioBuffer with the duration changed, same pitch.
 */
export function timeStretch(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  tempoRatio: number,
): AudioBuffer {
  // pitchRatio=1 → no resample step, just granular time-stretch.
  return granularStretch(source, ctx, 1, tempoRatio, 2048)
}

/**
 * Combined pitch + tempo shift.
 *
 * @param source     The input AudioBuffer.
 * @param ctx        The AudioContext.
 * @param pitchRatio Pitch multiplier.
 * @param tempoRatio Tempo multiplier.
 * @returns A NEW AudioBuffer with both pitch and tempo modified.
 */
export function pitchAndTempoShift(
  source: AudioBuffer,
  ctx: BaseAudioContext,
  pitchRatio: number,
  tempoRatio: number,
): AudioBuffer {
  return granularStretch(source, ctx, pitchRatio, tempoRatio, 2048)
}
