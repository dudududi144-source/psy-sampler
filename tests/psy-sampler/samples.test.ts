// Manifest + provenance tests.

import { describe, it, expect } from 'bun:test'
import {
  validateManifest,
  validateProvenance,
  ProvenanceError,
  ManifestError,
  isCommerciallyUsable,
} from '../../src/psy-sampler'
import type { SampleManifestEntry } from '../../src/psy-sampler'

function makeValidEntry(overrides: Partial<SampleManifestEntry> = {}): SampleManifestEntry {
  return {
    id: 'test-1',
    file: 'samples/test.wav',
    category: 'kick',
    subcategory: 'test',
    source: 'test source',
    author: 'test author',
    license: 'test license',
    licenseUrl: null,
    commercialUse: true,
    attribution: null,
    dateAcquired: '2026-01-01',
    usageRestrictions: 'none',
    character: ['deep'],
    genreFit: ['psytrance'],
    bpmRange: [120, 160],
    rootNote: 33,
    verification: 'PROCEDURAL',
    ...overrides,
  }
}

describe('validateProvenance', () => {
  it('passes for a complete entry', () => {
    expect(() => validateProvenance(makeValidEntry())).not.toThrow()
  })
  it('throws if source is empty', () => {
    expect(() => validateProvenance(makeValidEntry({ source: '' }))).toThrow(ProvenanceError)
  })
  it('throws if author is empty', () => {
    expect(() => validateProvenance(makeValidEntry({ author: '' }))).toThrow(ProvenanceError)
  })
  it('throws if license is empty', () => {
    expect(() => validateProvenance(makeValidEntry({ license: '' }))).toThrow(ProvenanceError)
  })
  it('throws if commercialUse is not boolean', () => {
    expect(() => validateProvenance(makeValidEntry({ commercialUse: 'yes' as unknown as boolean }))).toThrow(ProvenanceError)
  })
  it('throws if dateAcquired is empty', () => {
    expect(() => validateProvenance(makeValidEntry({ dateAcquired: '' }))).toThrow(ProvenanceError)
  })
  it('error message includes sample id', () => {
    try {
      validateProvenance(makeValidEntry({ id: 'my-kick', source: '' }))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ProvenanceError)
      expect((e as ProvenanceError).message).toContain('my-kick')
    }
  })
})

describe('isCommerciallyUsable', () => {
  it('returns true when commercialUse is true', () => {
    expect(isCommerciallyUsable(makeValidEntry({ commercialUse: true }))).toBe(true)
  })
  it('returns false when commercialUse is false', () => {
    expect(isCommerciallyUsable(makeValidEntry({ commercialUse: false }))).toBe(false)
  })
})

describe('validateManifest', () => {
  it('validates a correct manifest', () => {
    const manifest = {
      version: '1.0.0',
      description: 'test',
      generated: '2026-01-01',
      licensePolicy: 'test policy',
      samples: [makeValidEntry(), makeValidEntry({ id: 'test-2' })],
    }
    const result = validateManifest(manifest)
    expect(result.version).toBe('1.0.0')
    expect(result.samples.length).toBe(2)
  })
  it('skips non-commercial samples', () => {
    const manifest = {
      version: '1.0.0',
      samples: [
        makeValidEntry({ id: 'commercial-1' }),
        makeValidEntry({ id: 'non-commercial-1', commercialUse: false }),
      ],
    }
    const result = validateManifest(manifest)
    expect(result.samples.length).toBe(1)
    expect(result.samples[0].id).toBe('commercial-1')
  })
  it('throws ManifestError if root is not object', () => {
    expect(() => validateManifest('not an object')).toThrow()
  })
  it('throws ManifestError if version missing', () => {
    expect(() => validateManifest({ samples: [] })).toThrow()
  })
  it('throws ManifestError if samples missing', () => {
    expect(() => validateManifest({ version: '1.0.0' })).toThrow()
  })
  it('throws if entry missing required field', () => {
    const manifest = {
      version: '1.0.0',
      samples: [{ id: 'incomplete' }],
    }
    expect(() => validateManifest(manifest)).toThrow()
  })
  it('handles empty samples array', () => {
    const manifest = { version: '1.0.0', samples: [] }
    const result = validateManifest(manifest)
    expect(result.samples.length).toBe(0)
  })
  it('throws ProvenanceError if an entry lacks provenance', () => {
    const manifest = {
      version: '1.0.0',
      samples: [makeValidEntry({ source: '' })],
    }
    expect(() => validateManifest(manifest)).toThrow(ProvenanceError)
  })

  it('skips UNKNOWN verification samples (provenance policy)', () => {
    const manifest = {
      version: '1.0.0',
      samples: [
        makeValidEntry({ id: 'ok', verification: 'PROCEDURAL' }),
        makeValidEntry({ id: 'unknown', verification: 'UNKNOWN' }),
      ],
    }
    const result = validateManifest(manifest)
    expect(result.samples.length).toBe(1)
    expect(result.samples[0].id).toBe('ok')
  })

  it('skips QUARANTINED verification samples (provenance policy)', () => {
    const manifest = {
      version: '1.0.0',
      samples: [
        makeValidEntry({ id: 'ok', verification: 'VERIFIED' }),
        makeValidEntry({ id: 'quarantined', verification: 'QUARANTINED' }),
      ],
    }
    const result = validateManifest(manifest)
    expect(result.samples.length).toBe(1)
    expect(result.samples[0].id).toBe('ok')
  })

  it('accepts VERIFIED samples', () => {
    const manifest = {
      version: '1.0.0',
      samples: [makeValidEntry({ verification: 'VERIFIED' })],
    }
    const result = validateManifest(manifest)
    expect(result.samples.length).toBe(1)
  })

  it('accepts PROCEDURAL samples', () => {
    const manifest = {
      version: '1.0.0',
      samples: [makeValidEntry({ verification: 'PROCEDURAL' })],
    }
    const result = validateManifest(manifest)
    expect(result.samples.length).toBe(1)
  })

  it('throws if verification field is missing', () => {
    const entry = makeValidEntry()
    const { verification, ...withoutVerification } = entry
    const manifest = {
      version: '1.0.0',
      samples: [withoutVerification],
    }
    expect(() => validateManifest(manifest)).toThrow(ManifestError)
  })

  it('throws if verification value is invalid', () => {
    const manifest = {
      version: '1.0.0',
      samples: [makeValidEntry({ verification: 'MAYBE' as never })],
    }
    expect(() => validateManifest(manifest)).toThrow(ManifestError)
  })
})
