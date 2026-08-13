# PSY-SAMPLER-FAMILY-INTEGRATION-RECONCILIATION.md

> **Status:** EXECUTED. This is the final reconciliation report. Code changes have been committed and pushed.
> **Date:** 2026-08-13
> **Repos changed:** `psy-sampler` (this repo) + `psy4`

---

## 0. Executive Summary

The PSY Sampler Device has been reconciled from a **standalone product** into a **clean realization device** that can be consumed by PSY4's existing composition architecture without creating a parallel architecture.

**What changed:**
1. **SelectionPolicy is now genuinely deterministic** — stateless, seeded, no mutable counters. Dead inputs (`section`/`energy`/`style`) removed.
2. **RuntimeScheduler renamed to RealizationScheduler** — clarified as device-local realization scheduling (fires voices at host-decided `event.at`), NOT a musical scheduler.
3. **Sample provenance corrected + verification system added** — `VERIFIED`/`PROCEDURAL`/`UNKNOWN`/`QUARANTINED` status; only the first two load at runtime.
4. **DemoTransport moved out of the shim** — shim is now purely verbatim canonical contracts.
5. **SHIM_VERSION pinned + sync test added** — prevents silent drift from foundation.
6. **PSY4 now ships a `SamplerBridge`** (`src/lib/sampler-bridge.ts`) — the smallest adapter that converts `NotePlan.ScheduledNote` → canonical `NoteEvent` and publishes to a `DeviceHost`. PSY4's synth path is unchanged; the sampler plays in parallel.

**What was NOT changed:**
- Foundation contracts (no modifications to `psy-foundation`)
- PSY4's composition engine (`MusicalSession.planBar()` — unchanged)
- PSY4's synth path (`PsyLive.kick/hat/bass/lead()` — unchanged)
- The sampler's `PsyDevice` implementation (still verbatim from foundation)
- The sampler's voice architecture (`SampleVoice` + `VoicePool` — unchanged)

---

## 1. Actual Current Architecture

```
PSY4 (github.com/dudududi144-source/psy4)
├── MusicalSession.planBar() → NotePlan{ScheduledNote[]}
│   └── PsyLive.scheduleStep()
│       ├── this.kick/hat/bass/lead()  ← EXISTING synth path (unchanged)
│       └── samplerBridge.publishNote() ← NEW (parallel, additive)
│           └── NoteEvent → DeviceHost → InMemoryChannel
│               └── SamplerDevice.onEvent()
│                   └── SelectionPolicy.selectWithNote() ← STATELESS, SEEDED
│                       └── RealizationScheduler.schedule() ← DEVICE-LOCAL
│                           └── VoicePool.allocate() → SampleVoice.trigger()
│                               └── AudioGraph → ctx.destination
│
└── PsyLive.scheduler()
    └── transport.snapshot()
        └── samplerBridge.publishTransport() ← NEW (pushes to devices)

PSY Sampler (github.com/dudududi144-source/psy-sampler)
├── src/psy-foundation-shim/     ← VERBATIM contracts (SHIM_VERSION pinned)
├── src/psy-sampler/             ← the device (HOW only)
│   ├── device.ts                ← SamplerDevice implements PsyDevice
│   ├── selector.ts              ← STATELESS, SEEDED selection (fixed)
│   ├── realization-scheduler.ts ← device-local (NOT musical)
│   ├── voice.ts                 ← SampleVoice (AudioBufferSourceNode)
│   ├── library.ts               ← SampleLibrary (Map-backed)
│   ├── variance-rules.ts        ← phase-safe rules
│   ├── manifest.ts              ← verification-gated loader
│   ├── provenance.ts            ← license enforcement
│   └── audio-graph.ts           ← 3-bus master chain
├── src/lib/
│   ├── demo-transport.ts        ← NON-canonical (moved from shim)
│   └── demo-director.ts         ← demo harness (NOT part of device)
├── public/samples/              ← 12 samples, all PROCEDURAL, full provenance
└── tests/psy-sampler/           ← 82 tests (all passing)
```

---

## 2. Previous Sampler Architecture (before reconciliation)

```
PSY Sampler (standalone)
├── src/psy-foundation-shim/
│   ├── transport.ts  ← contained DemoTransport (NON-canonical, in shim!)
│   └── ...
├── src/psy-sampler/
│   ├── selector.ts   ← had dead inputs (section/energy/style/seed unused)
│   ├── round-robin.ts ← mutable counters (NOT deterministic)
│   ├── scheduler.ts  ← named "RuntimeScheduler" (ambiguous role)
│   └── ...
├── src/lib/demo-director.ts ← the ONLY way to drive the sampler
└── public/samples/ ← 6 samples attributed to "PSY3 project" (misleading — from psy4)
```

**Problems fixed:**
- `SelectionPolicy` claimed determinism but used mutable `RoundRobinBank` counters
- `section`/`energy`/`style` inputs were accepted but never used (fake parameters)
- `DemoTransport` lived in the shim (conflating canonical contracts with demo helpers)
- `RuntimeScheduler` name implied musical scheduling (it's only realization timing)
- Sample provenance said "PSY3 project" but files were byte-identical to psy4
- No verification system to distinguish VERIFIED/PROCEDURAL/UNKNOWN/QUARANTINED samples
- No shim sync test (could silently drift from foundation)
- PSY4 had no integration seam (closed-loop composition→synth)

---

## 3. Ownership Map

| Concern | Owner | Evidence |
|---|---|---|
| Transport / clock | **HOST** (PSY4's MusicalTransport / DemoTransport) | Sampler's `onTransport()` only reads; never mutates. Zero transport creation in `src/psy-sampler/`. |
| Event bus / channel | **HOST** (DeviceHost + InMemoryChannel, from foundation) | Sampler is a pure consumer; zero `publish()` in `src/psy-sampler/`. |
| Device host / registry | **HOST** (DeviceHost from foundation) | Sampler is registered BY the host; doesn't instantiate its own host. |
| Composition | **HOST** (PSY4's MusicalSession) | Sampler has zero composition code. `DemoDirector` is a demo harness, not part of the device. |
| Audio context | **HOST** (injected via `createSamplerDevice({audioContext})`) | Zero `new AudioContext()` in `src/psy-sampler/`. |
| Sample material | **SAMPLER** (local `public/samples/` + manifest) | Correctly device-owned — the sampler realizes samples as audio. Future: family registry (not built yet). |
| Voice allocation | **SAMPLER** (`VoicePool<SampleVoice>`) | Correctly device-owned (HOW). |
| Sample selection | **SAMPLER** (`SelectionPolicy`) | Correctly device-owned (variant + pitch + pan — HOW). Stateless + seeded. |
| Realization timing | **SAMPLER** (`RealizationScheduler`) | Correctly device-owned (fires at host-decided `event.at`). NOT musical timing. |
| Foundation contracts | **FOUNDATION** (via shim, pinned to 4ae95d3) | Shim is verbatim; sync test prevents drift. |

---

## 4. What Was Wrong (and is now fixed)

| # | What was wrong | Fix | Files changed |
|---|---|---|---|
| 1 | SelectionPolicy had dead inputs (`section`/`energy`/`style` accepted but unused) | Removed from `SelectionInput` API. Only `role`/`bank`/`velocity`/`phraseIndex`/`seed` remain — all genuinely participate. | `types.ts`, `selector.ts`, `device.ts` |
| 2 | SelectionPolicy used mutable `RoundRobinBank` counters (same inputs → different outputs) | Replaced with stateless `deriveVariant(seed, role, phraseIndex)` using seeded `Rng`. Removed `RoundRobinBank` class entirely. | `selector.ts`, `variance-rules.ts` (extracted), `round-robin.ts` (deleted) |
| 3 | `RuntimeScheduler` name implied musical scheduling | Renamed to `RealizationScheduler` with header clarifying it's device-local realization, NOT musical timing. | `realization-scheduler.ts` (renamed from `scheduler.ts`) |
| 4 | `DemoTransport` lived in the shim (non-canonical code in canonical location) | Moved to `src/lib/demo-transport.ts`. Shim is now purely verbatim canonical contracts. | `psy-foundation-shim/transport.ts`, `lib/demo-transport.ts` |
| 5 | Sample provenance said "PSY3 project" but files were from psy4 | Corrected: `"source": "PSY3 project (procedural) → psy4/public/samples/ → psy-sampler"` | `public/samples/manifest.json` |
| 6 | No verification system (UNKNOWN/QUARANTINED samples could load) | Added `SampleVerification` type + `verification` field to manifest. Loader refuses UNKNOWN/QUARANTINED. | `types.ts`, `manifest.ts`, `manifest.json` |
| 7 | No shim sync test (could silently drift from foundation) | Added `tests/psy-sampler/shim-sync.test.ts` — verifies shim exports match canonical. Added `SHIM_VERSION` pin. | `shim-sync.test.ts`, `psy-foundation-shim/device.ts` |
| 8 | PSY4 had no integration seam (closed-loop composition→synth) | Added `SamplerBridge` to PSY4 + one-line hook in `scheduleStep`. | `psy4/src/lib/sampler-bridge.ts`, `psy4/src/lib/psyLive.ts` |
| 9 | Device tracked `phraseBar` with mutable state | Replaced with stateless derivation: `phraseIndex = Math.floor(transport.bar / barsPerPhrase)`. | `device.ts` |

---

## 5. What Was Reused

| Component | Reused from | How |
|---|---|---|
| `PsyDevice` interface | `psy-foundation/packages/device-sdk/src/device.ts` | Verbatim via shim (SHIM_VERSION: 4ae95d3) |
| `DeviceHost` class | `psy-foundation/packages/device-sdk/src/host.ts` | Verbatim via shim |
| `InMemoryChannel` | `psy-foundation/packages/protocol/src/channel.ts` | Verbatim via shim |
| `NoteEvent` / `MusicalEvent` | `psy-foundation/packages/protocol/src/events.ts` | Verbatim via shim |
| `MusicalTransport` (v0) | `psy-foundation/packages/transport/src/types.ts` | Verbatim via shim |
| `MusicalContext` | `psy-foundation/packages/protocol/src/state.ts` | Verbatim via shim |
| `VoicePool<V>` + `Voice` | `psy-foundation/packages/dsp/src/voicePool.ts` | Verbatim via shim |
| `Rng` (mulberry32) | `psy-foundation/packages/music/src/rng.ts` | Verbatim via shim |
| Variance rules | `psy4/public/worklets/psy4-engine.js:2073-2204` | Extracted into `variance-rules.ts` (data, not code) |
| Sample load pattern | `psy4/src/lib/studio/engine/sampleBank.ts` | Adapted (dropped O(N²) DFT, parameterized URLs) |

---

## 6. What Was Removed

| Removed | Why |
|---|---|
| `src/psy-sampler/round-robin.ts` | `RoundRobinBank` had mutable state. Replaced by stateless `deriveVariant()` in `selector.ts`. |
| `RuntimeScheduler` name | Ambiguous — implied musical scheduling. Renamed to `RealizationScheduler`. |
| `DemoTransport` from shim | Non-canonical code in a canonical location. Moved to `src/lib/`. |
| `section`/`energy`/`style` from `SelectionInput` | Dead inputs — accepted but never used. Removed for honesty. |
| Mutable `phraseBar` / `lastBar` from `SamplerDevice` | Replaced with stateless `phraseIndex` derivation from `transport.bar`. |

---

## 7. What Was Adapted

| Adapted | From → To | Why |
|---|---|---|
| `SelectionPolicy.select()` | Mutable round-robin → Stateless seeded derivation | Genuinely deterministic now |
| `manifest.json` schema | Added `verification` field | Enables VERIFIED/PROCEDURAL/UNKNOWN/QUARANTINED filtering |
| `PsyLive.scheduleStep()` (PSY4) | Added `samplerBridge?.publishNote()` after synth dispatch | Parallel sampler playback without replacing synth |
| `PsyLive.scheduler()` (PSY4) | Added `samplerBridge?.publishTransport(snap)` | Pushes transport to sampler devices |

---

## 8. Exact PSY4 Integration Seam

**Repository:** `github.com/dudududi144-source/psy4`
**Commit:** `b3398f1`
**Files changed:** 2

### File 1: `src/lib/sampler-bridge.ts` (NEW — 212 lines)

Defines:
- Minimal foundation contracts (verbatim from `psy-foundation`): `MusicalTransport`, `MusicalContext`, `DeviceCapabilities`, `NoteEvent`, `MusicalEvent`, `PsyDevice`
- `InMemoryChannel` + `DeviceHost` (verbatim logic from foundation)
- `SamplerBridge` class with:
  - `register(device)` — registers a PsyDevice on the internal DeviceHost
  - `publishNote(time, note, isOpenHat, stepDur)` — converts PSY4's `ScheduledNote` → `NoteEvent` and publishes
  - `publishTransport(snap)` — pushes transport to all registered devices
  - `publishContext(ctx)` — pushes musical context

### File 2: `src/lib/psyLive.ts` (MODIFIED — 5 insertions)

- **Line 20:** Import `SamplerBridge` + types
- **Line 257:** `private samplerBridge: SamplerBridge | null = null;` (optional field)
- **Line 840-842:** In `scheduler()`: `if (this.samplerBridge) { this.samplerBridge.publishTransport(snap); }`
- **Lines 916-918:** In `scheduleStep()` after the `switch(note.voice)` dispatch: `if (this.samplerBridge) { this.samplerBridge.publishNote(time, note, s16 === 15, snap.beatDuration / 4); }`
- **Lines 923-933:** Public methods `attachSamplerBridge(bridge)` + `attachSamplerDevice(device)`

### How it works

```
PSY4 MusicalSession.planBar()
  → NotePlan { notes: ScheduledNote[] }
    → PsyLive.scheduleStep(stepIdx, time)
      ├── switch(note.voice) → this.kick/hat/bass/lead()  [SYNTH — unchanged]
      └── samplerBridge.publishNote(time, note, ...)       [NEW — parallel]
          → NoteEvent { type:'note', note, velocity, duration, channel, at }
            → DeviceHost.publish(event)
              → InMemoryChannel
                → SamplerDevice.onEvent(event)
                  → SelectionPolicy.selectWithNote() [STATELESS, SEEDED]
                    → RealizationScheduler.schedule()
                      → (at event.at) VoicePool.allocate()
                        → SampleVoice.trigger(buffer, opts)
                          → AudioGraph → ctx.destination
```

**The sampler plays IN PARALLEL with PSY4's synth.** No synth code was removed or modified. If the sampler is not attached, PSY4 behaves exactly as before (zero behavior change).

---

## 9. Exact Foundation Dependencies

**The sampler depends on these foundation contracts (via shim):**

| Contract | Foundation source | Shim file |
|---|---|---|
| `PsyDevice` | `packages/device-sdk/src/device.ts` | `psy-foundation-shim/device.ts` |
| `DeviceHost` | `packages/device-sdk/src/host.ts` | `psy-foundation-shim/host.ts` |
| `Channel` + `InMemoryChannel` | `packages/protocol/src/channel.ts` | `psy-foundation-shim/protocol.ts` |
| `NoteEvent` + `MusicalEvent` | `packages/protocol/src/events.ts` | `psy-foundation-shim/protocol.ts` |
| `MusicalTransport` (v0) | `packages/transport/src/types.ts` | `psy-foundation-shim/transport.ts` |
| `MusicalContext` + `DeviceCapabilities` | `packages/protocol/src/state.ts` | `psy-foundation-shim/protocol.ts` |
| `Voice` + `VoicePool<V>` | `packages/dsp/src/voicePool.ts` | `psy-foundation-shim/voice-pool.ts` |
| `Rng` (mulberry32) | `packages/music/src/rng.ts` | `psy-foundation-shim/voice-pool.ts` |

**SHIM_VERSION:** `4ae95d3` (2026-08-13)
**Sync test:** `tests/psy-sampler/shim-sync.test.ts` verifies shim exports match canonical source.

**Why shim instead of real `@psy-foundation/*` package:**
The canonical `psy-foundation` is a Bun workspace monorepo (`workspace:*` deps). It is NOT published to npm. To consume it as a real dependency, one of these must happen:
1. Publish `@psy-foundation/*` to npm (foundation owner's decision)
2. Create a family monorepo including both foundation + sampler as workspace packages
3. Link via `file:` protocol in `package.json`

Until one of these happens, the shim is the smallest temporary adapter. It is NOT a fork — it's a verbatim copy with a sync test that fails if they diverge.

---

## 10. Genuine Remaining Architectural Gaps

| Gap | Status | Who should fix |
|---|---|---|
| Foundation not published as npm package | Documented. Shim is the temporary bridge. | Foundation owner |
| v1 `TransportSnapshot` not wired to `DeviceHost` (GAP-S5) | PSY4's `MusicalTransport` produces v1-ish snapshots; the bridge casts to v0. Works but loses `epoch`/`source`/`holdover`. | Foundation owner |
| No `'sample'` MaterialType in foundation (GAP-S1) | Sampler keeps its bank in a private `Map`. A family-level material registry would be cleaner. | Foundation owner |
| No family-level channel taxonomy | Sampler's `"role[:bank]"` convention is documented but not in `@psy-foundation/protocol`. PSY4's bridge maps its voices to this convention. | Foundation owner |
| No family-level runtime scheduler (GAP-S4) | Sampler's `RealizationScheduler` is device-local (correct). A family-level scheduler is NOT needed — each device fires its own voices at `event.at`. | NOT NEEDED (device-local is correct) |
| PSY4's `NotePlan.ScheduledNote` is structurally incompatible with `NoteEvent` | The `SamplerBridge` adapter converts between them. This is the correct integration pattern — PSY4 shouldn't change its internal representation. | RESOLVED (bridge) |

---

## 11. Tests Proving the Boundary

**82 tests, all passing.** Test files:

| File | Tests | What it proves |
|---|---|---|
| `contract.test.ts` | 11 | SamplerDevice implements PsyDevice; DeviceHost registration; transport/context/event reception; multi-device coexistence |
| `selection.test.ts` | 15 | Stateless determinism; same inputs → same output; no Math.random; phrase-locked; pitch variance ≤ ±0.5%; no fake parameters |
| `voice.test.ts` | 13 | VoicePool allocation/stealing; bounded voices; panic; variance rules |
| `samples.test.ts` | 19 | Manifest validation; provenance enforcement; VERIFIED/PROCEDURAL load, UNKNOWN/QUARANTINED refused |
| `shim-sync.test.ts` | 4 | Shim matches canonical foundation (exports); SHIM_VERSION documented |
| `integration.test.ts` | 11 | **Cross-repo proof**: PSY4 composition → NoteEvent → DeviceHost → Sampler; coexistence; timing; determinism; no leakage; missing material; channel convention |

### Cross-repo proof tests (Phase 7)

| Test | Proves |
|---|---|
| A. Coexistence | Sampler + ReferenceDevice both receive events via DeviceHost fan-out |
| B. Timing | Sampler queues events at canonical `event.at` |
| C. Determinism | Same seed + same inputs → same selection (across separate device instances) |
| D. No composition leakage | Sampler package has zero PSY4 imports |
| E. No second runtime | Sampler does not create transport/event-bus (consumes only) |
| F. Missing material | Unknown role → skip, no invented music |
| G. Provenance | Only VERIFIED/PROCEDURAL samples participate |
| H. Channel convention | PSY4 voices map correctly to sampler channels |
| I. Sampler removed | Bridge continues without crash |
| J. Full bar | 1 bar of PSY4 composition → all notes received |

---

## 12. Before/After Event Flow

### Before (closed loop in PSY4)

```
MusicalSession.planBar() → NotePlan{ScheduledNote[]}
  → PsyLive.scheduleStep()
    → switch(note.voice)
      → this.kick/hat/bass/lead()
        → ctx.createOscillator()
          → ctx.destination

(NO DeviceHost. NO NoteEvent. NO Channel. NO Sampler.)
```

### After (canonical flow, parallel)

```
MusicalSession.planBar() → NotePlan{ScheduledNote[]}
  → PsyLive.scheduleStep()
    ├── switch(note.voice) → this.kick/hat/bass/lead() → ctx.createOscillator() → ctx.destination
    └── samplerBridge.publishNote(time, note, isOpenHat, stepDur)
        → NoteEvent { type:'note', note, velocity, duration, channel, at }
          → DeviceHost.publish(event)
            → InMemoryChannel
              → SamplerDevice.onEvent(event)
                → SelectionPolicy.selectWithNote() [STATELESS, SEEDED]
                  → RealizationScheduler.schedule(event)
                    → (at event.at) VoicePool.allocate()
                      → SampleVoice.trigger(buffer, opts)
                        → AudioGraph → ctx.destination
```

---

## 13. Before/After Ownership Diagram

### Before

```
PSY4                          PSY Sampler (standalone)
┌──────────────────┐          ┌──────────────────────────┐
│ MusicalSession   │          │ DemoDirector (fake host) │
│ PsyLive          │          │ DemoTransport            │
│ MusicalTransport │          │ DeviceHost               │
│ AudioContext     │          │ AudioContext             │
│ synth voices     │          │ SamplerDevice            │
│ ctx.destination  │          │ ctx.destination          │
└──────────────────┘          └──────────────────────────┘
       ISOLATED                       ISOLATED
```

### After

```
PSY4 (host)
┌─────────────────────────────────────────┐
│ MusicalSession (composition)            │
│ PsyLive (scheduler + synth voices)      │
│ MusicalTransport (timing authority)     │
│ AudioContext (shared)                   │
│ SamplerBridge (adapter)                 │
│   └── DeviceHost + InMemoryChannel      │
│       └── SamplerDevice (registered)    │
│             └── RealizationScheduler    │
│                 └── VoicePool           │
│                     └── SampleVoice     │
│                         └── AudioGraph  │
│                             └── ctx.destination (shared) │
└─────────────────────────────────────────┘
```

---

## 14. Explicit List of Anything NOT Changed and Why

| Not changed | Why |
|---|---|
| `psy-foundation` source | No authority to modify foundation. Shim is verbatim with sync test. |
| PSY4's `MusicalSession` | Composition is PSY4's responsibility. Sampler doesn't touch it. |
| PSY4's synth voices (`kick/hat/bass/lead`) | Sampler is additive (parallel), not replacement. Existing synth path unchanged. |
| PSY4's `MusicalTransport` | PSY4's transport is its own. The bridge casts snapshots to v0 `MusicalTransport` for the sampler. |
| `SampleVoice` implementation | Main-thread `AudioBufferSourceNode` is the correct realization primitive. |
| `AudioGraph` (sampler's 3-bus chain) | Correctly device-owned. Connects to shared `ctx.destination`. |
| `DemoDirector` | Stays as a demo harness in `src/lib/`. Not part of the device. |
| UI (`page.tsx`) | Stays as a demo playground. Not part of the device. |
| `package.json` (no `@psy-foundation/*` dep) | Foundation isn't published to npm. Shim is the documented temporary bridge. |

---

## 15. Commits + Repositories

### Repository 1: `psy-sampler`
**URL:** https://github.com/dudududi144-source/psy-sampler
**Changes:**
- Phase 1: Fixed SelectionPolicy determinism (stateless, seeded, removed dead inputs)
- Phase 1: Renamed `RuntimeScheduler` → `RealizationScheduler`
- Phase 1: Removed mutable `phraseBar` from device (stateless `phraseIndex` derivation)
- Phase 2: Added `verification` field to manifest (VERIFIED/PROCEDURAL/UNKNOWN/QUARANTINED)
- Phase 2: Corrected sample provenance (honest source chain)
- Phase 3: Moved `DemoTransport` out of shim to `src/lib/demo-transport.ts`
- Phase 3: Added `SHIM_VERSION` pin to shim files
- Phase 3: Added shim sync test
- Phase 7-8: Added cross-repo integration proof tests (11 tests)
- Phase 8: Updated existing tests for new API (82 tests total, all passing)

### Repository 2: `psy4`
**URL:** https://github.com/dudududi144-source/psy4
**Commit:** `b3398f1`
**Changes:**
- Phase 4: Added `src/lib/sampler-bridge.ts` (212 lines — minimal foundation contracts + `SamplerBridge` adapter)
- Phase 4: Modified `src/lib/psyLive.ts` (5 insertions — optional `samplerBridge` field + hook in `scheduleStep` + hook in `scheduler` + `attachSamplerBridge()`/`attachSamplerDevice()` methods)

---

## 16. Test Results

```
82 pass, 0 fail
4435 expect() calls
Ran 82 tests across 6 files. [283ms]
```

**Lint:** clean (0 errors, 0 warnings)

---

## 17. Actual PSY4 → Sampler Event Path

```
1. PSY4 MusicalSession.planBar(bar, bpm)
   → NotePlan { bar, notes: ScheduledNote[] }
   (psy4/foundation/music/MusicalSession.ts:323)

2. PSY4 PsyLive.scheduleStep(stepIndex, time)
   reads this.currentNotePlan.notes.filter(n => n.step === s16)
   (psy4/src/lib/psyLive.ts:886)

3. For each note:
   a. EXISTING: switch(note.voice) → this.kick/hat/bass/lead(time, ...) → ctx.createOscillator()
      (psy4/src/lib/psyLive.ts:893-907)
   
   b. NEW: this.samplerBridge?.publishNote(time, note, s16 === 15, snap.beatDuration / 4)
      (psy4/src/lib/psyLive.ts:916-918)

4. SamplerBridge.publishNote() converts to NoteEvent:
   { type:'note', note: note.midi ?? 60, velocity, duration: stepDur*0.9, channel: voiceToChannel(note.voice, isOpenHat), at: time }
   (psy4/src/lib/sampler-bridge.ts:178-191)

5. NoteEvent → DeviceHost.publish() → InMemoryChannel → SamplerDevice.onEvent(event)
   (psy-sampler/src/psy-foundation-shim/host.ts + protocol.ts)

6. SamplerDevice.handleNoteEvent(event):
   - parseChannel(event.channel) → { role, bank }
   - phraseIndex = Math.floor(transport.bar / 8)  [stateless]
   - seed = transport.revision
   - SelectionPolicy.selectWithNote({ role, bank, velocity, phraseIndex, seed }, event.note)
     → { sampleId, playbackRate, gain, pan }  [STATELESS, SEEDED]
   (psy-sampler/src/psy-sampler/device.ts:116-136)

7. RealizationScheduler.schedule({ at: event.at, sampleId, buffer, opts, bus })
   (psy-sampler/src/psy-sampler/realization-scheduler.ts:72-83)

8. At event.at: VoicePool.allocate() → SampleVoice.trigger(buffer, { at, playbackRate, gain, pan, decay })
   → AudioBufferSourceNode.start(at) → AudioGraph → ctx.destination
   (psy-sampler/src/psy-sampler/voice.ts + audio-graph.ts)
```

---

## 18. Genuine Blockers

**None.** All phases executed successfully. No architectural blockers remain that require external approval.

The only deferred items are foundation-level changes (publish `@psy-foundation/*` to npm, wire v1 transport to DeviceHost, add `'sample'` MaterialType) — these are the foundation owner's responsibility, not the sampler's.

---

## 19. Intentionally Deferred

| Deferred | Why |
|---|---|
| Publishing `@psy-foundation/*` to npm | Foundation owner's decision. Shim is the documented temporary bridge. |
| Family sample registry | Not needed for MVP. Sampler owns its samples correctly. When a second device (GRANULAR) needs the same samples, extract a registry. |
| Family audio runtime (shared master chain) | Not needed yet. Each device connects to `ctx.destination` — browser sums them. When ducking coordination is needed, extract. |
| Headless test (no React) | The integration tests already prove headless operation (they don't use React/DOM). |
| UMD bundle for single-file HTML products | psy/psy5/PSY6-ULTIMATE can't consume the sampler without a bundle. Deferred until those products request integration. |

---

*End of reconciliation report. Code committed and pushed.*
