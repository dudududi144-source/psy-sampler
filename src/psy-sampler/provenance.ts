// PSY Sampler — provenance validation.
// Enforces the license policy: "NEVER assume a random downloaded sample is
// commercially usable. All imported samples MUST have explicit license metadata."

import type { SampleManifestEntry, SampleProvenance } from './types'

export class ProvenanceError extends Error {
  constructor(message: string, public readonly sampleId?: string) {
    super(message)
    this.name = 'ProvenanceError'
  }
}

/** Convert a manifest entry into a SampleProvenance record. */
export function provenanceFromEntry(entry: SampleManifestEntry): SampleProvenance {
  return {
    source: entry.source,
    author: entry.author,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    commercialUse: entry.commercialUse,
    attribution: entry.attribution,
    dateAcquired: entry.dateAcquired,
    usageRestrictions: entry.usageRestrictions,
  }
}

/**
 * Validate that a manifest entry carries the required provenance fields.
 * Throws ProvenanceError if any required field is missing or empty.
 *
 * Required: source, author, license, commercialUse, dateAcquired, usageRestrictions.
 */
export function validateProvenance(entry: SampleManifestEntry): void {
  const id = entry.id
  if (!entry.source || entry.source.trim() === '') {
    throw new ProvenanceError(`Sample "${id}" missing required field: source`, id)
  }
  if (!entry.author || entry.author.trim() === '') {
    throw new ProvenanceError(`Sample "${id}" missing required field: author`, id)
  }
  if (!entry.license || entry.license.trim() === '') {
    throw new ProvenanceError(`Sample "${id}" missing required field: license`, id)
  }
  if (typeof entry.commercialUse !== 'boolean') {
    throw new ProvenanceError(`Sample "${id}" missing required field: commercialUse (must be boolean)`, id)
  }
  if (!entry.dateAcquired || entry.dateAcquired.trim() === '') {
    throw new ProvenanceError(`Sample "${id}" missing required field: dateAcquired`, id)
  }
  if (typeof entry.usageRestrictions !== 'string') {
    throw new ProvenanceError(`Sample "${id}" missing required field: usageRestrictions`, id)
  }
}

/**
 * Returns true if the sample is cleared for commercial use.
 * The sampler refuses to load samples where this returns false.
 */
export function isCommerciallyUsable(entry: SampleManifestEntry): boolean {
  return entry.commercialUse === true
}
