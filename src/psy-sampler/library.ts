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
   * - Skips entries that fail to fetch/decode (graceful).
   * - Skips entries with commercialUse=false (already filtered by validateManifest).
   * - Returns a summary of loaded / skipped / total.
   */
  async load(manifestUrl: string): Promise<LibraryLoadResult> {
    const manifest: SampleManifest = await loadManifest(manifestUrl)
    const total = manifest.samples.length
    let loaded = 0
    let skipped = 0
    for (const entry of manifest.samples) {
      const asset = await this.loader.load(entry)
      if (asset === null) {
        skipped += 1
        continue
      }
      this.add(asset, entry)
      loaded += 1
    }
    return { loaded, skipped, total }
  }

  /** Add an already-loaded asset to the library (used by tests). */
  add(asset: SampleAsset, _entry: SampleManifestEntry): void {
    this.samples.set(asset.metadata.id, asset)
    const cat = asset.metadata.category
    if (!this.byCategory.has(cat)) this.byCategory.set(cat, [])
    this.byCategory.get(cat)!.push(asset.metadata.id)
    if (!this.subcategories.has(cat)) this.subcategories.set(cat, new Set())
    this.subcategories.get(cat)!.add(asset.metadata.subcategory)
  }

  get(id: SampleId): SampleAsset | undefined {
    return this.samples.get(id)
  }

  /** List sampleIds matching the query, in manifest order. */
  query(q: LibraryQuery): SampleId[] {
    if (q.category) {
      const ids = this.byCategory.get(q.category) ?? []
      if (q.subcategory) {
        return ids.filter((id) => this.samples.get(id)?.metadata.subcategory === q.subcategory)
      }
      return ids
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
