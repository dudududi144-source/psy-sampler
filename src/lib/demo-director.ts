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

export type Pattern = Record<SampleRole, number[]>
// Each cell is a velocity 0..127 (MIDI standard). 0 = off (no note).
// 1..127 = on with that velocity (127 = max). The director normalizes to 0..1
// for NoteEvent.velocity. This replaces the old boolean[] pattern — a binary
// on/off grid can't express dynamics, which makes a groovebox feel robotic.
// Per-step velocity is the single biggest UX upgrade for expressiveness.

export interface DirectorOptions {
  host: DeviceHost
  transport: DemoTransport
  audioContext: AudioContext
  initialPattern?: Pattern
  initialContext?: MusicalContext
}

const STEPS = 16

// Velocity constants (MIDI standard 0..127).
const VEL_OFF = 0
const VEL_DEFAULT = 100 // default velocity when toggling a step on
const VEL_ACCENT = 127 // accent velocity (max)

const DEFAULT_PATTERN: Pattern = {
  kick:       [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
  bass:       [100, 0, 80, 0, 100, 0, 80, 0, 100, 0, 80, 0, 100, 0, 80, 0],
  lead:       [0, 0, 0, 0, 0, 0, 90, 0, 0, 0, 0, 0, 0, 0, 110, 0],
  'hat-closed': [0, 70, 0, 70, 0, 70, 0, 70, 0, 70, 0, 70, 0, 70, 0, 70],
  'hat-open':   [0, 0, 0, 0, 80, 0, 0, 0, 0, 0, 0, 0, 80, 0, 0, 0],
  clap:       [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
  perc:       [0, 0, 70, 0, 0, 0, 0, 80, 0, 0, 70, 0, 0, 0, 0, 80],
  texture:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  fx:         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
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
      // 30% chance to mutate a cell in this role.
      // Toggle: if off (0) → turn on at a random velocity (70..127).
      //         If on (>0) → turn off (0).
      if (rng.next() < 0.3) {
        const cellIdx = rng.int(0, STEPS - 1)
        const current = row[cellIdx] ?? 0
        row[cellIdx] = current > 0 ? VEL_OFF : rng.int(70, 127)
      }
      // 15% chance to mutate a second cell.
      if (rng.next() < 0.15) {
        const cellIdx = rng.int(0, STEPS - 1)
        const current = row[cellIdx] ?? 0
        row[cellIdx] = current > 0 ? VEL_OFF : rng.int(70, 127)
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
    // Cycle: 0 (off) → VEL_DEFAULT (100) → VEL_ACCENT (127) → 0 (off).
    // This gives 3 velocity tiers via repeated clicks — enough for dynamics
    // without needing a separate velocity slider (though one could be added).
    const current = row[step] ?? 0
    if (current === 0) row[step] = VEL_DEFAULT
    else if (current < VEL_ACCENT) row[step] = VEL_ACCENT
    else row[step] = VEL_OFF
  }

  /** Set a step to an explicit velocity (0=off, 1..127=on). Used by drag-paint. */
  setStep(role: SampleRole, step: number, velocity: number): void {
    if (step < 0 || step >= STEPS) return
    const row = this.pattern[role]
    if (!row) return
    row[step] = Math.max(0, Math.min(127, Math.round(velocity)))
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
      if (!row) continue
      const velocity = row[step] ?? 0
      if (velocity <= 0) continue // 0 = off (no note)
      const note = ROLE_NOTES[role] ?? 60
      const event: NoteEvent = {
        type: 'note',
        note,
        // Normalize MIDI velocity (0..127) to 0..1 for NoteEvent.velocity.
        velocity: velocity / 127,
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

export { DEFAULT_PATTERN, DEFAULT_CONTEXT, ROLE_NOTES, STEPS, VEL_DEFAULT, VEL_ACCENT, VEL_OFF }
