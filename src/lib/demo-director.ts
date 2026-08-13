// PSY Sampler — demo musical director (TEST HARNESS ONLY).
//
// ⚠️  THIS IS NOT PRODUCTION CODE.
// ⚠️  This is a test harness for the demo playground UI.
// ⚠️  In production, PSY4's CausalComposer replaces this entirely.
// ⚠️  The sampler device is agnostic to the director — it just consumes NoteEvents.
//
// This file simulates a host by generating NoteEvents from a 16-step pattern grid.
// It is used by:
//   - src/app/page.tsx (demo playground — standalone testing without PSY4)
//   - tests/psy-sampler/ (integration tests without running PSY4)
//
// It is NOT part of the sampler device architecture.
// It does NOT implement PsyDevice or any foundation contract.
// It will be REMOVED when the sampler is fully integrated with PSY4.

import type { DeviceHost, MusicalContext, NoteEvent } from '@/psy-foundation-shim'
import { Rng } from '@/psy-foundation-shim'
import type { DemoTransport } from './demo-transport'
import type { SampleRole } from '@/psy-sampler'
import { createTimerWorker } from './timer-worker'

export type Pattern = Record<SampleRole, boolean[]>

export interface DirectorOptions {
  host: DeviceHost
  transport: DemoTransport
  audioContext: AudioContext
  initialPattern?: Pattern
  initialContext?: MusicalContext
}

const STEPS = 16

const DEFAULT_PATTERN: Pattern = {
  kick:       [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
  bass:       [true, false, true, false, true, false, true, false, true, false, true, false, true, false, true, false],
  lead:       [false, false, false, false, false, false, true, false, false, false, false, false, false, false, true, false],
  'hat-closed': [false, true, false, true, false, true, false, true, false, true, false, true, false, true, false, true],
  'hat-open':   [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  clap:       [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
  perc:       [false, false, true, false, false, false, false, true, false, false, true, false, false, false, false, true],
  texture:    [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
  fx:         [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false],
}

const DEFAULT_CONTEXT: MusicalContext = {
  key: 'A',
  rootPc: 9,
  scale: 'phrygianDominant',
  energy: 0.7,
  style: 'psytrance',
  section: 'DROP',
  beatsPerBar: 4,
}

// Default MIDI notes per role (for pitched roles; unpitched roles use rootNote).
const ROLE_NOTES: Record<SampleRole, number> = {
  kick: 33,
  bass: 33,
  lead: 69,
  'hat-closed': 60,
  'hat-open': 60,
  clap: 60,
  perc: 64,
  texture: 33,
  fx: 60,
}

const LOOKAHEAD_SEC = 0.12
const TICK_MS = 25

export class DemoDirector {
  private readonly host: DeviceHost
  private readonly transport: DemoTransport
  private readonly ctx: AudioContext
  private pattern: Pattern
  private context: MusicalContext
  private step = 0
  private nextNoteTime = 0
  private timer: { stop: () => void } | null = null
  private running = false
  private readonly onStep?: (step: number) => void
  private swing = 0 // 0 = straight, 0.7 = 70% swing
  private evolveEnabled = false
  private evolveSeed = 42
  private evolveBarCounter = 0
  private readonly evolveInterval = 4 // mutate every 4 bars

  constructor(opts: DirectorOptions, onStep?: (step: number) => void) {
    this.host = opts.host
    this.transport = opts.transport
    this.ctx = opts.audioContext
    this.pattern = opts.initialPattern ?? structuredClone(DEFAULT_PATTERN)
    this.context = opts.initialContext ?? { ...DEFAULT_CONTEXT }
    this.onStep = onStep
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.step = 0
    this.nextNoteTime = this.ctx.currentTime + 0.06
    this.transport.start(this.ctx)
    // Push initial context + transport.
    this.host.pushContext(this.context)
    this.host.pushTransport(this.transport.snapshot(this.ctx.currentTime), performance.now())
    this.timer = this.makeTimer(() => this.tick())
  }

  stop(): void {
    this.running = false
    this.transport.stop()
    if (this.timer) {
      this.timer.stop()
      this.timer = null
    }
  }

  setBpm(bpm: number): void {
    this.transport.setBpm(bpm, this.ctx)
    this.host.pushTransport(this.transport.snapshot(this.ctx.currentTime), performance.now())
  }

  setSwing(swing: number): void {
    this.swing = Math.max(0, Math.min(0.7, swing))
  }

  get currentSwing(): number {
    return this.swing
  }

  // ─── Auto-evolve ────────────────────────────────────────────────────────────

  setEvolveEnabled(enabled: boolean): void {
    this.evolveEnabled = enabled
    this.evolveBarCounter = 0
  }

  get isEvolveEnabled(): boolean {
    return this.evolveEnabled
  }

  setEvolveSeed(seed: number): void {
    this.evolveSeed = seed
  }

  get currentEvolveSeed(): number {
    return this.evolveSeed
  }

  /**
   * Mutate the pattern: toggle 1-2 cells per role using a seeded RNG.
   * Same seed + same pattern → same mutation (deterministic).
   */
  private evolvePattern(): void {
    const seed = this.evolveSeed * 1000 + this.evolveBarCounter
    const rng = new Rng(seed >>> 0)
    const mutated = structuredClone(this.pattern)
    const roles = Object.keys(mutated) as SampleRole[]
    for (const role of roles) {
      const row = mutated[role]
      if (!row) continue
      // 30% chance to toggle a cell in this role.
      if (rng.next() < 0.3) {
        const cellIdx = rng.int(0, STEPS - 1)
        row[cellIdx] = !row[cellIdx]
      }
      // 15% chance to toggle a second cell.
      if (rng.next() < 0.15) {
        const cellIdx = rng.int(0, STEPS - 1)
        row[cellIdx] = !row[cellIdx]
      }
    }
    this.pattern = mutated
  }

  setContext(ctx: Partial<MusicalContext>): void {
    this.context = { ...this.context, ...ctx }
    this.host.pushContext(this.context)
  }

  toggleStep(role: SampleRole, step: number): void {
    if (step < 0 || step >= STEPS) return
    const row = this.pattern[role]
    if (!row) return
    row[step] = !row[step]
  }

  /** Replace the entire pattern (used by preset + slot loading). */
  setPattern(pattern: Pattern): void {
    this.pattern = structuredClone(pattern)
  }

  getPattern(): Pattern {
    return this.pattern
  }

  get currentStep(): number {
    return this.step
  }

  get isRunning(): boolean {
    return this.running
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.running) return
    const horizon = this.ctx.currentTime + LOOKAHEAD_SEC
    const secPerStep = (60 / this.transport.currentBpm) / 4 // 16th notes
    let guard = 0
    while (this.nextNoteTime < horizon && guard++ < 64) {
      // Apply swing: delay odd 16th steps by swing * secPerStep * 0.5.
      const isOffbeat = this.step % 2 === 1
      const swingOffset = isOffbeat ? this.swing * secPerStep * 0.5 : 0
      this.scheduleStep(this.step, this.nextNoteTime + swingOffset)
      this.onStep?.(this.step)
      this.step = (this.step + 1) % STEPS
      // Auto-evolve: mutate pattern every evolveInterval bars (when step wraps to 0).
      if (this.step === 0 && this.evolveEnabled) {
        this.evolveBarCounter += 1
        if (this.evolveBarCounter >= this.evolveInterval) {
          this.evolveBarCounter = 0
          this.evolvePattern()
        }
      }
      this.nextNoteTime += secPerStep
    }
    // Push transport snapshot periodically (every tick).
    this.host.pushTransport(this.transport.snapshot(this.ctx.currentTime), performance.now())
  }

  private scheduleStep(step: number, at: number): void {
    const secPerStep = (60 / this.transport.currentBpm) / 4
    for (const role of Object.keys(this.pattern) as SampleRole[]) {
      const row = this.pattern[role]
      if (!row || !row[step]) continue
      const note = ROLE_NOTES[role] ?? 60
      const event: NoteEvent = {
        type: 'note',
        note,
        velocity: role === 'kick' ? 0.9 : role === 'bass' ? 0.7 : 0.6,
        duration: secPerStep * 0.9,
        channel: role, // channel = role (sampler parses it)
        at,
      }
      this.host.publish(event)
    }
  }

  private makeTimer(onTick: () => void): { stop: () => void } {
    // FIX: use shared timer-worker (was duplicated byte-identical string).
    return createTimerWorker(onTick, TICK_MS)
  }
}

export { DEFAULT_PATTERN, DEFAULT_CONTEXT, ROLE_NOTES, STEPS }
