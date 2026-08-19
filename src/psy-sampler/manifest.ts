// PSY Sampler — manifest schema + loading.
//
// Enforces two policies:
//   1. License: commercialUse must be true (else sample is skipped).
//   2. Verification: status must be VERIFIED or PROCEDURAL (else sample is skipped).
//
// UNKNOWN and QUARANTINED samples are NEVER loaded at runtime — they may be
// listed in the manifest for documentation purposes, but the loader refuses them.

import type { SampleManifest, SampleManifestEntry, SampleVerification } from './types'
import { validateProvenance, isCommerciallyUsable } from './provenance'

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

const VALID_VERIFICATIONS: SampleVerification[] = ['VERIFIED', 'PROCEDURAL', 'UNKNOWN', 'QUARANTINED']
const LOADABLE_VERIFICATIONS: SampleVerification[] = ['VERIFIED', 'PROCEDURAL']

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
 * - Skips entries with commercialUse=false (license policy).
 * - Skips entries with verification=UNKNOWN or QUARANTINED (provenance policy).
 * - Returns the manifest with ONLY loadable entries.
 * - Throws ManifestError if the shape is wrong.
 * - Throws ProvenanceError if any loadable entry lacks provenance.
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

    // Policy 1: refuse non-commercial samples.
    if (!isCommerciallyUsable(validated)) {
      console.warn(
        `[psy-sampler] Manifest entry "${validated.id}" has commercialUse=false — skipping load.`
      )
      continue
    }

    // Policy 2: refuse UNKNOWN / QUARANTINED samples.
    if (!LOADABLE_VERIFICATIONS.includes(validated.verification)) {
      console.warn(
        `[psy-sampler] Manifest entry "${validated.id}" has verification=${validated.verification} — skipping load (only VERIFIED/PROCEDURAL load at runtime).`
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
  const label = `Manifest entry ${index} ("${e.id ?? '?'}")`

  // Check required fields exist.
  const required: Array<keyof SampleManifestEntry> = [
    'id', 'file', 'category', 'subcategory',
    'source', 'author', 'license', 'licenseUrl', 'commercialUse',
    'attribution', 'dateAcquired', 'usageRestrictions',
    'character', 'genreFit', 'bpmRange', 'rootNote', 'verification',
  ]
  for (const key of required) {
    if (!(key in e)) {
      throw new ManifestError(`${label} missing field: ${key}`)
    }
  }

  // FIX: validate field TYPES (not just presence).
  const stringFields: Array<keyof SampleManifestEntry> = [
    'id', 'file', 'category', 'subcategory', 'source', 'author', 'license',
    'dateAcquired', 'usageRestrictions',
  ]
  for (const f of stringFields) {
    if (typeof e[f] !== 'string') {
      throw new ManifestError(`${label} field "${f}" must be string, got ${typeof e[f]}`)
    }
  }
  if (typeof e.licenseUrl !== 'string' && e.licenseUrl !== null) {
    throw new ManifestError(`${label} field "licenseUrl" must be string or null`)
  }
  if (typeof e.attribution !== 'string' && e.attribution !== null) {
    throw new ManifestError(`${label} field "attribution" must be string or null`)
  }
  if (typeof e.commercialUse !== 'boolean') {
    throw new ManifestError(`${label} field "commercialUse" must be boolean, got ${typeof e.commercialUse}`)
  }
  if (typeof e.rootNote !== 'number' || !Number.isFinite(e.rootNote)) {
    throw new ManifestError(`${label} field "rootNote" must be a finite number`)
  }
  if (!Array.isArray(e.character) || !e.character.every((c) => typeof c === 'string')) {
    throw new ManifestError(`${label} field "character" must be string[]`)
  }
  if (!Array.isArray(e.genreFit) || !e.genreFit.every((c) => typeof c === 'string')) {
    throw new ManifestError(`${label} field "genreFit" must be string[]`)
  }
  if (!Array.isArray(e.bpmRange) || e.bpmRange.length !== 2 ||
      typeof e.bpmRange[0] !== 'number' || typeof e.bpmRange[1] !== 'number') {
    throw new ManifestError(`${label} field "bpmRange" must be [number, number]`)
  }

  // Validate verification value.
  const v = e.verification as string
  if (!VALID_VERIFICATIONS.includes(v as SampleVerification)) {
    throw new ManifestError(
      `${label} has invalid verification="${v}" (must be one of ${VALID_VERIFICATIONS.join(', ')})`
    )
  }
  return e as unknown as SampleManifestEntry
}
