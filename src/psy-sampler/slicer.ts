/**
 * Sample Slicer — transient detection + AudioBuffer splitting.
 *
 * A user drops a drum loop (or any audio with sharp onsets) and the slicer
 * divides it into individual hits using spectral-flux onset detection.
 *
 * Algorithm (spectral flux, simplified):
 *   1. Downmix to mono.
 *   2. STFT with 1024-sample Hann window, 50% overlap (hop=512).
 *   3. For each frame, compute magnitude spectrum.
 *   4. Spectral flux = sum of positive differences between consecutive
 *      frames' magnitudes (only positive parts count — onsets, not offsets).
 *   5. Normalise flux by its local median (adaptive threshold).
 *   6. Peak-pick: a frame is an onset if it is a local maximum in a +-5 frame
 *      window AND exceeds `threshold * localMedian`.
 *   7. Enforce min-spacing (default 30 ms) so a single hit doesn't trigger
 *      multiple onsets.
 *
 * Output: ordered list of onset times in seconds.
 *
 * The slicing step (`sliceAudioBuffer`) returns one AudioBuffer per onset,
 * spanning [onset[i], onset[i+1]). The last slice runs to the end of the
 * source buffer. Slices are shortened to a maximum of 2.0 s so a tail doesn't
 * bleed into the next pad slot.
 *
 * This module is pure (no DOM, no AudioContext). It takes a Float32Array mono
 * signal and a sample rate. The caller is responsible for decoding the WAV.
 *
 * @module psy-sampler/slicer
 */

/** A detected onset (seconds from start of source). */
export interface Onset {
  /** Onset time in seconds. */
  time: number
  /** Frame index in the STFT. */
  frame: number
  /** Spectral-flux value at the peak (post-normalisation). */
  strength: number
}

export interface DetectOnsetsOptions {
  /** FFT size (must be a power of 2, 256..8192). Default 1024. */
  fftSize?: number
  /** Hop size in samples (default fftSize/2). */
  hopSize?: number
  /** Sensitivity 0..1. Higher = more onsets. Default 0.5. */
  sensitivity?: number
  /** Minimum spacing between onsets, in seconds. Default 0.030 (30 ms). */
  minSpacing?: number
}

/**
 * Hann window of length N. In-place multiply is the caller's responsibility.
 */
function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  }
  return w
}

/**
 * Compute the magnitude spectrum of one frame via naive DFT.
 *
 * We use naive DFT (O(N^2)) instead of FFT for portability — the slicer is
 * only invoked at import time, not at audio rate. For fftSize=1024 this is
 * ~1 M ops per frame, which is fine for a one-shot import of a 4 s loop
 * (~86 frames). Total: ~86 M ops — runs in <100 ms.
 *
 * Returns only the first N/2+1 bins (real spectrum, symmetric).
 */
function magnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length
  const half = n / 2 + 1
  const mag = new Float32Array(half)
  for (let k = 0; k < half; k++) {
    let re = 0
    let im = 0
    const w = (2 * Math.PI * k) / n
    for (let t = 0; t < n; t++) {
      re += frame[t] * Math.cos(w * t)
      im -= frame[t] * Math.sin(w * t)
    }
    mag[k] = Math.sqrt(re * re + im * im)
  }
  return mag
}

/**
 * Detect onsets in a mono signal using spectral flux.
 *
 * @param mono   Mono signal (Float32Array, -1..1).
 * @param sampleRate Sample rate in Hz.
 * @param opts   Detection options.
 * @returns Array of onsets, ordered by time.
 */
export function detectOnsets(
  mono: Float32Array,
  sampleRate: number,
  opts: DetectOnsetsOptions = {},
): Onset[] {
  const fftSize = opts.fftSize ?? 1024
  const hopSize = opts.hopSize ?? fftSize / 2
  const sensitivity = opts.sensitivity ?? 0.5
  const minSpacing = opts.minSpacing ?? 0.03

  if (mono.length < fftSize) {
    // Too short for STFT — emit a single onset at zero.
    return [{ time: 0, frame: 0, strength: 1 }]
  }

  const window = hannWindow(fftSize)
  const frameCount = Math.floor((mono.length - fftSize) / hopSize) + 1

  // 1. Compute magnitude spectra for each frame.
  const spectra: Float32Array[] = new Array(frameCount)
  const frame = new Float32Array(fftSize)
  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize
    for (let i = 0; i < fftSize; i++) {
      frame[i] = mono[start + i] * window[i]
    }
    spectra[f] = magnitudeSpectrum(frame)
  }

  // 2. Spectral flux = sum of positive magnitude differences.
  const flux = new Float32Array(frameCount)
  const half = fftSize / 2 + 1
  for (let f = 1; f < frameCount; f++) {
    let s = 0
    const cur = spectra[f]
    const prev = spectra[f - 1]
    for (let k = 0; k < half; k++) {
      const d = cur[k] - prev[k]
      if (d > 0) s += d
    }
    flux[f] = s
  }

  // 3. Normalise by local median over a 20-frame window (~120 ms).
  //    This adapts the threshold to the loop's overall energy.
  const norm = new Float32Array(frameCount)
  const winSize = 20
  for (let f = 0; f < frameCount; f++) {
    let lo = Math.max(0, f - winSize)
    let hi = Math.min(frameCount - 1, f + winSize)
    // Compute median of flux[lo..hi].
    const slice: number[] = []
    for (let i = lo; i <= hi; i++) slice.push(flux[i])
    slice.sort((a, b) => a - b)
    const median = slice[Math.floor(slice.length / 2)] || 1e-9
    norm[f] = flux[f] / (median + 1e-9)
  }

  // 4. Peak-pick: local max in +-5 frame window AND above threshold.
  const threshold = 1.0 + (1.0 - sensitivity) * 2.0 // sensitivity=1 -> 1.0, sensitivity=0 -> 3.0
  const peakWindow = 5
  const onsets: Onset[] = []
  let lastOnsetTime = -Infinity
  for (let f = peakWindow; f < frameCount - peakWindow; f++) {
    if (norm[f] < threshold) continue
    let isPeak = true
    for (let k = f - peakWindow; k <= f + peakWindow; k++) {
      if (k === f) continue
      if (norm[k] > norm[f]) {
        isPeak = false
        break
      }
    }
    if (!isPeak) continue
    const t = (f * hopSize) / sampleRate
    if (t - lastOnsetTime < minSpacing) continue
    onsets.push({ time: t, frame: f, strength: norm[f] })
    lastOnsetTime = t
  }

  // 5. Guarantee at least one onset at t=0 (the very first hit).
  if (onsets.length === 0 || onsets[0].time > 0.02) {
    onsets.unshift({ time: 0, frame: 0, strength: 1 })
  }

  return onsets
}

/**
 * Estimate BPM from onset spacing. Heuristic: compute median inter-onset
 * interval (more robust than mean against outliers like a missing hit),
 * then convert to BPM assuming the median interval is a 16th note.
 *
 * Returns a result with the detected BPM + confidence 0..1 (higher = more
 * uniform spacing → more reliable estimate).
 *
 * If we have fewer than 4 onsets, returns 0 BPM + confidence 0 (too few
 * to estimate a tempo).
 */
export interface BpmEstimate {
  /** Estimated tempo in BPM. 0 if unknown. */
  bpm: number
  /** Confidence 0..1. Higher = more uniform spacing. */
  confidence: number
  /** The median inter-onset interval, in seconds. */
  medianInterval: number
  /** Best-guess note value: '16th' | '8th' | '4th'. */
  noteValue: '16th' | '8th' | '4th'
}

export function estimateBpmFromOnsets(onsets: Onset[]): BpmEstimate {
  if (onsets.length < 4) {
    return { bpm: 0, confidence: 0, medianInterval: 0, noteValue: '16th' }
  }

  // Compute inter-onset intervals.
  const intervals: number[] = []
  for (let i = 1; i < onsets.length; i++) {
    intervals.push(onsets[i].time - onsets[i - 1].time)
  }
  intervals.sort((a, b) => a - b)

  // Median (robust to outliers).
  const median = intervals[Math.floor(intervals.length / 2)]
  if (median <= 0) {
    return { bpm: 0, confidence: 0, medianInterval: 0, noteValue: '16th' }
  }

  // Confidence: low standard deviation relative to mean → high confidence.
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
  const variance = intervals.reduce((acc, x) => acc + (x - mean) ** 2, 0) / intervals.length
  const stddev = Math.sqrt(variance)
  const cv = mean > 0 ? stddev / mean : 1
  const confidence = Math.max(0, 1 - cv * 2)

  // Try all three note-value interpretations and pick the one whose BPM
  // falls in the most musically-common range (70-180 BPM).
  // This is the ROOT FIX for the off-by-2 bug: previously the algorithm
  // greedily chose 16th notes when the result was >= 60, but a 120 BPM
  // 4-on-the-floor loop has hits every 0.25s (8th notes at 120 BPM, OR
  // 16th notes at 60 BPM). The previous algorithm returned 60 BPM (wrong);
  // the new algorithm considers all interpretations and picks the one in
  // the 70-180 BPM sweet spot.
  const candidates: Array<{ bpm: number; noteValue: '16th' | '8th' | '4th' }> = [
    { bpm: 15 / median, noteValue: '16th' }, // 16th notes
    { bpm: 30 / median, noteValue: '8th' },  // 8th notes
    { bpm: 60 / median, noteValue: '4th' },   // 4th notes
  ]

  // Filter to "musically reasonable" BPM range (70-180).
  // Psytrance is 140-150 BPM, techno 120-135, house 115-130, breakbeat 130-140.
  // 70-180 covers all common electronic genres.
  const MUSICAL_MIN = 70
  const MUSICAL_MAX = 180
  const inRange = candidates.filter(c => c.bpm >= MUSICAL_MIN && c.bpm <= MUSICAL_MAX)

  let chosen: { bpm: number; noteValue: '16th' | '8th' | '4th' }
  if (inRange.length > 0) {
    // Pick the candidate closest to 120 BPM (the modal tempo of popular music).
    // This breaks ties when multiple interpretations fall in range.
    chosen = inRange.reduce((best, c) =>
      Math.abs(c.bpm - 120) < Math.abs(best.bpm - 120) ? c : best,
    )
  } else {
    // Fallback: no candidate in range — use 16th notes (most common for loops).
    chosen = candidates[0]
  }

  let bpm = chosen.bpm
  // Snap to nearest integer BPM if confidence is high.
  if (confidence > 0.5) {
    bpm = Math.round(bpm)
  }

  return { bpm, confidence, medianInterval: median, noteValue: chosen.noteValue }
}

/**
 * Slice an AudioBuffer at the given onset times.
 *
 * Each slice spans [onset[i], onset[i+1]). The last slice runs to the end of
 * the source buffer. Slices are truncated to `maxSliceSec` (default 2.0 s) so
 * a long tail doesn't dominate the pad slot.
 *
 * The output AudioBuffers inherit the source's sample rate and channel count.
 *
 * @param source    The decoded AudioBuffer to slice.
 * @param onsetTimes Ordered onset times in seconds. Must start at 0 (we
 *                   prepend 0 if missing) and be strictly increasing.
 * @param maxSliceSec Maximum length of a single slice, in seconds.
 */
export function sliceAudioBuffer(
  source: AudioBuffer,
  onsetTimes: number[],
  maxSliceSec = 2.0,
): AudioBuffer[] {
  if (onsetTimes.length === 0) {
    return [source]
  }
  // Ensure starts at 0 and is strictly increasing.
  const times = [...onsetTimes]
  if (times[0] > 0.005) times.unshift(0)
  const sr = source.sampleRate
  const channels = source.numberOfChannels
  const totalSamples = source.length
  const maxSliceSamples = Math.floor(maxSliceSec * sr)

  const slices: AudioBuffer[] = []
  for (let i = 0; i < times.length; i++) {
    const startSample = Math.floor(times[i] * sr)
    const endSec = i + 1 < times.length ? times[i + 1] : source.duration
    let endSample = Math.floor(endSec * sr)
    if (endSample - startSample > maxSliceSamples) {
      endSample = startSample + maxSliceSamples
    }
    if (endSample <= startSample) continue
    if (endSample > totalSamples) endSample = totalSamples
    if (endSample <= startSample) continue

    const len = endSample - startSample
    // Use the source's AudioContext if available; otherwise the constructor
    // works on a fresh buffer. We need a host AudioContext for the standard
    // path — see createSliceBuffer().
    const buf = createSliceBuffer(source, len, channels)
    for (let c = 0; c < channels; c++) {
      const srcData = source.getChannelData(c)
      const dst = buf.getChannelData(c)
      dst.set(srcData.subarray(startSample, endSample))
    }
    slices.push(buf)
  }
  return slices
}

/**
 * Create an empty AudioBuffer with the same sample rate + channel count as
 * the source. We piggy-back on the source AudioBuffer's underlying
 * AudioContext when one is reachable; otherwise we use the global
 * OfflineAudioContext fallback (works in modern browsers).
 */
function createSliceBuffer(
  source: AudioBuffer,
  length: number,
  channels: number,
): AudioBuffer {
  const sr = source.sampleRate
  // Try the standard path: source might be an OfflineAudioBuffer which keeps
  // a back-reference. Newer browsers expose `AudioBuffer` directly via the
  // AudioContext constructor — we use OfflineAudioContext as a portable host.
  try {
    const host = new OfflineAudioContext(channels, length, sr)
    return host.createBuffer(channels, length, sr)
  } catch {
    // Last-resort fallback: hand-build a buffer-shaped object that satisfies
    // the audio-graph's playback path. We populate getChannelData lazily.
    const data: Float32Array[] = []
    for (let c = 0; c < channels; c++) data.push(new Float32Array(length))
    const fakeBuf = {
      length,
      duration: length / sr,
      sampleRate: sr,
      numberOfChannels: channels,
      getChannelData: (ch: number) => data[ch] ?? data[0],
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer
    return fakeBuf
  }
}

/**
 * Downmix an AudioBuffer to mono (Float32Array). Same algorithm as
 * SampleLibrary.toMono — averaged across channels.
 */
export function toMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels
  if (ch === 1) return buffer.getChannelData(0).slice()
  const len = buffer.length
  const out = new Float32Array(len)
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i]
  }
  const inv = 1 / ch
  for (let i = 0; i < len; i++) out[i] *= inv
  return out
}
