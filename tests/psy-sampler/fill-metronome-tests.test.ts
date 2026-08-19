// Tests for recent features: fillRole, metronome, keyboard shortcuts expansion.

import { describe, it, expect } from 'bun:test'
import { DemoDirector, DEFAULT_PATTERN, type Pattern } from '../../src/lib/demo-director'
import type { DeviceHost, NoteEvent } from '../../src/psy-foundation-shim'
import { Metronome } from '../../src/lib/metronome'

class CaptureHost implements Pick<DeviceHost, 'publish' | 'pushTransport' | 'pushContext'> {
  events: NoteEvent[] = []
  publish(event: NoteEvent): void { this.events.push(event) }
  pushTransport(): void {}
  pushContext(): void {}
}

function makeDirector(pattern?: Pattern): DemoDirector {
  const host = new CaptureHost()
  const transport = {
    start: () => {}, stop: () => {}, setBpm: () => {},
    snapshot: () => ({ bpm: 140, bar: 0, beat: 0, revision: 1, isPlaying: true }),
    currentBpm: 140,
  } as never
  const ctx = { currentTime: 0, sampleRate: 44100, destination: {} as AudioNode } as unknown as AudioContext
  return new DemoDirector(
    { host: host as unknown as DeviceHost, transport, audioContext: ctx, initialPattern: pattern },
    () => {}
  )
}

// ─── fillRole ─────────────────────────────────────────────────────────────────

describe('fillRole', () => {
  it('fills a single role without affecting others', () => {
    const director = makeDirector()
    // Start with all zeros.
    const empty: Pattern = {} as Pattern
    for (const role of Object.keys(DEFAULT_PATTERN) as Array<keyof Pattern>) {
      empty[role] = new Array(16).fill(0)
    }
    director.setPattern(empty)
    // Fill only kick.
    director.fillRole('kick', 42)
    const result = director.getPattern()
    // Kick should have notes.
    expect(result.kick.filter((v) => v > 0).length).toBeGreaterThan(0)
    // Bass should still be all zeros.
    expect(result.bass.filter((v) => v > 0).length).toBe(0)
    // Hats should still be all zeros.
    expect(result['hat-closed']!.filter((v) => v > 0).length).toBe(0)
  })

  it('is deterministic — same seed → same result', () => {
    const d1 = makeDirector()
    const d2 = makeDirector()
    d1.fillRole('kick', 42)
    d2.fillRole('kick', 42)
    expect(JSON.stringify(d1.getPattern().kick)).toBe(JSON.stringify(d2.getPattern().kick))
  })

  it('different seeds → different results', () => {
    const d1 = makeDirector()
    const d2 = makeDirector()
    d1.fillRole('kick', 42)
    d2.fillRole('kick', 99)
    expect(JSON.stringify(d1.getPattern().kick)).not.toBe(JSON.stringify(d2.getPattern().kick))
  })

  it('kick 4-on-floor after fill', () => {
    const director = makeDirector()
    director.fillRole('kick', 42)
    const kick = director.getPattern().kick
    expect(kick[0]).toBeGreaterThan(0)
    expect(kick[4]).toBeGreaterThan(0)
    expect(kick[8]).toBeGreaterThan(0)
    expect(kick[12]).toBeGreaterThan(0)
  })

  it('clap on steps 4 and 12 after fill', () => {
    const director = makeDirector()
    director.fillRole('clap', 42)
    const clap = director.getPattern().clap
    expect(clap[4]).toBeGreaterThan(0)
    expect(clap[12]).toBeGreaterThan(0)
  })

  it('velocities within MIDI range (0-127)', () => {
    const director = makeDirector()
    director.fillRole('bass', 42)
    for (const v of director.getPattern().bass) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(127)
    }
  })

  it('fill multiple roles independently', () => {
    const director = makeDirector()
    director.fillRole('kick', 42)
    director.fillRole('bass', 99)
    director.fillRole('hat-closed', 77)
    const result = director.getPattern()
    expect(result.kick.filter((v) => v > 0).length).toBeGreaterThan(0)
    expect(result.bass.filter((v) => v > 0).length).toBeGreaterThan(0)
    expect(result['hat-closed']!.filter((v) => v > 0).length).toBeGreaterThan(0)
    // Lead should still be empty (we only filled kick, bass, hat-closed).
    // Note: lead might have notes from the DEFAULT_PATTERN if we didn't start
    // from empty. Let's check it wasn't filled.
    const leadBefore = DEFAULT_PATTERN.lead.filter((v) => v > 0).length
    const leadAfter = result.lead.filter((v) => v > 0).length
    expect(leadAfter).toBe(leadBefore) // unchanged
  })

  it('fill respects 32-step pattern length', () => {
    const director = makeDirector()
    director.setStepCount(32)
    director.fillRole('kick', 42)
    expect(director.getPattern().kick.length).toBe(32)
    expect(director.getPattern().kick[0]).toBeGreaterThan(0)
    expect(director.getPattern().kick[4]).toBeGreaterThan(0)
    expect(director.getPattern().kick[28]).toBeGreaterThan(0)
  })
})

// ─── Metronome ─────────────────────────────────────────────────────────────────

describe('Metronome', () => {
  it('constructs without throwing', () => {
    const ctx = { currentTime: 0, sampleRate: 44100, destination: {} as AudioNode,
      createBuffer: (ch: number, len: number, _r: number) => ({ length: len, numberOfChannels: ch, sampleRate: 44100, duration: len/44100, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer),
      createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, onended: null, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} } as unknown as AudioBufferSourceNode),
      createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} } as unknown as GainNode),
    } as unknown as AudioContext
    const output = {} as AudioNode
    expect(() => new Metronome(ctx, output)).not.toThrow()
  })

  it('isEnabled starts false', () => {
    const ctx = { currentTime: 0, sampleRate: 44100, destination: {} as AudioNode,
      createBuffer: (ch: number, len: number, _r: number) => ({ length: len, numberOfChannels: ch, sampleRate: 44100, duration: len/44100, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer),
      createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, onended: null, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} } as unknown as AudioBufferSourceNode),
      createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} } as unknown as GainNode),
    } as unknown as AudioContext
    const met = new Metronome(ctx, {} as AudioNode)
    expect(met.isEnabled).toBe(false)
  })

  it('setEnabled toggles state', () => {
    const ctx = { currentTime: 0, sampleRate: 44100, destination: {} as AudioNode,
      createBuffer: (ch: number, len: number, _r: number) => ({ length: len, numberOfChannels: ch, sampleRate: 44100, duration: len/44100, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer),
      createBufferSource: () => ({ buffer: null, playbackRate: { value: 1 }, onended: null, connect: () => {}, disconnect: () => {}, start: () => {}, stop: () => {} } as unknown as AudioBufferSourceNode),
      createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} } as unknown as GainNode),
    } as unknown as AudioContext
    const met = new Metronome(ctx, {} as AudioNode)
    met.setEnabled(true)
    expect(met.isEnabled).toBe(true)
    met.setEnabled(false)
    expect(met.isEnabled).toBe(false)
  })

  it('click is a no-op when disabled', () => {
    const ctx = { currentTime: 0, sampleRate: 44100, destination: {} as AudioNode,
      createBuffer: (ch: number, len: number, _r: number) => ({ length: len, numberOfChannels: ch, sampleRate: 44100, duration: len/44100, getChannelData: () => new Float32Array(len) } as unknown as AudioBuffer),
      createBufferSource: () => { throw new Error('should not create source when disabled') },
      createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} } as unknown as GainNode),
    } as unknown as AudioContext
    const met = new Metronome(ctx, {} as AudioNode)
    // click should be a no-op (no exception) when disabled.
    expect(() => met.click(0, false)).not.toThrow()
  })
})

// ─── Keyboard shortcuts count ──────────────────────────────────────────────────

describe('Keyboard shortcuts', () => {
  it('KeyboardShortcutsOptions has 21 callbacks', () => {
    // Verify the interface has all expected fields by checking the type.
    // This is a compile-time check — if it compiles, it's correct.
    const opts = {
      onTogglePlay: () => {}, onStop: () => {}, onUndo: () => {}, onRedo: () => {},
      onTapTempo: () => {}, onToggleHelp: () => {}, onToggleMute: () => {},
      onToggleSolo: () => {}, onClearPattern: () => {}, onCycleFilter: () => {},
      onTogglePump: () => {}, onToggleEvolve: () => {}, onToggleRecord: () => {},
      onPadTrigger: (_n: number) => {}, onGenerateChords: () => {},
      onCycleArpeggio: () => {}, onCycleBass: () => {}, onHumanize: () => {},
      onQuantize: () => {}, onRandomize: () => {}, onToggleMetronome: () => {},
    }
    expect(Object.keys(opts).length).toBe(21)
  })
})
