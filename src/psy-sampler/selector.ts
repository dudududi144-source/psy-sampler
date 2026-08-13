// PSY Sampler — SelectionPolicy.
// Deterministic, context-aware sample selection.
//
// Inputs: role, bank, velocity, section, energy, style, phrasePosition, seed.
// Output: { sampleId, playbackRate, gain, pan }.
//
// Determinism: uses seeded Rng (mulberry32). Same inputs → same output, always.
// No Math.random() in this file (grep-verified).

import type { Rng } from '../psy-foundation-shim/voice-pool'
import type { SampleLibrary } from './library'
import type {
  SelectionInput,
  SelectionOutput,
  SampleId,
  SampleRole,
  SampleBank,
} from './types'
import { RoundRobinBank, DEFAULT_VARIANCE_RULES } from './round-robin'

/**
 * Pitch ratio from a source MIDI note to a target MIDI note.
 * ratio = 2^((target - source) / 12)
 * Safe fallback: if source is NaN/0, returns 1.0.
 */
export function pitchRatio(sourceMidi: number, targetMidi: number): number {
  if (!Number.isFinite(sourceMidi) || sourceMidi === 0) return 1.0
  return Math.pow(2, (targetMidi - sourceMidi) / 12)
}

export interface SelectionPolicyOptions {
  /** Default decay per category, in seconds. */
  defaultDecay?: Partial<Record<SampleRole, number>>
  /** Override variance rules. */
  varianceRules?: typeof DEFAULT_VARIANCE_RULES
}

export class SelectionPolicy {
  private readonly roundRobin: RoundRobinBank
  private readonly defaultDecay: Partial<Record<SampleRole, number>>

  constructor(
    private readonly library: SampleLibrary,
    opts: SelectionPolicyOptions = {}
  ) {
    this.roundRobin = new RoundRobinBank(opts.varianceRules ?? DEFAULT_VARIANCE_RULES)
    this.defaultDecay = opts.defaultDecay ?? {
      kick: 0.3,
      bass: 0.4,
      lead: 0.5,
      'hat-closed': 0.05,
      'hat-open': 0.2,
      clap: 0.15,
      perc: 0.1,
      texture: 1.5,
      fx: 0.8,
    }
  }

  /**
   * Select a sample + playback parameters for the given input.
   * Returns null if no sample is available for the role (graceful — caller skips).
   */
  select(input: SelectionInput): SelectionOutput | null {
    // 1. Find candidate sampleIds for this role.
    const candidates = this.findCandidates(input.role, input.bank)
    if (candidates.length === 0) return null

    // 2. Round-robin variant selection (phrase-locked).
    const rr = this.roundRobin.next(input.role, input.phrasePosition)

    // 3. Pick the sampleId at the variant index (wrap if fewer samples than variants).
    const sampleId = candidates[rr.variant % candidates.length] as SampleId

    // 4. Derive playbackRate from rootNote + event note (MIDI).
    //    The event.note (MIDI) is the TARGET pitch. The sample's rootNote is the SOURCE.
    //    For unpitched roles (kick, hat, clap, perc), the target == rootNote (no pitch shift
    //    beyond round-robin microVar). For pitched roles (bass, lead), target = event note.
    const asset = this.library.get(sampleId)
    if (!asset) return null
    const rootNote = asset.metadata.character.rootNote
    // We don't have the event.note here — the device passes it via a separate param.
    // For now, playbackRate = rr.pitch (round-robin microVar only).
    // The device will multiply this by the note-derived ratio if needed.
    const playbackRate = rr.pitch

    // 5. Gain = velocity × rr.gain. Clamp to [0, 1.5].
    const gain = Math.max(0, Math.min(1.5, input.velocity * rr.gain))

    // 6. Pan from round-robin.
    const pan = Math.max(-1, Math.min(1, rr.pan))

    return { sampleId, playbackRate, gain, pan }
  }

  /**
   * Select with an explicit target MIDI note (for pitched roles).
   * Combines round-robin microVar with note-derived pitch ratio.
   */
  selectWithNote(input: SelectionInput, targetMidi: number): SelectionOutput | null {
    const base = this.select(input)
    if (base === null) return null
    const asset = this.library.get(base.sampleId)
    if (!asset) return base
    const rootNote = asset.metadata.character.rootNote
    const noteRatio = pitchRatio(rootNote, targetMidi)
    return {
      ...base,
      playbackRate: base.playbackRate * noteRatio,
    }
  }

  /** Decay (envelope length) for a role. */
  decayFor(role: SampleRole): number {
    return this.defaultDecay[role] ?? 0.3
  }

  /** Reset round-robin state (e.g. on transport stop). */
  reset(): void {
    this.roundRobin.reset()
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private findCandidates(role: SampleRole, bank: SampleBank | null): SampleId[] {
    let candidates = this.library.query({ category: role })
    if (bank !== null) {
      const filtered = candidates.filter((id) => {
        const asset = this.library.get(id)
        return asset?.metadata.subcategory === bank
      })
      if (filtered.length > 0) candidates = filtered
    }
    return candidates
  }
}
