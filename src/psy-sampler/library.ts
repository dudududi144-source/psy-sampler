// PSY Sampler — in-memory sample library.
// Map-backed store. Loaded once at device init, queried per NoteEvent.

import type { SampleAsset, SampleId, SampleCategory, SampleBank } from './types'
import type { SampleManifest, SampleManifestEntry } from './types'
import { loadManifest } from './manifest'
import { SampleLoader } from './loader'

export interface LibraryQuery {
  category?: SampleCategory
  subcategory?: SampleBank
}

export interface LibraryLoadResult {
  loaded: number
  skipped: number
  total: number
}

export class SampleLibrary {
  private readonly samples = new Map<SampleId, SampleAsset>()
  /** index: category → array of sampleIds (in manifest order). */
  private readonly byCategory = new Map<SampleCategory, SampleId[]>()
  /** index: category → Set of subcategories present. */
  private readonly subcategories = new Map<SampleCategory, Set<SampleBank>>()

  constructor(private readonly loader: SampleLoader) {}

  /**
   * Load all samples from a manifest URL.
   * - Parallel loading with concurrency limit (6 at a time).
   * - Skips entries that fail to fetch/decode (graceful).
   * - Skips entries with commercialUse=false (already filtered by validateManifest).
   * - onProgress callback for loading UI.
   * - Returns a summary of loaded / skipped / total.
   */
  async load(
    manifestUrl: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<LibraryLoadResult> {
    const manifest: SampleManifest = await loadManifest(manifestUrl)
    const total = manifest.samples.length
    let loaded = 0
    let skipped = 0
    let completed = 0

    // Parallel loading with concurrency limit of 6.
    const CONCURRENCY = 6
    const entries = manifest.samples
    let nextIdx = 0

    const loadNext = async (): Promise<void> => {
      while (nextIdx < entries.length) {
        const idx = nextIdx++
        const entry = entries[idx]!
        const asset = await this.loader.load(entry)
        if (asset === null) {
          skipped += 1
        } else {
          this.add(asset, entry)
          loaded += 1
        }
        completed += 1
        onProgress?.(completed, total)
      }
    }

    // Start CONCURRENCY workers.
    const workers: Promise<void>[] = []
    for (let i = 0; i < Math.min(CONCURRENCY, entries.length); i++) {
      workers.push(loadNext())
    }
    await Promise.all(workers)

    return { loaded, skipped, total }
  }

  /** Add an already-loaded asset to the library (used by tests). */
  add(asset: SampleAsset, _entry: SampleManifestEntry): void {
    // FIX: dedupe by id — if the id already exists, remove it from byCategory first.
    const id = asset.metadata.id
    const cat = asset.metadata.category
    if (this.samples.has(id)) {
      // Remove from byCategory index to avoid duplicates.
      const existingCat = this.samples.get(id)!.metadata.category
      const arr = this.byCategory.get(existingCat)
      if (arr) {
        const idx = arr.indexOf(id)
        if (idx >= 0) arr.splice(idx, 1)
      }
    }
    this.samples.set(id, asset)
    if (!this.byCategory.has(cat)) this.byCategory.set(cat, [])
    this.byCategory.get(cat)!.push(id)
    if (!this.subcategories.has(cat)) this.subcategories.set(cat, new Set())
    this.subcategories.get(cat)!.add(asset.metadata.subcategory)
  }

  /**
   * C2 (ROADMAP-TO-100): Import a user-supplied AudioBuffer into the library
   * at runtime. This is the runtime equivalent of the loader path — the user
   * drags a WAV into the UI, we decode it, compute features, and the user MUST
   * assert provenance (license + commercial-use flag) before it enters the
   * audio graph. This enforces the same provenance policy as the manifest path:
   * no sample without explicit license metadata ever reaches the audio output.
   *
   * @param id Unique sample id (caller-chosen, e.g. "user-import-1").
   * @param audioBuffer Decoded AudioBuffer (from decodeAudioData).
   * @param opts Role, subcategory, provenance fields, rootNote, velocityRange.
   * @returns true if added, false if provenance validation failed.
   */
  addFromBuffer(
    id: SampleId,
    audioBuffer: AudioBuffer,
    opts: {
      category: SampleCategory
      subcategory: SampleBank
      provenance: {
        source: string
        author: string
        license: string
        licenseUrl: string | null
        commercialUse: boolean
        attribution: string | null
        usageRestrictions: string
        /** ISO date the sample was acquired. Defaults to today. */
        dateAcquired?: string
      }
      rootNote?: number
      velocityRange?: [number, number]
    }
  ): boolean {
    // Enforce provenance — refuse samples without explicit license metadata.
    // This is the SAME policy as the manifest loader: no unprovenanced sample
    // ever enters the audio graph, regardless of how it arrived.
    if (!opts.provenance.commercialUse) {
      console.warn(`[psy-sampler] Import refused: "${id}" marked non-commercial.`)
      return false
    }
    if (!opts.provenance.license || !opts.provenance.source) {
      console.warn(`[psy-sampler] Import refused: "${id}" missing license/source.`)
      return false
    }

    // Compute features (same logic as SampleLoader.extractFeatures).
    const monoData = this.toMono(audioBuffer)
    let peak = 0
    let sumSq = 0
    for (let i = 0; i < monoData.length; i++) {
      const s = Math.abs(monoData[i])
      if (s > peak) peak = s
      sumSq += monoData[i] * monoData[i]
    }
    const rms = monoData.length > 0 ? Math.sqrt(sumSq / monoData.length) : 0

    const asset: SampleAsset = {
      metadata: {
        id,
        file: `import:${id}`, // marker — not a URL, this sample came from a buffer
        category: opts.category,
        subcategory: opts.subcategory,
        provenance: {
          ...opts.provenance,
          dateAcquired: opts.provenance.dateAcquired ?? new Date().toISOString().slice(0, 10),
        },
        character: {
          character: ['user-import'],
          genreFit: [],
          bpmRange: [60, 200],
          rootNote: opts.rootNote ?? 60,
        },
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
        velocityRange: opts.velocityRange,
      },
      audioBuffer,
      monoData,
      features: {
        peak,
        rms,
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
      },
    }

    // Reuse add() — it handles dedup + indexing.
    this.add(asset, {} as SampleManifestEntry)
    return true
  }

  get(id: SampleId): SampleAsset | undefined {
    return this.samples.get(id)
  }

  /**
   * Remove a sample from the library by ID. Cleans up the byCategory +
   * subcategories indexes. Returns true if removed, false if not found.
   * Used by the UI to let users delete imported samples they no longer want.
   */
  remove(id: SampleId): boolean {
    const asset = this.samples.get(id)
    if (!asset) return false
    const cat = asset.metadata.category
    // Remove from byCategory index.
    const arr = this.byCategory.get(cat)
    if (arr) {
      const idx = arr.indexOf(id)
      if (idx >= 0) arr.splice(idx, 1)
      if (arr.length === 0) this.byCategory.delete(cat)
    }
    // Remove from subcategories index (rebuild if needed).
    const subcatSet = this.subcategories.get(cat)
    if (subcatSet) {
      // Check if any other sample in this category has the same subcategory.
      const stillExists = Array.from(this.samples.values()).some(
        (s) => s.metadata.category === cat && s.metadata.subcategory === asset.metadata.subcategory && s.metadata.id !== id
      )
      if (!stillExists) subcatSet.delete(asset.metadata.subcategory)
      if (subcatSet.size === 0) this.subcategories.delete(cat)
    }
    // Remove from the main map.
    this.samples.delete(id)
    return true
  }

  /** List sampleIds matching the query, in manifest order. Returns a copy. */
  query(q: LibraryQuery): SampleId[] {
    if (q.category) {
      const ids = this.byCategory.get(q.category) ?? []
      if (q.subcategory) {
        return ids.filter((id) => this.samples.get(id)?.metadata.subcategory === q.subcategory)
      }
      // FIX: return a copy so callers can't mutate the internal index.
      return [...ids]
    }
    return Array.from(this.samples.keys())
  }

  /** List subcategories present for a category. */
  subcategoriesFor(category: SampleCategory): SampleBank[] {
    return Array.from(this.subcategories.get(category) ?? [])
  }

  /** All loaded samples (for UI / debugging). */
  list(): SampleAsset[] {
    return Array.from(this.samples.values())
  }

  get size(): number {
    return this.samples.size
  }

  /** True if at least one sample is loaded. */
  get ready(): boolean {
    return this.samples.size > 0
  }

  /**
   * Downmix stereo → mono. Mono passes through (copied so caller can transfer
   * ownership without affecting the AudioBuffer). Same logic as SampleLoader.
   */
  private toMono(buffer: AudioBuffer): Float32Array {
    const ch = buffer.numberOfChannels
    const len = buffer.length
    if (ch === 1) {
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
}
