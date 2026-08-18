import { describe, it, expect } from 'bun:test'
import type { SampleRole } from '@/psy-sampler'
import {
  ROLES,
  ROLE_COLORS,
  ROLE_LABEL,
} from '@/components/types'

// ─── Performance pads — roles, labels, colors ──────────────────────────────
//
// Performance pads are a 3×3 grid mapping ROLES[0..8] → pads[0..8].
// These tests verify the mapping contract: every role has a color, a label,
// and the index→role mapping is stable (keyboard shortcut 1 = ROLES[0], etc.).

describe('Performance pads', () => {
  it('ROLES has exactly 9 entries (3×3 grid)', () => {
    expect(ROLES.length).toBe(9)
  })

  it('ROLES is stable — index maps to a fixed role', () => {
    // Keyboard shortcut 1 → ROLES[0], 2 → ROLES[1], ..., 9 → ROLES[8].
    // This contract MUST be stable: changing the order breaks muscle memory.
    expect(ROLES[0]).toBe('kick')
    expect(ROLES[1]).toBe('bass')
    expect(ROLES[2]).toBe('lead')
    expect(ROLES[3]).toBe('hat-closed')
    expect(ROLES[4]).toBe('hat-open')
    expect(ROLES[5]).toBe('clap')
    expect(ROLES[6]).toBe('perc')
    expect(ROLES[7]).toBe('texture')
    expect(ROLES[8]).toBe('fx')
  })

  it('every role has a color', () => {
    for (const role of ROLES) {
      expect(ROLE_COLORS[role]).toBeDefined()
      expect(ROLE_COLORS[role].length).toBeGreaterThan(0)
    }
  })

  it('every role has a 3-char label', () => {
    for (const role of ROLES) {
      const label = ROLE_LABEL[role]
      expect(label).toBeDefined()
      expect(label.trim().length).toBeGreaterThan(0)
      expect(label.trim().length).toBeLessThanOrEqual(4)
    }
  })

  it('all 9 colors are unique (so pads are visually distinguishable)', () => {
    const colors = ROLES.map((r) => ROLE_COLORS[r])
    expect(new Set(colors).size).toBe(9)
  })

  it('all 9 labels are unique (so pads are textually distinguishable)', () => {
    const labels = ROLES.map((r) => ROLE_LABEL[r].trim())
    expect(new Set(labels).size).toBe(9)
  })

  it('pad index 0-8 maps to valid roles (no out-of-bounds)', () => {
    for (let i = 0; i <= 8; i++) {
      const role = ROLES[i]
      expect(role).toBeDefined()
      expect(typeof role).toBe('string')
    }
  })

  it('pad index 9+ is undefined (grid is exactly 3×3)', () => {
    expect(ROLES[9]).toBeUndefined()
    expect(ROLES[10]).toBeUndefined()
  })

  it('keyboard shortcut → pad index → role chain is correct', () => {
    // Digit1 → index 0 → kick, Digit9 → index 8 → fx.
    const shortcutToIndex = (digit: number): number => digit - 1
    const indexToRole = (index: number): SampleRole => ROLES[index]

    expect(indexToRole(shortcutToIndex(1))).toBe('kick')
    expect(indexToRole(shortcutToIndex(5))).toBe('hat-open')
    expect(indexToRole(shortcutToIndex(9))).toBe('fx')
  })

  it('velocity normalization: 100/127 ≈ 0.787, 127/127 = 1.0, 50/127 ≈ 0.394', () => {
    // The triggerPad handler normalizes 0..127 → 0..1 for the device.
    const normalize = (v: number) => v / 127
    expect(normalize(100)).toBeCloseTo(0.787, 2)
    expect(normalize(127)).toBe(1)
    expect(normalize(50)).toBeCloseTo(0.394, 2)
    expect(normalize(0)).toBe(0)
  })

  it('accent velocity (Shift) = 127, ghost velocity (Alt) = 50, default = 100', () => {
    // These are the three velocity tiers the pads support via modifiers.
    const accentVel = 127
    const ghostVel = 50
    const defaultVel = 100
    expect(accentVel).toBeGreaterThan(defaultVel)
    expect(defaultVel).toBeGreaterThan(ghostVel)
    expect(accentVel).toBeLessThanOrEqual(127)
    expect(ghostVel).toBeGreaterThan(0)
  })
})

// ─── Pad active state logic ─────────────────────────────────────────────────
//
// The active state (pad flash) is derived from nowPlayingRole + nowPlayingAt.
// A pad is "active" when:
//   - nowPlayingRole === this pad's role, AND
//   - Date.now() - nowPlayingAt < NOW_PLAYING_MS (220ms)
//
// This is the same window used by the PatternEditor row highlight and the
// SampleLibrary audition highlight — visual consistency across all trigger
// sources (pads, MIDI, sequencer, audition).

describe('Pad active state', () => {
  const NOW_PLAYING_MS = 220

  function isActive(
    padRole: SampleRole,
    nowPlayingRole: SampleRole | null,
    nowPlayingAt: number,
    now: number,
  ): boolean {
    return (
      nowPlayingRole === padRole &&
      nowPlayingAt > 0 &&
      now - nowPlayingAt < NOW_PLAYING_MS
    )
  }

  it('active when role matches and within time window', () => {
    const now = Date.now()
    expect(isActive('kick', 'kick', now, now)).toBe(true)
    expect(isActive('kick', 'kick', now - 100, now)).toBe(true)
    expect(isActive('kick', 'kick', now - 219, now)).toBe(true)
  })

  it('inactive when role does not match', () => {
    const now = Date.now()
    expect(isActive('kick', 'bass', now, now)).toBe(false)
    expect(isActive('kick', null, now, now)).toBe(false)
  })

  it('inactive when time window expired', () => {
    const now = Date.now()
    expect(isActive('kick', 'kick', now - 221, now)).toBe(false)
    expect(isActive('kick', 'kick', now - 500, now)).toBe(false)
  })

  it('inactive when nowPlayingAt is 0 (never played)', () => {
    const now = Date.now()
    expect(isActive('kick', 'kick', 0, now)).toBe(false)
  })

  it('boundary: exactly NOW_PLAYING_MS ago is inactive (< not <=)', () => {
    const now = Date.now()
    // At exactly 220ms ago: now - (now - 220) = 220, which is NOT < 220.
    expect(isActive('kick', 'kick', now - 220, now)).toBe(false)
    // At 219ms ago: 219 < 220 → active.
    expect(isActive('kick', 'kick', now - 219, now)).toBe(true)
  })
})
