// PSY Sampler — manifest schema + loading.

import type { SampleManifest, SampleManifestEntry } from './types'
import { validateProvenance, isCommerciallyUsable } from './provenance'

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/** Fetch and parse a manifest.json from a URL. */
export async function loadManifest(url: string): Promise<SampleManifest> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new ManifestError(`Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`)
  }
  const data = await response.json() as unknown
  return validateManifest(data)
}

/**
 * Validate a parsed manifest object.
 * - Checks top-level shape (version, samples array).
 * - Validates provenance on every entry.
 * - Returns the manifest if all entries pass.
 * - Throws ManifestError if the shape is wrong.
 * - Throws ProvenanceError (from validateProvenance) if any entry lacks provenance.
 */
export function validateManifest(data: unknown): SampleManifest {
  if (typeof data !== 'object' || data === null) {
    throw new ManifestError('Manifest root must be an object')
  }
  const obj = data as Record<string, unknown>
  if (typeof obj.version !== 'string') {
    throw new ManifestError('Manifest missing "version" string')
  }
  if (!Array.isArray(obj.samples)) {
    throw new ManifestError('Manifest missing "samples" array')
  }
  const entries = obj.samples as unknown[]
  const validatedEntries: SampleManifestEntry[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const validated = validateEntry(entry, i)
    // Skip non-commercial samples — the sampler refuses to load them.
    if (!isCommerciallyUsable(validated)) {
      console.warn(
        `[psy-sampler] Manifest entry "${validated.id}" has commercialUse=false — skipping load.`
      )
      continue
    }
    validateProvenance(validated)
    validatedEntries.push(validated)
  }
  return {
    version: obj.version,
    description: typeof obj.description === 'string' ? obj.description : '',
    generated: typeof obj.generated === 'string' ? obj.generated : '',
    licensePolicy:
      typeof obj.licensePolicy === 'string'
        ? obj.licensePolicy
        : 'NEVER assume a random downloaded sample is commercially usable. All imported samples MUST have explicit license metadata.',
    samples: validatedEntries,
  }
}

function validateEntry(entry: unknown, index: number): SampleManifestEntry {
  if (typeof entry !== 'object' || entry === null) {
    throw new ManifestError(`Manifest entry ${index} must be an object`)
  }
  const e = entry as Record<string, unknown>
  const required: Array<keyof SampleManifestEntry> = [
    'id', 'file', 'category', 'subcategory',
    'source', 'author', 'license', 'licenseUrl', 'commercialUse',
    'attribution', 'dateAcquired', 'usageRestrictions',
    'character', 'genreFit', 'bpmRange', 'rootNote',
  ]
  for (const key of required) {
    if (!(key in e)) {
      throw new ManifestError(`Manifest entry ${index} ("${e.id ?? '?'}") missing field: ${key}`)
    }
  }
  return e as unknown as SampleManifestEntry
}
