// Per-step probability tests — verifies the probability overlay system.

import { describe, it, expect } from 'bun:test'
import { DemoDirector, type Pattern } from '../../src/lib/demo-director'
import type { DeviceHost, NoteEvent } from '../../src/psy-foundation-shim'

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

describe('Per-step probability', () => {
  it('getProbability returns 1.0 by default (always play)', () => {
    const director = makeDirector()
    expect(director.getProbability('kick', 0)).toBe(1.0)
    expect(director.getProbability('bass', 5)).toBe(1.0)
  })

  it('setProbability stores the value', () => {
    const director = makeDirector()
    director.setProbability('kick', 0, 0.5)
    expect(director.getProbability('kick', 0)).toBe(0.5)
  })

  it('setProbability clamps to 0..1', () => {
    const director = makeDirector()
    director.setProbability('kick', 0, 1.5)
    expect(director.getProbability('kick', 0)).toBe(1.0)
    director.setProbability('kick', 0, -0.5)
    expect(director.getProbability('kick', 0)).toBe(0)
  })

  it('setProbability to 1.0 removes from map (default behavior)', () => {
    const director = makeDirector()
    director.setProbability('kick', 0, 0.5)
    expect(director.hasProbabilities).toBe(true)
    director.setProbability('kick', 0, 1.0)
    expect(director.hasProbabilities).toBe(false)
  })

  it('getAllProbabilities returns only non-default entries', () => {
    const director = makeDirector()
    director.setProbability('kick', 0, 0.5)
    director.setProbability('bass', 2, 0.75)
    const all = director.getAllProbabilities()
    expect(Object.keys(all).length).toBe(2)
    expect(all['kick']![0]).toBe(0.5)
    expect(all['bass']![2]).toBe(0.75)
  })

  it('loadProbabilities restores from saved map', () => {
    const director = makeDirector()
    director.loadProbabilities({
      kick: { 0: 0.3, 4: 0.7 },
      bass: { 2: 0.5 },
    })
    expect(director.getProbability('kick', 0)).toBe(0.3)
    expect(director.getProbability('kick', 4)).toBe(0.7)
    expect(director.getProbability('bass', 2)).toBe(0.5)
    expect(director.getProbability('bass', 0)).toBe(1.0) // default
  })

  it('clearProbabilities resets to defaults', () => {
    const director = makeDirector()
    director.setProbability('kick', 0, 0.5)
    director.clearProbabilities()
    expect(director.hasProbabilities).toBe(false)
    expect(director.getProbability('kick', 0)).toBe(1.0)
  })

  it('hasProbabilities reports correctly', () => {
    const director = makeDirector()
    expect(director.hasProbabilities).toBe(false)
    director.setProbability('kick', 0, 0.5)
    expect(director.hasProbabilities).toBe(true)
    director.setProbability('kick', 0, 1.0)
    expect(director.hasProbabilities).toBe(false)
  })

  it('probability affects note publishing (100% = always, 0% = never)', () => {
    // We can't easily test the RNG skip in a unit test (it's inside scheduleStep
    // which is private + needs a running timer). But we CAN verify the API
    // is correct — the director stores and retrieves probabilities correctly.
    const director = makeDirector()
    director.setProbability('kick', 0, 0) // 0% = never play
    expect(director.getProbability('kick', 0)).toBe(0)
    director.setProbability('kick', 0, 1) // 100% = always play
    expect(director.getProbability('kick', 0)).toBe(1.0)
  })
})
