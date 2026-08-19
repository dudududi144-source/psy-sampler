// PSY Sampler — sample loader.
// fetch + decodeAudioData + cheap feature extraction.
// Adapted from psy4 SampleBank (REUSE pattern), with:
//   - parameterized URL root (no hardcoded /samples/)
//   - cheap feature extraction (no DFT for MVP)
//   - graceful failure (missing file → warning, not crash)

import type { SampleAsset, SampleFeatures, SampleManifestEntry } from './types'
import { provenanceFromEntry } from './provenance'

export class SampleLoader {
  constructor(private readonly audioContext: AudioContext) {}

  /**
   * Load + decode a single sample.
   * Returns null if the file cannot be fetched or decoded (graceful failure).
   */
  async load(entry: SampleManifestEntry): Promise<SampleAsset | null> {
    let response: Response
    try {
      // Build URL relative to current page, so it works with basePath (GitHub Pages)
      // and standalone dev mode (localhost:3000/).
      const url = entry.file.startsWith('/')
        ? entry.file  // absolute path (for GitHub Pages with basePath)
        : entry.file  // relative path (resolves from current page URL)
      response = await fetch(url)
    } catch (err) {
      console.warn(`[psy-sampler] Network error fetching "${entry.file}":`, err)
      return null
    }
    if (!response.ok) {
      console.warn(
        `[psy-sampler] Failed to fetch "${entry.file}": ${response.status} ${response.statusText}`
      )
      return null
    }
    let arrayBuffer: ArrayBuffer
    try {
      arrayBuffer = await response.arrayBuffer()
    } catch (err) {
      console.warn(`[psy-sampler] Failed to read body of "${entry.file}":`, err)
      return null
    }
    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
    } catch (err) {
      console.warn(`[psy-sampler] Failed to decode "${entry.file}":`, err)
      return null
    }
    const monoData = this.toMono(audioBuffer)
    const features = this.extractFeatures(audioBuffer, monoData)
    return {
      metadata: {
        id: entry.id,
        file: entry.file,
        category: entry.category,
        subcategory: entry.subcategory,
        // FIX: use provenanceFromEntry (was inlined — DRY violation).
        provenance: provenanceFromEntry(entry),
        character: {
          character: entry.character,
          genreFit: entry.genreFit,
          bpmRange: entry.bpmRange,
          rootNote: entry.rootNote,
        },
        duration: features.duration,
        sampleRate: features.sampleRate,
        channels: features.channels,
        // Velocity layer range (optional — enables multi-velocity sample sets).
        velocityRange: entry.velocityRange,
      },
      audioBuffer,
      monoData,
      features,
    }
  }

  /** Downmix stereo → mono. Mono passes through. */
  private toMono(buffer: AudioBuffer): Float32Array {
    const ch = buffer.numberOfChannels
    const len = buffer.length
    if (ch === 1) {
      // Copy so the caller can transfer ownership without affecting the AudioBuffer.
      return buffer.getChannelData(0).slice()
    }
    const mono = new Float32Array(len)
    for (let c = 0; c < ch; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < len; i++) {
        mono[i] += data[i] / ch
      }
    }
    return mono
  }

  /**
   * Cheap feature extraction: peak, rms, duration, sampleRate, channels.
   * No DFT / spectral centroid for MVP (psy4's O(N²) DFT was a load-time bottleneck).
   * Future: add FFT-based centroid + fundamental if selection needs it.
   */
  private extractFeatures(buffer: AudioBuffer, mono: Float32Array): SampleFeatures {
    let peak = 0
    let sumSq = 0
    for (let i = 0; i < mono.length; i++) {
      const s = Math.abs(mono[i])
      if (s > peak) peak = s
      sumSq += mono[i] * mono[i]
    }
    const rms = mono.length > 0 ? Math.sqrt(sumSq / mono.length) : 0
    return {
      peak,
      rms,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    }
  }
}
