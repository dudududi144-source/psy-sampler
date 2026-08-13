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

  get(id: SampleId): SampleAsset | undefined {
    return this.samples.get(id)
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
}
