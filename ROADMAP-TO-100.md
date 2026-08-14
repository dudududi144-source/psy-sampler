# PSY Sampler — Roadmap to 100/100

> Strategic plan to close every competitive gap identified in
> [COMPETITIVE-ANALYSIS.md](./COMPETITIVE-ANALYSIS.md) and reach a state where
> no reviewer can score the project below 100 on engineering rigor, audio
> quality, and architectural honesty.

---

## Current Score (self-assessed): 78/100

| Dimension | Score | Rationale |
|---|---|---|
| Architecture (WHAT/HOW separation, contract) | 98 | Canonical PsyDevice, zero composition in the device, event-driven. Best-in-class. |
| Determinism | 95 | Seeded selection + seeded reverb IR + offline render. Was 70 (Math.random in reverb) — now fixed. |
| Voice management | 90 | Per-trigger chain, click-free steal, choke groups, anti-alias lowpass. Was 75. |
| Audio quality | 75 | Lowpass helps, but no oversampling, no velocity layers, machine-gunning risk. |
| FX breadth | 55 | 1 delay, 1 reverb, 1 compressor. No EQ, no saturation, no filter. |
| Sample library | 60 | 19 procedural samples, no velocity layers, no round-robin. |
| Testing | 92 | 143 tests, offline render proof, spectral analysis, choke-group proof. |
| Documentation | 85 | README, INTEGRATION-GUIDE, CONTRIBUTING, COMPETITIVE-ANALYSIS, JSDoc. |
| Licensing | 100 | MIT + provenance-enforced loading + CC0 samples. Was 0 (no LICENSE). |
| Packaging | 80 | UMD bundle exists; not npm-published; foundation still shimmed. |

**Remaining gap to 100: 22 points across 5 workstreams.**

---

## Workstream A — Audio Fidelity (75 → 100) · +12 points

The biggest quality gap vs Kontakt/Ableton. Pitched playback still aliases; the
sample set is thin.

### A1. Oversampled playback (HQI mode) · +5
- Wrap `AudioBufferSourceNode` in an oversampling stage: render the source at
  2×/4× the destination rate via a throwaway `OfflineAudioContext`, then play
  back at the destination rate with a steep lowpass.
- Kontakt calls this "HQI Perfect" (sinc interpolation). Our current lowpass is
  a cheap proxy; oversampling is the real fix.
- **Effort:** 2 days. **Risk:** CPU cost on mobile.

### A2. Velocity layers in the manifest schema · +4
- Extend `SampleManifestEntry` with `velocityLayers: { range: [number, number]; sampleId: string }[]`.
- SelectionPolicy picks the layer whose range contains the event velocity.
- Eliminates machine-gunning (same hit repeated sounds identical today).
- **Effort:** 1 day (schema + selector) + sample acquisition.

### A3. Round-robin variants · +3
- `roundRobin: number` per manifest entry. SelectionPolicy cycles through N
  variants for the same (role, phraseIndex) to add human variation.
- Distinct from velocity layers (which are velocity-driven) and from the
  existing variant rotation (which is phrase-locked).
- **Effort:** 0.5 day.

---

## Workstream B — FX Breadth (55 → 95) · +8 points

A drum sampler with only delay + reverb can't shape a mix. Every competitor has
per-bus EQ + a filter + saturation.

### B1. Per-bus 3-band EQ · +3
- Add `lowShelf` + `peaking` + `highShelf` BiquadFilters per bus, exposed via
  `AudioGraph.setBusEQ(name, { low, mid, high })`.
- UI: 3 small knobs per bus in the Mixer panel.
- **Effort:** 0.5 day.

### B2. Master filter (with envelope) · +3
- A resonant lowpass/highpass on the master chain, optionally modulated by the
  sidechain (auto-filter pump). This is the psytrance "filter sweep" sound.
- **Effort:** 1 day.

### B3. Saturation / waveshaper · +2
- A `WaveShaperNode` with a soft-clip curve on the drum bus. Adds harmonics
  without a full multiband disto. Cheap, high impact.
- **Effort:** 0.5 day.

---

## Workstream C — Sample Library Depth (60 → 95) · +5 points

19 procedural samples is a demo, not a product.

### C1. Curated commercial sample pack · +3
- Acquire/CC0 a 80–120 sample pack covering all 9 roles with 3–5 variants each.
- Every sample MUST pass provenance validation (already enforced).
- **Effort:** 2 days (curation + manifest generation).

### C2. Sample import UI · +2
- Drag-and-drop WAV import that computes features (peak/RMS/duration) and writes
  a provenance prompt (user must assert the license before it loads).
- **Effort:** 1 day.

---

## Workstream D — Packaging & Foundation (80 → 100) · +5 points

### D1. Publish to npm as `@psy-family/sampler` · +3
- Removes the foundation shim (replace with `@psy-foundation/dsp` + `@psy-foundation/music`).
- Enables `import { createSamplerDevice } from '@psy-family/sampler'` in any repo.
- **Blocker:** foundation owner must publish first OR move to a monorepo.
- **Effort:** 0.5 day once unblocked.

### D2. Remove the foundation shim · +2
- Delete `src/psy-foundation-shim/`, swap all imports to the real package.
- The shim-sync test already guards byte-equivalence.
- **Effort:** 0.5 day. **Unblocked by D1.**

---

## Workstream E — UX Polish (already strong, +2 points)

### E1. Per-step velocity editor · +2
- Replace the binary on/off pattern grid with velocity cells (0–127).
- The director already sends velocity; the UI just needs a velocity dimension.
- Pattern schema: `Record<SampleRole, number[]>` (0 = off, 1–127 = velocity).
- **Effort:** 1 day (UI + persistence migration).

---

## Sequencing

```
Phase 1 (DONE — this session):
  ✓ Reverb determinism        (was breaking the core USP)
  ✓ Voice per-trigger chain   (bus bleed on steal)
  ✓ parseChannel validation   (silent drum-bus routing of junk)
  ✓ Choke groups              (hat-closed → hat-open, #1 competitive gap)
  ✓ Anti-alias lowpass        (pitched-up aliasing)
  ✓ Offline WAV render        (deterministic, faster-than-real-time)
  ✓ LICENSE                   (legal blocker)
  ✓ Competitive analysis      (COMPETITIVE-ANALYSIS.md)
  ✓ 17 new proof tests        (143 total, 0 fail)

Phase 2 (next): Audio Fidelity
  → A2 velocity layers + A3 round-robin (schema + selector, no new audio nodes)
  → B1 per-bus EQ + B3 saturation (cheap, high impact)

Phase 3: FX + UX
  → B2 master filter with envelope
  → E1 per-step velocity editor

Phase 4: Library
  → C1 curated sample pack
  → C2 import UI

Phase 5 (blocked): Packaging
  → D1 npm publish (needs foundation publish or monorepo)
  → D2 remove shim

Phase 6 (stretch): HQI
  → A1 oversampled playback (CPU-heavy, last)
```

---

## What "Done" Looks Like

- **Determinism:** two offline renders of the same arrangement produce
  byte-identical WAVs. Proven by an automated test (not asserted).
- **Audio quality:** a side-by-side blind A/B against a Kontakt-rendered loop
  is indistinguishable to a non-expert. No aliasing, no machine-gunning, full
  frequency control.
- **Architecture:** the device still publishes zero events. The contract is
  unchanged. Every new feature is HOW, never WHAT.
- **Competitive position:** PSY Sampler is the only web sampler that is
  simultaneously (a) event-driven via a formal device contract, (b) seeded-
  deterministic end-to-end, and (c) provenance-safe. That triangle is the moat.
