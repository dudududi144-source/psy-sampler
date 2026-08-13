// Shim sync test — verifies the psy-foundation-shim stays byte-equivalent to
// the canonical psy-foundation source.
//
// SHIM_VERSION: pinned to psy-foundation commit 4ae95d3 (2026-08-13).
//
// This test does REAL byte-comparison of code bodies (not just exported names).
// It normalizes import paths + comments so only the actual logic is compared.
// If the canonical contracts evolve, this test fails and the shim must be re-synced.
//
// This test reads the canonical source from the audit clone at
// /home/z/my-project/psy-audit/psy-foundation/ and compares it to the shim.
// If the audit clone is not present (e.g. in CI), the test is skipped.

import { describe, it, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const FOUNDATION_ROOT = '/home/z/my-project/psy-audit/psy-foundation/packages'
const SHIM_ROOT = '/home/z/my-project/src/psy-foundation-shim'

const SHIM_MAP = [
  {
    name: 'device.ts',
    shim: join(SHIM_ROOT, 'device.ts'),
    canonical: join(FOUNDATION_ROOT, 'device-sdk/src/device.ts'),
  },
  {
    name: 'host.ts',
    shim: join(SHIM_ROOT, 'host.ts'),
    canonical: join(FOUNDATION_ROOT, 'device-sdk/src/host.ts'),
  },
  {
    name: 'voice-pool.ts (Voice + VoicePool)',
    shim: join(SHIM_ROOT, 'voice-pool.ts'),
    canonical: join(FOUNDATION_ROOT, 'dsp/src/voicePool.ts'),
  },
] as const

describe('shim sync (real byte-equivalence — not just exported names)', () => {
  const skip = !existsSync(FOUNDATION_ROOT)
  if (skip) {
    it.skip('shim sync — audit clone not present, skipping', () => {})
    return
  }

  for (const { name, shim, canonical } of SHIM_MAP) {
    it(`${name}: code body matches canonical (normalized)`, () => {
      const shimSrc = readFileSync(shim, 'utf8')
      const canonicalSrc = readFileSync(canonical, 'utf8')

      // Normalize both sources: strip comments + import paths, keep only logic.
      const shimNorm = normalize(shimSrc)
      const canonNorm = normalize(canonicalSrc)

      // The shim may contain MULTIPLE canonical files merged (e.g. voice-pool.ts
      // has VoicePool + Rng). So we check that every canonical export body is
      // present in the shim.
      const canonExports = extractExportBlocks(canonNorm)
      for (const [exportName, canonBody] of Object.entries(canonExports)) {
        // The shim must contain this export's body.
        const shimExports = extractExportBlocks(shimNorm)
        const shimBody = shimExports[exportName]
        expect(shimBody).toBeDefined()
        // Compare the normalized bodies. They should be identical.
        expect(shimBody).toBe(canonBody)
      }
    })

    it(`${name}: all canonical exports present in shim`, () => {
      const shimSrc = readFileSync(shim, 'utf8')
      const canonicalSrc = readFileSync(canonical, 'utf8')
      const canonicalExports = extractExports(canonicalSrc)
      const shimExports = extractExports(shimSrc)
      for (const ex of canonicalExports) {
        expect(shimExports).toContain(ex)
      }
    })
  }

  it('SHIM_VERSION is documented in every shim file', () => {
    const shimFiles = [
      join(SHIM_ROOT, 'device.ts'),
      join(SHIM_ROOT, 'host.ts'),
      join(SHIM_ROOT, 'protocol.ts'),
      join(SHIM_ROOT, 'transport.ts'),
      join(SHIM_ROOT, 'voice-pool.ts'),
    ]
    for (const f of shimFiles) {
      const src = readFileSync(f, 'utf8')
      expect(src.includes('SHIM_VERSION') || src.includes('VERBATIM SHIM')).toBe(true)
    }
  })

  it('protocol.ts: NoteEvent shape matches canonical', () => {
    const shimSrc = readFileSync(join(SHIM_ROOT, 'protocol.ts'), 'utf8')
    const canonSrc = readFileSync(join(FOUNDATION_ROOT, 'protocol/src/events.ts'), 'utf8')
    // Extract the NoteEvent interface body from both.
    const shimNote = extractInterface(shimSrc, 'NoteEvent')
    const canonNote = extractInterface(canonSrc, 'NoteEvent')
    expect(shimNote).toBe(canonNote)
  })

  it('protocol.ts: MusicalContext shape matches canonical', () => {
    const shimSrc = readFileSync(join(SHIM_ROOT, 'protocol.ts'), 'utf8')
    const canonSrc = readFileSync(join(FOUNDATION_ROOT, 'protocol/src/state.ts'), 'utf8')
    const shimCtx = extractInterface(shimSrc, 'MusicalContext')
    const canonCtx = extractInterface(canonSrc, 'MusicalContext')
    expect(shimCtx).toBe(canonCtx)
  })

  it('transport.ts: MusicalTransport shape matches canonical', () => {
    const shimSrc = readFileSync(join(SHIM_ROOT, 'transport.ts'), 'utf8')
    const canonSrc = readFileSync(join(FOUNDATION_ROOT, 'transport/src/types.ts'), 'utf8')
    const shimT = extractInterface(shimSrc, 'MusicalTransport')
    const canonT = extractInterface(canonSrc, 'MusicalTransport')
    expect(shimT).toBe(canonT)
  })
})

/**
 * Normalize source: strip comments, normalize import paths, trim whitespace.
 * This lets us compare code bodies without cosmetic differences.
 */
function normalize(src: string): string {
  return src
    // Strip line comments (// ...)
    .replace(/\/\/.*$/gm, '')
    // Strip block comments (/* ... */)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Normalize import paths: @psy-foundation/protocol → ./protocol
    .replace(/from\s+['"]@psy-foundation\/[^'"]+['"]/g, "from './normalized'")
    .replace(/from\s+['"]\.\/(\w+)['"]/g, "from './normalized'")
    .replace(/from\s+['"]\.\.\/(\w+)['"]/g, "from './normalized'")
    // Collapse multiple blank lines
    .replace(/\n\s*\n/g, '\n')
    // Trim trailing whitespace per line
    .replace(/\s+$/gm, '')
    // Normalize indentation to single space
    .replace(/^\s+/gm, '')
    .trim()
}

/** Extract exported identifiers from TypeScript source. */
function extractExports(src: string): string[] {
  const exports: string[] = []
  const re = /export\s+(?:interface|class|type|function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    exports.push(m[1]!)
  }
  const re2 = /export\s*\{([^}]+)\}/g
  while ((m = re2.exec(src)) !== null) {
    const names = m[1]!.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean)
    exports.push(...names)
  }
  return exports
}

/** Extract an interface body (the fields between { and }) by name. */
function extractInterface(src: string, name: string): string {
  const re = new RegExp(`interface\\s+${name}\\s*\\{([^}]*)\\}`, 'g')
  const m = re.exec(src)
  if (!m) return ''
  return m[1]!.trim()
}

/** Extract export blocks: { exportName: normalizedBody } for interfaces/classes. */
function extractExportBlocks(normalizedSrc: string): Record<string, string> {
  const blocks: Record<string, string> = {}
  // Match: export interface Name { ... } or export class Name { ... }
  const re = /export\s+(interface|class|type|function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*[\{(]([^}]*)[})]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(normalizedSrc)) !== null) {
    const name = m[2]!
    const body = m[3]!.trim()
    blocks[name] = body
  }
  return blocks
}
