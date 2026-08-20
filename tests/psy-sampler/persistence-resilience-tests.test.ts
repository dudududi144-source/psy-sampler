// Pattern persistence resilience tests — verify the persistence layer
// degrades gracefully when localStorage is unavailable or contains
// corrupt data.
//
// The original roast documented: "localStorage corruption crashes the app
// (uncaught JSON.parse)". This test suite verifies that the fix in Phase 0
// actually catches all corruption scenarios and never throws to the caller.

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import {
  getSlotNames,
  saveToSlot,
  loadFromSlot,
  clearSlot,
  autosavePattern,
  loadAutosave,
} from '@/lib/pattern-persistence'
import type { Pattern } from '@/lib/demo-director'
import { DEFAULT_PATTERN } from '@/lib/demo-director'

// Helpers — wrap localStorage access in a sandboxed mock so tests don't
// pollute the real browser localStorage.
function setLocalStorageMock(storage: Record<string, string> = {}) {
  const ls = {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value
    },
    removeItem: (key: string) => {
      delete storage[key]
    },
    clear: () => {
      for (const k of Object.keys(storage)) delete storage[k]
    },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    length: Object.keys(storage).length,
  }
  // @ts-expect-error — replacing the global for test isolation
  globalThis.localStorage = ls
  return storage
}

const VALID_PATTERN: Pattern = structuredClone(DEFAULT_PATTERN)

describe('pattern-persistence resilience', () => {
  let storage: Record<string, string>
  const original = globalThis.localStorage

  beforeEach(() => {
    storage = setLocalStorageMock({})
  })

  afterEach(() => {
    // @ts-expect-error — restoring global for test isolation
    globalThis.localStorage = original
  })

  describe('getSlotNames — corrupt slot data', () => {
    test('returns empty name for slot with invalid JSON', () => {
      storage['psy-sampler:pattern:slot-0'] = 'this is not json'
      storage['psy-sampler:pattern:slot-1'] = '{"valid":true}'
      const names = getSlotNames()
      expect(names).toHaveLength(4)
      expect(names[0]).toBe('')  // corrupt → empty
      expect(names[1]).toBe('')  // missing name field → empty
      expect(names[2]).toBe('')  // empty slot
      expect(names[3]).toBe('')
    })

    test('returns valid name for slot with valid PatternSlot', () => {
      const slot0: { name: string; pattern: Pattern; savedAt: number } = {
        name: 'Test Pattern',
        pattern: VALID_PATTERN,
        savedAt: Date.now(),
      }
      storage['psy-sampler:pattern:slot-0'] = JSON.stringify(slot0)
      const names = getSlotNames()
      expect(names[0]).toBe('Test Pattern')
    })
  })

  describe('loadFromSlot — corrupt data', () => {
    test('returns null for invalid JSON (does not throw)', () => {
      storage['psy-sampler:pattern:slot-0'] = 'not json'
      const result = loadFromSlot(0)
      expect(result).toBeNull()
    })

    test('returns null for JSON missing pattern field', () => {
      storage['psy-sampler:pattern:slot-0'] = '{"name":"test"}'
      const result = loadFromSlot(0)
      expect(result).toBeNull()
    })

    test('returns null for out-of-range slot', () => {
      expect(loadFromSlot(-1)).toBeNull()
      expect(loadFromSlot(99)).toBeNull()
    })
  })

  describe('autosavePattern — quota exceeded', () => {
    test('does not throw when localStorage throws QuotaExceededError', () => {
      // Mock localStorage to throw on setItem.
      const failingLs = {
        getItem: () => null,
        setItem: () => {
          throw new DOMException('quota exceeded', 'QuotaExceededError')
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      }
      // @ts-expect-error — replacing global for test
      globalThis.localStorage = failingLs

      // Should not throw — should be caught internally.
      expect(() => autosavePattern(VALID_PATTERN)).not.toThrow()
    })
  })

  describe('loadAutosave — corrupt data', () => {
    test('returns null for invalid JSON (does not throw)', () => {
      storage['psy-sampler:pattern:__autosave__'] = 'not json'
      const result = loadAutosave()
      expect(result).toBeNull()
    })

    test('returns null when no autosave exists', () => {
      expect(loadAutosave()).toBeNull()
    })
  })

  describe('clearSlot — never throws', () => {
    test('does not throw for out-of-range slot', () => {
      expect(() => clearSlot(-1)).not.toThrow()
      expect(() => clearSlot(99)).not.toThrow()
    })

    test('does not throw when localStorage throws on removeItem', () => {
      const failingLs = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {
          throw new Error('localStorage broken')
        },
        clear: () => {},
        key: () => null,
        length: 0,
      }
      // @ts-expect-error — replacing global for test
      globalThis.localStorage = failingLs
      expect(() => clearSlot(0)).not.toThrow()
    })
  })

  describe('saveToSlot — never throws', () => {
    test('does not throw for out-of-range slot', () => {
      expect(() => saveToSlot(-1, 'name', VALID_PATTERN)).not.toThrow()
      expect(() => saveToSlot(99, 'name', VALID_PATTERN)).not.toThrow()
    })
  })

  describe('localStorage undefined — private browsing mode', () => {
    test('all functions degrade gracefully when localStorage is undefined', () => {
      // @ts-expect-error — simulate localStorage being undefined (some
      // private browsing modes in older Safari/Firefox).
      delete globalThis.localStorage

      expect(() => getSlotNames()).not.toThrow()
      expect(() => saveToSlot(0, 'test', VALID_PATTERN)).not.toThrow()
      expect(() => loadFromSlot(0)).not.toThrow()
      expect(() => clearSlot(0)).not.toThrow()
      expect(() => autosavePattern(VALID_PATTERN)).not.toThrow()
      expect(() => loadAutosave()).not.toThrow()

      // Functions should return sensible defaults.
      expect(getSlotNames()).toEqual(['', '', '', ''])
      expect(loadFromSlot(0)).toBeNull()
      expect(loadAutosave()).toBeNull()
    })
  })
})
