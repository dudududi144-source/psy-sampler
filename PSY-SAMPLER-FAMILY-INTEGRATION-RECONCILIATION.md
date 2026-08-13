# PSY-SAMPLER-FAMILY-INTEGRATION-RECONCILIATION.md

> **Status:** Research-only deliverable. NO code changes. NO implementation. Produced in response to the HARD RESET directive.
> **Evidence base:** Actual source code read across all 7 codebases (6 cloned PSY repos + the psy-sampler I built). Prior audit reports were verified against code, not trusted.
> **Verdict:** **CONDITIONAL GO** — see §22.

---

## 0. Executive Summary

The PSY Sampler Device I built is **architecturally shaped like a Family Citizen but executionally still a Standalone Product**. It implements the canonical `PsyDevice` interface verbatim, consumes (never owns) transport/context/events, and proves multi-device coexistence on a `DeviceHost`. But the integration is not yet *real* in three load-bearing ways:

1. **The foundation is a compile-time fork, not a runtime dependency.** No `@psy-foundation/*` entry in `package.json`. The "shim" is a one-time verbatim copy that will silently drift from upstream. Headers are honest; the reality is a fork.

2. **No other PSY product can drive the Sampler today.** Verified by grep: none of psy / psy4 / psy5 / PSY6-ULTIMATE instantiates a `DeviceHost`, publishes a canonical `NoteEvent`, or exposes a `MusicalTransport` (v0) snapshot. The Sampler's only working host is my `DemoDirector` — a fake composer. The reverse direction (psy → sampler) is architecturally possible but requires host-side adapters + 3 pieces of missing family infrastructure that do not exist.

3. **Sample material, runtime scheduler, and the NoteEvent channel convention are Sampler-owned, not family-owned.** 6 of 12 WAVs are byte-identical to `psy4/public/samples/`. The `RuntimeScheduler` reinvents a pattern duplicated 7+ times across the family. The `"role[:bank]"` channel convention is Sampler-specific — no family-level channel taxonomy exists in `@psy-foundation/protocol`.

The critical finding from the composition-flow audit (F2): **PSY4's composition→sound path is a closed loop inside the `PsyLive` class** (`MusicalSession.planBar()` → `NotePlan{ScheduledNote[]}` → `PsyLive.kick/hat/bass/lead()` → `ctx.createOscillator()`). There is no `DeviceHost.publish(NoteEvent)` hop anywhere. The composer's output type (`ScheduledNote = {step, voice, midi, velocity}`) is **structurally incompatible** with the canonical `NoteEvent` (`{type:'note', note, velocity, duration, channel, at}`). No adapter exists in any repo. The foundation's own `CompositionEngine.composeSection()` returns `ComposedSection` (per-bar step arrays), which is *also* incompatible with `NoteEvent` — and *also* has no adapter.

**The honest answer to "is the Sampler a Family Citizen?" is: not yet.** The shape is right. The wiring is not. This document names exactly what must change, in what order, with what risk, and what must NOT change.

---

## 1. Six-Repository Evidence Map

Each row is verified by reading actual source files (paths + line numbers cited throughout). Prior reports were cross-checked; where they conflicted with code, code wins and the conflict is noted.

| Repo | Runtime class | Has DeviceHost? | Publishes NoteEvents? | Has MusicalTransport? | AudioContext factory | Sample bank | Composition engine |
|---|---|---|---|---|---|---|---|
| **psy** | `Groovebox` (`index.html:735`) | ❌ NO | ❌ NO (calls `v.kick(t)` directly) | ❌ NO (raw `this.bpm` + `nextNoteTime`) | inline `new AC()` (`index.html:768`) | ❌ NONE (pure synth) | inline `buildSong()` + `scheduleStep()` |
| **psy3-clean** | `Groovebox` (`index.html:770`) fork of psy | ❌ NO | ❌ NO | ❌ NO | inline (`index.html:1891`) | ❌ NONE | fork of psy |
| **psy4** | `PsyLive` (`src/lib/psyLive.ts:166`) | ❌ NO | ❌ NO (calls `this.kick(time, vel)`) | ⚠️ YES but psy4-local `TransportSnapshot` (incompatible with shim v0 — GAP-S5) | inline (`psyLive.ts:343`) | ⚠️ `SampleBank` EXISTS but DEAD (`studio/engine/sampleBank.ts:41`, never called by live runtime); 141 WAVs in `public/samples/real/` with NO license metadata | `MusicalSession.planBar()` (`foundation/music/MusicalSession.ts:323`) |
| **psy5** | `PooledEngine` (`index.html:354`) + broken `playground/index.html` | ❌ NO | ❌ NO (calls `I.eng.trigger(tr, when, ev, sd)`) | ❌ NO | inline (`index.html:406`) + zombie in playground (`index.html:10`) | 16 WAVs in `samples/real/` (subset of psy4's 141); manifest has 12 phantom entries; worklet `SampleVoice` byte-identical to psy4's | inline `stepEvents()` + `buildStyle()` |
| **psy-foundation** | (headless library, no runtime) | ✅ Canonical `DeviceHost` (`packages/device-sdk/src/host.ts:15`) — but NEVER instantiated at runtime in ANY repo | ✅ Canonical `NoteEvent` (`packages/protocol/src/events.ts:28`) — but never published at runtime | ✅ Canonical v0 `MusicalTransport` + v1 `TransportSnapshot` — but v1 NOT wired to DeviceHost | (none — headless) | (none — `MaterialLibrary` has no `'sample'` kind) | ✅ Canonical `CompositionEngine.composeSection()` (`packages/music/src/composition-engine.ts:598`) — but output is `ComposedSection`, NOT `NoteEvent[]` |
| **PSY6-ULTIMATE** | module globals + `PooledEngine` (`index.html:726`) | ❌ NO | ❌ NO (calls `engine.triggerDrum/Synth`); DOES emit Web MIDI Note out (`index.html:949`) | ❌ NO | inline (`index.html:1038`) | ❌ NONE (pure synth) | inline `scheduleStep()` + `applyBestCandidate()` |
| **psy-sampler (mine)** | `SamplerDevice` (`src/psy-sampler/device.ts:47`) | ✅ **FIRST and ONLY** runtime instantiation (`src/app/page.tsx:241`) | ✅ consumes `NoteEvent` via `host.publish` | ⚠️ `DemoTransport` (shim, non-canonical, host-side) | injected via `createSamplerDevice({audioContext})` — does NOT create its own | `SampleLibrary` (`src/psy-sampler/library.ts:20`); 12 WAVs in `public/samples/` (6 byte-identical to psy4) | ❌ NONE (correctly — `DemoDirector` is host-side, not device-side) |

### Conflicts found between prior reports and actual code

| # | Prior report claim | Code reality | Resolution |
|---|---|---|---|
| 1 | "psy-sampler's SelectionPolicy is deterministic, context-aware, seeded" | `SelectionPolicy.select()` IGNORES `section`, `energy`, `style`, `seed` inputs. Uses mutable internal `RoundRobinBank` counters, not the seed. Calling `select()` twice with identical inputs produces DIFFERENT outputs (counter advances). | **Doc/code mismatch.** The "seed" field is theater. See §11 row 12. |
| 2 | "psy-sampler's 6 PSY3 samples are authored by 'PSY3 project'" | md5sum confirms the 6 WAVs are byte-identical to `psy4/public/samples/*.wav`. Attribution says PSY3 but source is psy4 repo. | **Misleading provenance.** See §11 row 7. |
| 3 | "Foundation's `subSeed`/`rngFor` is the canonical fork mechanism" | `subSeed`/`rngFor` exist ONLY in `psy/foundation/foundation.mjs` (P1 bundle) + `psy5/foundation/foundation.mjs`. The canonical `psy-foundation/packages/*` workspace does NOT export them. | **Prior report error.** Canonical foundation has no hierarchical RNG. |
| 4 | "PSY4 has a causal composition model with contrast debt" | `TensionState` + `expectation` + `repetitionPressure`/`noveltyPressure` ARE real (in canonical foundation + PSY4's local fork for tension). "contrast debt" = ZERO matches anywhere. | **Partially aspirational.** Tension is real; contrast debt is not implemented. |
| 5 | "psy-sampler's RuntimeScheduler fills GAP-S4 deterministically" | RuntimeScheduler IS deterministic in scheduling, but the SelectionPolicy that feeds it is NOT deterministic (internal mutable counters). The end-to-end determinism claim is broken at the selection layer. | **End-to-end determinism unproven.** |

---

## 2. Existing Family Services

Services that already exist somewhere in the family. "Canonical" = defined in `psy-foundation/packages/*`. "Duplicated" = copied elsewhere. "Invented by sampler" = exists only in my psy-sampler.

| Service | Canonical location | Duplicated? | Invented by sampler? | Sampler uses it? |
|---|---|---|---|---|
| `PsyDevice` interface | `psy-foundation/packages/device-sdk/src/device.ts:4-13` (13 LoC) | NO | NO | ✅ via shim (verbatim) |
| `DeviceHost` class | `psy-foundation/packages/device-sdk/src/host.ts:15-92` (92 LoC) | copied to psy5 (tests only) | NO | ✅ via shim (verbatim) — **FIRST runtime use in family** |
| `ReferenceDevice` stub | `psy-foundation/packages/device-sdk/src/reference.ts:10-82` | NO | NO (I wrote my own `ReferenceDeviceStub` in page.tsx) | ⚠️ parallel stub |
| `Channel` + `InMemoryChannel` | `psy-foundation/packages/protocol/src/channel.ts:6-42` | copied to psy5 (tests only) | NO | ✅ via shim (verbatim) — **FIRST runtime use in family** |
| `MusicalTransport` (v0) | `psy-foundation/packages/transport/src/types.ts:12-27` (13 fields) | YES — psy4 has incompatible `TransportSnapshot` (16 fields); psy5 has copy | NO (`DemoTransport` is non-canonical, host-side) | ✅ consumes v0 via `onTransport` |
| `Transport` (v1) + `TransportSnapshot` | `psy-foundation/packages/transport/src/v1-transport.ts:29-413` + `v1-types.ts:28-63` | NO | NO | ❌ NOT wired to DeviceHost (GAP-S5) |
| `TransportClock` (v0, deprecated) | `psy-foundation/packages/transport/src/transport.ts:26-160` | copied to psy5 | NO | ❌ not used (DemoTransport replaces it) |
| `MusicalContext` | `psy-foundation/packages/protocol/src/state.ts:11-19` (7 fields) | divergent richer copy in `psy-foundation/packages/music/src/musical-context.ts:10-41` (14 fields, internal) | NO | ✅ consumes via `onContext` |
| `DeviceCapabilities` | `psy-foundation/packages/protocol/src/state.ts:21-29` (7 fields, `roles: string[]` free-form) | NO | NO | ✅ returns `{audio:true, roles:['sampler']}` |
| `MusicalEvent` union (6 variants) | `psy-foundation/packages/protocol/src/events.ts:43-49` | NO | NO | ✅ consumes `NoteEvent` |
| `NoteEvent` | `psy-foundation/packages/protocol/src/events.ts:28-35` (`{type:'note', note, velocity, duration, channel, at}`) | NO | NO | ✅ consumes — but channel convention `"role[:bank]"` is Sampler-invented (see §11 row 4) |
| `MaterialLibrary` | `psy-foundation/packages/material/src/material.ts:79-165` | copied to psy5 (tests only) | NO | ❌ NOT used — sampler builds parallel `SampleLibrary` |
| `MaterialType` (9 kinds) | `psy-foundation/packages/protocol/src/state.ts:42-51` | NO | NO | ❌ NO `'sample'` kind exists (GAP-S1) |
| `Voice` + `VoicePool<V>` | `psy-foundation/packages/dsp/src/voicePool.ts:12-89` | NO | NO | ✅ via shim (verbatim) |
| `Rng` (mulberry32) | 3 canonical copies: `packages/scheduler/src/rng.ts`, `packages/fixtures/src/rng.ts`, `packages/music/src/rng.ts` (different APIs!) | 14+ copies total across family (9 class + 5 inline) | NO | ✅ via shim (verbatim from music's copy) |
| `schedule(plan, opts)` (OFFLINE) | `psy-foundation/packages/scheduler/src/scheduler.ts:18-111` (pure function) | NO | NO | ❌ NOT used — sampler builds its own `RuntimeScheduler` (GAP-S4) |
| `CompositionEngine.composeSection()` | `psy-foundation/packages/music/src/composition-engine.ts:598` (returns `ComposedSection`) | copied to psy5 (tests only) | NO | ❌ NOT used — returns `ComposedSection` which is incompatible with `NoteEvent` (no adapter exists) |
| Audio graph (master → comp → analyser → destination + buses) | (none canonical) | 8 instances across family | `AudioGraph` (`src/psy-sampler/audio-graph.ts:24`) | ✅ own (matches psy5 PooledEngine shape) |
| Lookahead scheduler (25ms Worker + ctx.currentTime horizon) | (none canonical — foundation is offline-only) | 7+ near-duplicate implementations (psy/psy3/PSY6/psy5/psy4/sampler/DemoDirector) | `RuntimeScheduler` (`src/psy-sampler/scheduler.ts:37`) | ✅ own (5th reinvention of the pattern) |
| Sample loader (fetch + decodeAudioData) | (none canonical) | psy4 `SampleBank` (dead) + psy4 validation `sample-bank.ts` (Node fs) | `SampleLoader` (`src/psy-sampler/loader.ts:10`, adapted from psy4) | ✅ own |
| Sample manifest (rich provenance) | (none canonical) | psy4 `SAMPLE_MANIFEST.json` (6 PSY3 samples only); psy4/psy5 `manifest.json` (no license) | `public/samples/manifest.json` (12 entries, full provenance) | ✅ own (schema extended from psy4) |
| Persistence (localStorage) | (none canonical) | 5+ namespace conventions (`psy6_*`, `STORAGE_KEY`, `K_TMP/K_MAIN`, `psy-live-learn-v2`, `psy4_*`) | ❌ NONE (planned `psy-sampler:*`, not implemented) | ❌ |

---

## 3. Ownership Matrix

Who owns what in the PSY family today (from code, not docs).

| Concern | Canonical owner (should be) | Actual owner today (code reality) | Gap? |
|---|---|---|---|
| Transport / clock | `@psy-foundation/transport` (v1 `Transport`) | NOBODY — 4+ divergent transports, none wired to DeviceHost | YES (GAP-S5: v1 not wired to DeviceHost) |
| Event bus / channel | `@psy-foundation/protocol` (`InMemoryChannel`) | NOBODY at runtime — only my psy-sampler instantiates it | YES (first runtime use is mine) |
| Device host / registry | `@psy-foundation/device-sdk` (`DeviceHost`) | NOBODY at runtime — only my psy-sampler instantiates it | YES (first runtime use is mine) |
| Material library | `@psy-foundation/material` (`MaterialLibrary`) | NOBODY at runtime — tests only | YES (GAP-S1: no `'sample'` kind) |
| Sample bank / asset store | (should be family-level) | DUPLICATED: psy4 (dead), psy5 (16 WAVs), psy-sampler (12 WAVs, 6 byte-identical to psy4) | YES (no family registry) |
| Audio context | (should be host-level, shared) | EVERY RUNTIME CREATES ITS OWN — 8+ inline `new AudioContext()` call sites | YES (no factory, no sharing convention) |
| Scheduler (runtime lookahead) | (should be `@psy-foundation/runtime-scheduler`) | DUPLICATED 7+ times (psy/psy3/PSY6/psy5×2/psy4/sampler) | YES (GAP-S4: foundation is offline-only) |
| Deterministic RNG | `@psy-foundation/*` (3 divergent copies) | DUPLICATED 14+ times (9 class + 5 inline) | YES (no single canonical Rng) |
| Persistence | (no convention) | 5+ namespace conventions | YES (fragmented) |
| Composition engine | `@psy-foundation/music` (`CompositionEngine`) | DUPLICATED: foundation + psy4 `MusicalSession` + psy `Groovebox.buildSong` + psy3 fork + PSY6 inline + psy5 inline | YES (psy4 uses its own fork, not canonical) |
| Device registration | `DeviceHost.register()` | ONLY MY psy-sampler does this | YES (no other product registers devices) |
| Audio graph | (should be host-level, shared buses) | EVERY RUNTIME OWNS ITS OWN — 8 instances | YES (no shared mixer) |
| NoteEvent channel taxonomy | (should be `@psy-foundation/protocol`) | SAMPLER-INVENTED `"role[:bank]"` convention | YES (no family taxonomy) |
| Sample provenance | (should be family-level registry) | SAMPLER-OWNED `public/samples/manifest.json` | YES (duplicatable across products) |

---

## 4. Dependency Graph (current state, from code)

```
                    ┌─────────────────────────────────────┐
                    │  psy-foundation (canonical, headless) │
                    │  NEVER imported at runtime by anyone  │
                    │  (only tests + lab apps consume it)    │
                    └─────────────────────────────────────┘
                                      │
                                      │ (NOT a runtime dep — copied)
                                      ▼
        ┌─────────────────────────────┴─────────────────────────────┐
        │                                                           │
        ▼                                                           ▼
┌─────────────────┐                                       ┌──────────────────┐
│  psy-sampler    │ ←── verbatim shim (compile-time fork) ──┤  psy-foundation   │
│  (my project)   │                                       │  (copied into     │
│                 │                                       │   src/psy-found   │
│  src/psy-sampler│                                       │   ation-shim/)    │
│  src/psy-found  │                                       └──────────────────┘
│  ation-shim     │
│  src/lib/demo-  │
│  director       │
│  src/app/page   │
└─────────────────┘
        │
        │ (NO other product imports psy-sampler)
        ▼
   ISOLATED. No other PSY product consumes the Sampler.

Meanwhile, the other 5 PSY repos have NO dependency on psy-foundation at runtime:
   psy         → inline copy of foundation.mjs (P1 bundle, not canonical)
   psy3-clean  → NO foundation reference at all
   psy4        → imports from ../../foundation/* (ITS OWN LOCAL FORK, not @psy-foundation/*)
   psy5        → partial copy of foundation (truncated) + tests
   PSY6-ULT    → NO foundation reference at all
```

**Dependency direction is clean** (nothing imports FROM sampler except its own UI; foundation never imports from sampler). **But the dependency is not real** — it's a copy, not a package reference.

---

## 5. Runtime Graph (current state)

```
┌─────────────────────────────────────────────────────────────────────┐
│  psy-sampler runtime (src/app/page.tsx)                              │
│                                                                      │
│  AudioContext (1, created on gesture)                                │
│       │                                                              │
│       ├── DemoTransport (shim, non-canonical)                        │
│       │       │                                                      │
│       │       ▼                                                      │
│  InMemoryChannel ◄── DeviceHost ◄── DemoDirector (fake composer)    │
│       │                   │                                          │
│       │                   ├── register(SamplerDevice)                │
│       │                   └── register(ReferenceDeviceStub)          │
│       │                                                              │
│       ▼                                                              │
│  SamplerDevice                                                       │
│   ├── SampleLibrary (12 WAVs, sampler-local)                        │
│   ├── SelectionPolicy (deterministic claim is FALSE — see §11)      │
│   ├── RuntimeScheduler (sampler-invented, 5th copy of family pattern)│
│   ├── VoicePool<SampleVoice> (32 voices, via shim VoicePool)        │
│   └── AudioGraph (3 buses → master → comp → analyser → destination) │
│                                                                      │
│  CLOSED LOOP: DemoDirector generates NoteEvents → host.publish →    │
│  SamplerDevice consumes → audio. No external input possible without  │
│  DemoDirector.                                                       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  psy4 runtime (PsyLive) — COMPLETELY SEPARATE                       │
│                                                                      │
│  AudioContext (1, created in ensureAudio)                            │
│       │                                                              │
│  MusicalSession (psy4's local fork, NOT canonical CompositionEngine) │
│   └── planBar() → NotePlan{ScheduledNote[]}                         │
│       └── PsyLive.scheduleStep()                                    │
│           └── this.kick/hat/bass/lead() (direct voice calls)        │
│               └── ctx.createOscillator() → ctx.destination          │
│                                                                      │
│  NO DeviceHost. NO Channel. NO NoteEvent. NO Sampler.               │
│  Composer output (NotePlan) is INCOMPATIBLE with NoteEvent.         │
│  No adapter exists.                                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  psy / psy3-clean / PSY6-ULTIMATE / psy5/index.html                 │
│  (single-file HTML runtimes)                                        │
│                                                                      │
│  Each: AudioContext + inline scheduler + inline scheduleStep +      │
│  direct voice function calls (v.kick(t), engine.trigger(...)).      │
│  NO DeviceHost. NO Channel. NO NoteEvent. NO transport abstraction. │
│  NO module system (single-file HTML constraint).                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Material Graph

```
┌─────────────────────────────────────────────────────────────────────┐
│  Sample material today — DUPLICATED, NOT SHARED                     │
│                                                                      │
│  psy4/public/samples/                                                │
│  ├── real/  (141 WAVs: 909/MD/Nord, NO license metadata)            │
│  │   └── manifest.json (707 lines, {file, category, subcategory})   │
│  ├── *.wav (6 PSY3 procedural samples, licensed "no copyright")     │
│  └── SAMPLE_MANIFEST.json (repo root, rich provenance, 6 entries)   │
│                                                                      │
│  psy5/samples/                                                       │
│  ├── real/  (16 WAVs — SUBSET of psy4's 141, byte-identical)        │
│  │   └── manifest.json (28 entries, 12 PHANTOM — no matching file)  │
│  └── (no rich provenance manifest)                                  │
│                                                                      │
│  psy-sampler/public/samples/                                         │
│  ├── *.wav (12 WAVs — 6 byte-identical to psy4's PSY3 set           │
│  │           + 6 procedurally generated by build script)             │
│  └── manifest.json (rich provenance, 12 entries, license-enforced)  │
│                                                                      │
│  psy / psy3-clean / PSY6-ULTIMATE: NO samples (pure synth)          │
│                                                                      │
│  Foundation MaterialLibrary: 9 kinds, NO 'sample' kind (GAP-S1)     │
└─────────────────────────────────────────────────────────────────────┘
```

**Three divergent manifest schemas. Three physical copies of the same PSY3 WAVs. No family-level sample registry. No shared provenance. The 141 psy4 real samples are UNLICENSED (commercial hardware: Roland 909, Elektron MD, Nord Drum) — rejected by my `validateProvenance`.**

---

## 7. Event Graph

```
CANONICAL EVENT FLOW (intended, from foundation contract):
  Composer → host.publish(NoteEvent) → InMemoryChannel → DeviceHost →
    for each device: device.onEvent(NoteEvent) → device renders

ACTUAL EVENT FLOW TODAY (per product):

psy-sampler (MINE — the only one using the canonical flow):
  DemoDirector.scheduleStep() → host.publish(NoteEvent) →
    InMemoryChannel → DeviceHost → SamplerDevice.onEvent() →
    SelectionPolicy.select() → RuntimeScheduler.schedule() →
    VoicePool.allocate() → SampleVoice.trigger() → audio

psy4 (CLOSED LOOP — bypasses canonical flow):
  MusicalSession.planBar() → NotePlan{ScheduledNote[]} →
    PsyLive.scheduleStep() → this.kick/hat/bass/lead() →
    ctx.createOscillator() → audio
  (NO DeviceHost, NO Channel, NO NoteEvent, NO adapter)

psy / psy3-clean / PSY6-ULTIMATE / psy5 (INLINE — bypasses canonical flow):
  inline scheduleStep() → v.kick(t) / engine.trigger(...) →
    ctx.createOscillator() → audio
  (NO DeviceHost, NO Channel, NO NoteEvent)
```

**The canonical event flow is used by EXACTLY ONE runtime: my psy-sampler. Every other product bypasses it.**

---

## 8. Transport Graph

```
CANONICAL TRANSPORT (intended):
  Transport (v1) → DeviceHost.pushTransport(TransportSnapshot, nowMs) →
    for each device: device.onTransport(TransportSnapshot) →
    device schedules at transport.origin.audioTime + event.at

ACTUAL TRANSPORT TODAY:

psy-foundation:
  v0 TransportClock (deprecated, 13-field MusicalTransport)
  v1 Transport (canonical candidate, 16-field TransportSnapshot)
  ⚠️ v1 NOT wired to DeviceHost (GAP-S5) — PsyDevice.onTransport still takes v0

psy4:
  MusicalTransport (psy4-local, 16 fields, anchor-based, with subscribe)
  ⚠️ INCOMPATIBLE with shim v0 (different field names: epoch vs revision, etc.)
  BeatPLL (designed for radio observation, NEVER instantiated at runtime)

psy-sampler (MINE):
  DemoTransport (shim, non-canonical, BPM-slider-driven, produces v0 snapshots)
  ⚠️ Lives in shim directory despite being non-canonical

psy / psy3-clean / PSY6-ULTIMATE / psy5:
  NO transport abstraction. Raw `bpm` number + `nextNoteTime` + `ctx.currentTime + lookahead`.
```

**4+ divergent transports. The canonical v1 is not wired to devices. My DemoTransport is the only one that produces v0 snapshots consumable by `PsyDevice.onTransport` — and it's non-canonical.**

---

## 9. Audio Graph

```
CANONICAL AUDIO (intended — does not exist):
  Family Audio Runtime (shared AudioContext + shared buses + shared master)
    ├── Synth device → shared bus
    ├── Drums device → shared bus
    ├── Sampler device → shared bus
    └── shared master → destination

ACTUAL AUDIO TODAY (per product, all isolated):

psy:        master → autoFilter → djFilter → drive → comp → analyser → dest
            (6 partGains, BASS+PAD sidechain duck)
psy3-clean: (fork of psy — identical)
PSY6-ULT:   master → drive → masterFilter → comp → analyser → dest
            (6 trackBuses + per-track FX sends)
psy5:       master → comp → analyser → dest (8 chains)
psy4:       masterEqLow → masterEqMid → masterEqHigh → master → safetyLimiter → analyser → dest
            (4 role buses: kick/bass/lead/hat, each with duck)
psy4/psy5 worklet: 5-bus L+R BusProcessors + SchroederReverb + StereoDelay + MultibandComp + StereoWidener + MasterChain (byte-identical between psy4 and psy5)
psy-sampler: master → comp → analyser → dest (3 buses: drum/music/atmos)
```

**8 isolated audio graphs. No shared buses. No host-level mixer. When the Sampler coexists with another device, they both write to `ctx.destination` and the browser sums them — no coordination, no ducking, no shared FX.**

---

## 10. Current Sampler Audit (Correct / Wrong / Why)

Brutally honest assessment. "Correct" = aligns with Family Citizen criteria. "Wrong" = violates them.

| # | Component | Correct? | Why |
|---|---|---|---|
| 1 | PsyDevice implementation | ✅ CORRECT | Implements canonical interface verbatim. Does NOT own transport. Does NOT make WHAT decisions (parses role from `event.channel`). Pure consumer. |
| 2 | DeviceHost integration | ✅ CORRECT | Used canonically. Multi-device coexistence PROVEN (Sampler + ReferenceDeviceStub both receive every NoteEvent). Shim byte-equivalent to canonical. |
| 3 | demo-director.ts location | ✅ CORRECT | Lives in `src/lib/`, NOT in `src/psy-sampler/`. Sampler package has ZERO imports from it. Device can be driven by any external NoteEvent source. |
| 4 | Transport ownership | ✅ CORRECT (shape) / ⚠️ WRONG (location) | Sampler does NOT own transport. BUT `DemoTransport` lives in `psy-foundation-shim/` despite being non-canonical — conflates "shim" with "demo helper". Should move to `src/lib/`. |
| 5 | Event generation | ✅ CORRECT | Sampler generates ZERO NoteEvents (grep `publish(` in `src/psy-sampler/` = NO matches). Pure consumer. |
| 6 | Sample store / library | ❌ WRONG | Sampler-OWNED `SampleLibrary`, NOT integrated with foundation `MaterialLibrary`. Foundation has no `'sample'` MaterialType (GAP-S1) — but sampler doesn't even attempt to extend it. Parallel store. |
| 7 | Manifest | ❌ WRONG | Sampler-OWNED manifest at `/samples/manifest.json`. 6 of 12 WAVs byte-identical to psy4 but attributed to "PSY3 project" (misleading). No family manifest. Material duplicated. |
| 8 | Material ownership | ❌ WRONG | Sampler treats samples as ITS property: `SampleLibrary` constructed inside `createSamplerDevice()`, manifest URL hardcoded to sampler-local path, samples physically duplicated into `public/samples/`. |
| 9 | Audio context | ✅ CORRECT | Single AudioContext, created on gesture, injected via `createSamplerDevice({audioContext})`. Sampler does NOT create its own. BUT sampler OWNS the master chain → `ctx.destination` directly (no host-level mixer). |
| 10 | Scheduler | ❌ WRONG | Sampler-invented `RuntimeScheduler` — 5th reinvention of the family lookahead pattern. Foundation scheduler is offline-only (GAP-S4). Should be `@psy-foundation/runtime-scheduler`. |
| 11 | UI separation | ✅ CORRECT | `src/psy-sampler/` has ZERO UI imports. `createSamplerDevice()` returns a headless bundle. UI is in `src/app/page.tsx` (demo playground). Device CAN run headless (structurally; no headless test exists). |
| 12 | Selection | ❌ WRONG | `SelectionPolicy` claims "deterministic, context-aware" but: (a) `section`/`energy`/`style`/`seed` inputs are DEAD (never used); (b) uses mutable internal `RoundRobinBank` counters, NOT the seed — calling `select()` twice with identical inputs produces DIFFERENT outputs; (c) the "seed" field is theater. End-to-end determinism is BROKEN at the selection layer. |
| 13 | Provenance | ✅ CORRECT (enforcement) / ❌ WRONG (ownership) | License policy IS enforced at load (`validateProvenance` throws, `commercialUse=false` refused). BUT provenance records are Sampler-OWNED. If PSY6 wants the same kick.wav, it re-declares provenance in its own manifest. No family registry. |
| 14 | Foundation shim | ⚠️ PARTIAL | Headers are HONEST (every file says "VERBATIM SHIM from..."). Diff-verified byte-equivalent. BUT `package.json` has NO `@psy-foundation/*` dependency. It's a compile-time fork, not a runtime delegation. Will silently drift from upstream. |
| 15 | Family reuse | ⚠️ PARTIAL | REUSES (via shim): PsyDevice, DeviceHost, Channel, NoteEvent, MusicalTransport v0, VoicePool, Rng. DUPLICATES: 6 WAVs (byte-identical to psy4), runtime scheduler (5th copy), manifest schema (parallel to psy4), provenance (per-product). INVENTS that should be family-level: RuntimeScheduler, channel convention `"role[:bank]"`, SampleAsset/Metadata/Provenance types, `barsPerPhrase=8` musical assumption. |

---

## 11. What is Reusable / Duplicated / Broken / Must Move / Must NOT Move

### Reusable (correct, keep as-is)

- `SamplerDevice` implements `PsyDevice` verbatim — **keep**
- `host.register(device)` canonical usage — **keep**
- Pure event consumer (zero `publish()` in sampler) — **keep**
- `DemoDirector` external to device package — **keep** (it's a demo harness, correctly placed)
- `VoicePool<SampleVoice>` generic — **keep**
- `SampleVoice` main-thread Web Audio (AudioBufferSourceNode, equal-power pan fix) — **keep**
- `RoundRobinBank` phrase-locked variance (extracted from psy4 inline code) — **keep**
- License enforcement at load (`validateProvenance`) — **keep**
- Single AudioContext injected, not created — **keep**
- Headless-capable API (`createSamplerDevice` returns bundle, no UI dependency) — **keep**

### Duplicated (must be consolidated)

| Duplicated thing | Where it's duplicated | Consolidation target |
|---|---|---|
| Foundation contracts (PsyDevice, DeviceHost, Channel, VoicePool, Rng, MusicalTransport v0, NoteEvent, MusicalContext) | My shim (verbatim copy) → should be real `@psy-foundation/*` package dep | `package.json` workspace dep on `psy-foundation` |
| 6 PSY3 WAV files | psy4 `public/samples/*.wav` + my `public/samples/*.wav` (byte-identical) | Family sample registry (single source of truth) |
| Runtime lookahead scheduler | 7+ copies (psy/psy3/PSY6/psy5×2/psy4/sampler) | `@psy-foundation/runtime-scheduler` (new package) |
| Audio graph master chain | 8 instances | Family audio runtime (shared master + buses) |
| mulberry32 Rng | 14+ copies (9 class + 5 inline) | Single `@psy-foundation/rng` (canonicalize music's `Rng` with `int`/`pick`) |
| Sample manifest schema | psy4 `SAMPLE_MANIFEST.json` + psy4/psy5 `manifest.json` + my `manifest.json` (3 schemas) | Family sample manifest schema |
| Provenance records | Per-product manifests | Family sample registry (one record per WAV) |

### Broken (must be fixed)

| Broken thing | Evidence | Fix |
|---|---|---|
| `SelectionPolicy` determinism claim | `select()` ignores `section`/`energy`/`style`/`seed`; uses mutable `RoundRobinBank` counters; same inputs → different outputs | Either (a) make selection truly seeded (derive variant from `seed + phrasePosition`, not mutable counter), OR (b) remove the dead inputs + fix the docstring to say "phrase-locked round-robin, not seeded" |
| Provenance attribution | 6 WAVs attributed to "PSY3 project" but md5-identical to psy4 repo files | Correct attribution to reflect actual source chain (PSY3 → psy4 → psy-sampler) |
| `DemoTransport` location | Lives in `psy-foundation-shim/` despite being non-canonical | Move to `src/lib/demo-transport.ts` |
| Foundation is a fork | No `@psy-foundation/*` in `package.json` | Add workspace dep (when integrated into family monorepo) OR publish foundation as npm package |

### Must move (to family-level)

| Must move | Current location | Target location |
|---|---|---|
| `RuntimeScheduler` | `src/psy-sampler/scheduler.ts` | `@psy-foundation/runtime-scheduler` (new package) — fills GAP-S4 for ALL devices, not just sampler |
| NoteEvent channel taxonomy (`"role[:bank]"` convention + SampleRole enum) | `src/psy-sampler/types.ts` | `@psy-foundation/protocol` — so GRANULAR, SYNTH, DRUMS all share it |
| Sample manifest schema (`SampleManifestEntry`, `SampleProvenance`) | `src/psy-sampler/types.ts` + `provenance.ts` | `@psy-foundation/material` as a new `'sample'` MaterialType (fills GAP-S1) |
| Sample asset store | `src/psy-sampler/library.ts` + `public/samples/` | Family sample registry (shared across products) |
| `barsPerPhrase=8` musical assumption | `src/psy-sampler/device.ts:103` (hardcoded) | `MusicalContext` field (so host tells device the phrase length) |

### Must NOT move (must stay Sampler-owned)

| Must stay | Why |
|---|---|
| `SampleVoice` (main-thread Web Audio playback) | This IS the realization — the HOW. No other device should own it. |
| `VoicePool<SampleVoice>` allocation | HOW — device-specific voice management |
| `RoundRobinBank` (phrase-locked variance) | HOW — variant selection is realization, not composition |
| `SelectionPolicy` (variant → sampleId + pitch/gain/pan) | HOW — once composition says "play a kick", sampler picks WHICH kick. (But the policy must be fixed per §11.) |
| `AudioGraph` (sampler's 3 buses) | HOW — but should CONNECT to a host-level master when one exists (future) |
| `DemoDirector` | Demo harness — stays in `src/lib/`, never enters device package |
| UI (`page.tsx`) | Playground — stays in `src/app/`, never enters device package |

---

## 12. Shim Analysis

**Is `src/psy-foundation-shim/` a legitimate temporary adapter, or a hidden fork?**

### Evidence it's a legitimate adapter (intent)
- Every file header says: `// VERBATIM SHIM from psy-foundation/packages/<pkg>/src/<file>.ts — Do not modify. Replace with @psy-foundation/<pkg> import when integrated into the canonical workspace.`
- Diff-verified: `device.ts`, `host.ts`, `voice-pool.ts`, `protocol.ts` (types only), `transport.ts` (types only) are **byte-equivalent** to canonical (only import paths differ: `./protocol` vs `@psy-foundation/protocol`).
- `DemoTransport` is clearly labeled `// NOT verbatim — demo helper, NOT part of canonical foundation`.

### Evidence it's a hidden fork (reality)
- `package.json` has **NO** `@psy-foundation/*` dependency. The "shim" is a compile-time copy, not a runtime delegation.
- If the canonical `PsyDevice` interface evolves (e.g., `onTransport` switches from v0 to v1 per GAP-S5), this sampler **won't notice** until someone manually re-syncs.
- There is **no test** that verifies the shim stays in sync with foundation (no diff test, no version pin).
- The shim is **not published** as a package — it's source files that only my project consumes.

### Verdict
**The intent is honest; the reality is a fork.** "Shim" implies runtime delegation (the shim forwards to the real thing at runtime). This is a compile-time copy. The correct term is "vendored copy" or "in-tree fork".

### Why a real package dependency isn't possible today
The canonical `psy-foundation` is a **Bun workspace monorepo** (`packages/*` with `workspace:` protocol deps). It is **not published to npm**. To consume it as a real dependency, one of these must happen:
1. **Publish `@psy-foundation/*` to npm** — foundation owner's decision, not sampler's.
2. **Add psy-sampler as a workspace package in the foundation monorepo** — but CONTRIBUTING.md rule #6 says "no devices in foundation".
3. **Create a family monorepo** that includes both `psy-foundation` and `psy-sampler` as workspace packages — the cleanest path, but a structural decision.

### Recommendation
Keep the shim **temporarily**, but:
1. Add a **sync test** that diffs the shim against the canonical source on every CI run (fails if they diverge).
2. Add a `SHIM_VERSION` constant pinning the foundation commit hash the shim was copied from.
3. Move `DemoTransport` out of the shim directory (it's not canonical).
4. Document the migration path explicitly in the README.

---

## 13. Repository Boundary Decision

### Options evaluated

| Option | Description | Verdict | Reason |
|---|---|---|---|
| A | Standalone device repo (current: `psy-sampler`) | ⚠️ CONDITIONAL | Correct ownership (device ≠ foundation), but isolated from family — no other product can consume it without a published package |
| B | Device package consumed by all PSY products | ✅ TARGET | The ideal — but requires the package to be published (npm or workspace) AND requires host-side adapters in each product |
| C | Part of an existing family runtime repo (e.g., inside psy4) | ❌ REJECT | Couples sampler to one product; other products can't consume it; violates "device is a sibling, not a child" |
| D | New dedicated family runtime repo (e.g., `psy-runtime`) | ⚠️ FUTURE | Would host DeviceHost + shared AudioContext + shared scheduler + device registry. Cleanest long-term, but a big structural decision. |
| E | Inside `psy-foundation/packages/sampler/` | ❌ REJECT | Violates CONTRIBUTING.md rule #6 ("no devices in foundation") |

### Decision: **CONDITIONAL GO on Option A → migrate to Option B → consider Option D long-term**

- **Short-term (Option A):** Keep `psy-sampler` as a standalone repo. It's the correct ownership boundary (device ≠ foundation). The shim stays as a vendored copy with a sync test.
- **Medium-term (Option B):** Publish `psy-sampler` as a consumable package (npm OR workspace). Build host-side adapters in psy4 first (lowest cost — ~60-100 LoC), then bundled UMD for psy/psy5/PSY6-ULTIMATE.
- **Long-term (Option D):** If a second realization device (GRANULAR) is built, extract the shared runtime (DeviceHost instantiation, AudioContext factory, shared scheduler, shared master chain) into `psy-runtime`. Sampler and GRANULAR both consume it.

### Why not Option C (inside psy4)
- psy4 is a research line, not a stable host (per CROSS_REPO_AUDIT.md)
- Embedding the sampler in psy4 means psy/psy5/PSY6 can't consume it without importing from psy4
- Couples sampler to psy4's Next.js + Prisma stack

---

## 14. Family Integration Architecture (target, derived from code)

This diagram is built FROM the code evidence, not assumed.

```
                 ┌──────────────────────────────────────┐
                 │   FAMILY RUNTIME (does not exist yet) │
                 │                                      │
                 │   Shared AudioContext (injected)     │
                 │   Shared Transport (v1, wired to DH) │
                 │   Shared DeviceHost + InMemoryChannel│
                 │   Shared RuntimeScheduler            │
                 │   Shared Sample/Material Registry    │
                 │   Shared Master Chain + Buses        │
                 └────────────────┬─────────────────────┘
                                  │
                   ┌──────────────┼──────────────┐
                   │              │              │
                   ▼              ▼              ▼
                SYNTH          DRUMS         SAMPLER
                (future)       (future)     (exists)
                   │              │              │
                   │              │              ▼
                   │              │        Sample realization
                   │              │        (SampleVoice, RoundRobin,
                   │              │         SelectionPolicy — HOW only)
                   │              │              │
                   └──────────────┴──────────────┘
                                  │
                                  ▼
                          Shared Audio Output

ABOVE THE LINE (WHAT — family-owned):
  - CompositionEngine (canonical, in @psy-foundation/music)
  - MusicalSession (psy4's, should migrate to canonical)
  - Transport (v1, in @psy-foundation/transport, must wire to DeviceHost)
  - MaterialRegistry (must be created — includes 'sample' kind)
  - Channel taxonomy (must be added to @psy-foundation/protocol)

BELOW THE LINE (HOW — device-owned):
  - SamplerDevice (implements PsyDevice)
  - SampleVoice, VoicePool, RoundRobinBank, SelectionPolicy
  - AudioGraph (connects to shared master, not own destination)

HOST-SIDE (per product):
  - Adapter: ComposedSection/NotePlan → NoteEvent[]
  - Adapter: product transport → MusicalTransport v0 (or fix GAP-S5)
  - Adapter: product track names → canonical channel taxonomy
  - AudioContext injection
```

### What exists vs. what must be built

| Component | Exists? | Where | Gap |
|---|---|---|---|
| Family Runtime | ❌ NO | — | Must be created (Option D long-term) |
| Shared AudioContext convention | ❌ NO | — | Every product creates its own |
| Shared Transport (v1 wired to DH) | ❌ NO | v1 exists but not wired | GAP-S5 |
| DeviceHost at runtime | ✅ ONLY in my sampler | `src/app/page.tsx:241` | Other products must instantiate |
| InMemoryChannel at runtime | ✅ ONLY in my sampler | `src/app/page.tsx:239` | Other products must instantiate |
| RuntimeScheduler (shared) | ❌ NO | 7+ duplicates | GAP-S4 — extract to `@psy-foundation/runtime-scheduler` |
| Sample/Material Registry (shared) | ❌ NO | 3 duplicated banks | GAP-S1 — add `'sample'` MaterialType + registry |
| Shared Master Chain | ❌ NO | 8 isolated graphs | Family audio runtime (future) |
| Channel taxonomy | ❌ NO | Sampler-invented | Add to `@psy-foundation/protocol` |
| ComposedSection → NoteEvent adapter | ❌ NO | — | Must be built (enables psy4 + foundation CompositionEngine) |
| NotePlan → NoteEvent adapter | ❌ NO | — | Must be built (enables psy4 specifically) |
| TransportSnapshot → MusicalTransport v0 adapter | ❌ NO | — | Must be built (or fix GAP-S5) |
| Product track-name → channel taxonomy mapping | ❌ NO | — | Must be built per product |

---

## 15. Interoperability Proof Matrix

Paper tests (not yet implemented — these are the acceptance criteria for GO).

| Test | Description | Can pass today? | What's needed to pass |
|---|---|---|---|
| A | PSY composition → Sampler | ❌ NO | psy has no DeviceHost; needs ~100 LoC adapter + bundled sampler script |
| B | PSY4 composition → Sampler | ❌ NO | psy4 has no DeviceHost; needs ~60-100 LoC adapter (NotePlan→NoteEvent + TransportSnapshot→v0 + host instantiation) |
| C | PSY5 runtime → Sampler | ❌ NO | psy5 has no DeviceHost + broken playground; needs ~100 LoC + file fix |
| D | PSY6-ULTIMATE → Sampler | ❌ NO | PSY6 has no DeviceHost; needs ~100 LoC adapter |
| E | Same NoteEvent stream → Synth + Drums + Sampler | ⚠️ PARTIAL | Sampler + ReferenceDeviceStub coexist (proven). But no real Synth/Drums devices exist yet. |
| F | Same transport → all devices | ❌ NO | Only DemoTransport exists; no shared transport wired to DeviceHost |
| G | Same deterministic seed → same sample realization | ❌ NO | SelectionPolicy is NOT seeded (mutable counters). Must fix. |
| H | Missing material → explicit failure, no invented music | ✅ YES | `SelectionPolicy.select()` returns `null` when no sample for role; device skips (notesSkipped counter increments). No invented events. |
| I | Sampler removed → rest of family continues | ✅ YES (structurally) | Sampler is a pure consumer. If unregistered, host still routes events to other devices. No device depends on sampler. |
| J | Sampler added → no duplicate transport/event/audio runtime | ⚠️ PARTIAL | Sampler does NOT create duplicate transport (consumes DemoTransport). Does NOT create duplicate event system (uses InMemoryChannel). BUT creates its own AudioGraph (master → destination) — parallel to host's graph. No shared master. |

**Tests A, B, C, D, E, F, G CANNOT pass today.** The reverse direction is not wired. This is the core gap.

---

## 16. Migration Strategy (NOT to be executed now — for review)

### Phase 0: Fix the Sampler's internal honesty (no family changes)
1. Fix `SelectionPolicy` determinism (seed the variant selection OR remove dead inputs + fix docstring).
2. Correct the provenance attribution for the 6 PSY3 WAVs (source chain: PSY3 → psy4 → psy-sampler).
3. Move `DemoTransport` from `psy-foundation-shim/` to `src/lib/`.
4. Add a shim sync test (diff shim against canonical source on CI).
5. Add `SHIM_VERSION` pinning the foundation commit.

### Phase 1: Make the Sampler consumable (sampler-side, no family changes)
6. Build a UMD/IIFE bundle of `psy-sampler` + `psy-foundation-shim` (~50 LoC rollup config). This unblocks single-file HTML hosts.
7. Add a headless test (no React, no DOM) that proves `createSamplerDevice()` + `host.publish(NoteEvent)` → audio.
8. Document the `NoteEvent.channel` convention (`"role[:bank]"`) as a public contract.

### Phase 2: Wire the first host (psy4 — lowest cost)
9. Add `get audioContext()` getter to `PsyLive` (1 LoC).
10. Build `TransportSnapshot → MusicalTransport v0` adapter (~20 LoC).
11. Build `NotePlan.ScheduledNote → NoteEvent` adapter (~15 LoC) inside `PsyLive.scheduleStep`.
12. Instantiate `DeviceHost` + `InMemoryChannel` in `PsyLive.ensureAudio` (~10 LoC).
13. Register `SamplerDevice` + load samples (~15 LoC).
14. Publish NoteEvents alongside existing voice calls (parallel mode — sampler plays WITH psy4's synth).

### Phase 3: Extract shared infrastructure (family-level — requires GO)
15. Create `@psy-foundation/runtime-scheduler` (extract from sampler's `RuntimeScheduler`, generalize).
16. Add `'sample'` MaterialType to `@psy-foundation/protocol` + `SampleManifestEntry` schema to `@psy-foundation/material`.
17. Add channel taxonomy (`SampleRole` enum + `parseChannel` convention) to `@psy-foundation/protocol`.
18. Wire v1 `TransportSnapshot` to `DeviceHost.pushTransport` (fix GAP-S5).

### Phase 4: Family sample registry (requires GO)
19. Create a shared sample manifest (single source of truth for provenance + metadata).
20. Migrate the 12 MVP samples to the registry.
21. Update sampler to load from registry instead of local `public/samples/`.

### Phase 5: Family audio runtime (long-term — requires GO)
22. Extract shared master chain + buses into `psy-runtime`.
23. Devices connect to shared buses, not directly to `ctx.destination`.

**Phases 0-2 do NOT require family changes** — they're sampler-side + psy4-side adapters. **Phases 3-5 require explicit GO** because they modify foundation or create new family infrastructure.

---

## 17. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Shim drifts from foundation | HIGH (no sync mechanism) | Contract mismatch, silent bugs | Add sync test (Phase 0.4) |
| SelectionPolicy determinism is broken | CONFIRMED | End-to-end determinism claim is false; A/B testing impossible | Fix in Phase 0.1 |
| psy4 refactor breaks PsyLive | MEDIUM | Loses psy4's working radio-following | Parallel mode (Phase 2.14) — sampler plays alongside synth, doesn't replace it |
| Family sample registry becomes a bottleneck | MEDIUM | All products depend on one registry; outage blocks all | Registry is read-only at runtime; cache locally |
| TransportSnapshot↔MusicalTransport v0 adapter loses information | LOW | v1 fields (epoch, source, holdover) lost in v0 | Fix GAP-S5 instead (wire v1 to DeviceHost) |
| Bundled UMD sampler is large | LOW | Page load time | Tree-shake; only bundle what's needed |
| Second device (GRANULAR) needs different channel taxonomy | MEDIUM | Channel convention doesn't fit | Make taxonomy extensible (enum + custom strings) |
| psy4's NotePlan has 4 voices (kick/bass/lead/hat); sampler has 9 roles | LOW | Mapping is lossy | Mapping table (psy4 `hat` → sampler `hat-closed` or `hat-open` based on context) |

---

## 18. Explicit Non-Goals

- **NOT building a new composition engine.** The sampler is a realization device. Composition stays in foundation's `CompositionEngine` / psy4's `MusicalSession` / host's director.
- **NOT building a new transport.** The sampler consumes transport. `DemoTransport` is a demo helper, not a family transport.
- **NOT building a new event system.** The sampler consumes `NoteEvent` via `DeviceHost`. No parallel protocol.
- **NOT modifying foundation** without explicit GO. The shim is a vendored copy; foundation changes require the foundation owner's decision.
- **NOT building a full UI product.** `page.tsx` is a demo playground. The device is headless-capable.
- **NOT adding MIDI / export / effects / pattern features** to the sampler until integration is proven.
- **NOT forcing single-file HTML products to adopt a module system.** If they can't consume the sampler via bundled script, they don't consume it yet.
- **NOT inventing a family audio runtime** until a second device (GRANULAR) proves the need.

---

## 19. GO / CONDITIONAL GO / NO-GO

### Verdict: **CONDITIONAL GO**

The Sampler's **shape** is correct (Family Citizen architecture). The **execution** has 5 wrongs that must be fixed before it earns the title.

### Conditions for GO (must be met before any further implementation)

1. **Fix SelectionPolicy determinism** (Phase 0.1) — either seed it properly or remove the false claim.
2. **Correct provenance attribution** (Phase 0.2) — the 6 PSY3 WAVs must honestly reflect their source chain.
3. **Move DemoTransport out of the shim** (Phase 0.3) — stop conflating canonical contracts with demo helpers.
4. **Add shim sync test** (Phase 0.4) — prevent silent drift from foundation.
5. **Build a UMD bundle** (Phase 1.6) — make the sampler consumable by single-file HTML products.
6. **Add a headless test** (Phase 1.7) — prove the device works without UI.
7. **Document the channel convention as public contract** (Phase 1.8) — so hosts know what to publish.

### What GO does NOT authorize

- Modifying `psy-foundation` (requires separate GO from foundation owner)
- Building the family sample registry (Phase 4 — requires GO)
- Building the family audio runtime (Phase 5 — requires GO)
- Adding features to the sampler (MIDI, export, effects, patterns)
- Forcing any PSY product to adopt the sampler

### What GO authorizes

- Phase 0 (sampler-internal honesty fixes)
- Phase 1 (make sampler consumable)
- Phase 2 (wire psy4 as the first host — adapter only, no psy4 architectural changes)

---

## 20. Hard Stop Conditions Check (from the directive)

| # | Condition | Met? | Evidence |
|---|---|---|---|
| 1 | Sampler can be consumed by another PSY product without copying its UI | ⚠️ STRUCTURALLY YES (headless API exists) / PRACTICALLY NO (no UMD bundle, no host adapter built) | Phase 1.6 + Phase 2 needed |
| 2 | Sampler can consume events from an external composition engine | ✅ YES | `host.publish(NoteEvent)` → `SamplerDevice.onEvent()` works for any source. Caveat: source must use the `"role[:bank]"` channel convention. |
| 3 | Sampler does not own musical composition | ✅ YES | Zero `publish()` in `src/psy-sampler/`. `DemoDirector` is host-side. |
| 4 | Sampler does not own family transport | ✅ YES | `DemoTransport` is non-canonical, host-side. `onTransport` only reads. |
| 5 | Sampler does not create a second event system | ✅ YES | Uses foundation `NoteEvent`/`Channel`/`DeviceHost`. Internal `ScheduledSampleEvent` is a queue entry, not a protocol. |
| 6 | Sampler does not create a second AudioContext unnecessarily | ✅ YES | Single AudioContext, injected. Zero `new AudioContext()` in `src/psy-sampler/`. |
| 7 | Sample material ownership is explicit | ❌ NO | Sampler-OWNED `public/samples/` + manifest. 6 WAVs duplicated from psy4. No family registry. |
| 8 | Foundation ownership remains explicit | ⚠️ PARTIAL | Shim headers are honest, but no real package dep. It's a vendored fork. |
| 9 | Repository dependency direction is clean | ✅ YES | Nothing imports FROM sampler except its own UI. Foundation never imports from sampler. |
| 10 | A second realization device can coexist without special-case Sampler logic | ⚠️ PARTIAL | DeviceHost level: YES (ReferenceDeviceStub proves it). Audio level: NO (each device owns its master chain → destination, no shared mixer). |
| 11 | PSY4's causal composition can feed the Sampler without importing Sampler internals | ❌ NO | PSY4's `NotePlan` is incompatible with `NoteEvent`. No adapter exists. PSY4 has no DeviceHost. ~60-100 LoC adapter needed. |
| 12 | Sampler can be used without its UI | ✅ YES (structurally) / ⚠️ UNTESTED | API supports headless. No headless test exists. |

**5 of 12 conditions are NOT met.** This is why the verdict is CONDITIONAL GO, not GO.

---

## 21. The Three Critical Questions

### Q1: "When PSY4 decides that a musical event should exist, exactly how does that decision travel through the family and become sound in the Sampler?"

**Today, it DOESN'T.** The path is a closed loop inside `PsyLive`:

1. `PsyLive.scheduler()` (`psy4/src/lib/psyLive.ts:831`) reads `this.transport.snapshot()` (psy4's local `MusicalTransport`, `psy4/foundation/transport/MusicalTransport.ts:57`).
2. `PsyLive.scheduleStep()` (`psyLive.ts:866`) calls `this.session.planBar(currentBar, snap.bpm)` (`psyLive.ts:882`).
3. `MusicalSession.planBar()` (`psy4/foundation/music/MusicalSession.ts:323`) returns a `NotePlan {notes: ScheduledNote[]}` where `ScheduledNote = {step: 0-15, voice: 'kick'|'bass'|'lead'|'hat', midi: number|null, velocity: number}`.
4. `PsyLive.scheduleStep()` filters notes by step (`psyLive.ts:891`) and dispatches via `switch(note.voice)` (`psyLive.ts:893-907`):
   - `case 'kick': this.kick(time, note.velocity)` (`psyLive.ts:481`) → `ctx.createOscillator()` → `kickBus` → `ctx.destination`
   - `case 'bass': this.bass(time, mtof(note.midi), v, note.velocity)` (`psyLive.ts:609`) → same pattern
5. **There is NO `host.publish(NoteEvent)` hop. NO `DeviceHost`. NO `InMemoryChannel`. NO `SamplerDevice`.**

**For the decision to reach the Sampler, this path must be rewired:**

1. `PsyLive.ensureAudio()` (`psyLive.ts:341`) must instantiate `new InMemoryChannel('psy4')` + `new DeviceHost(channel)` + register `SamplerDevice`.
2. `PsyLive.scheduleStep()` must convert each `ScheduledNote` to a `NoteEvent`:
   ```ts
   host.publish({
     type: 'note',
     note: note.midi ?? 60,
     velocity: note.velocity,
     duration: stepDur,
     channel: note.voice,  // 'kick' | 'bass' | 'lead' | 'hat'
     at: time,             // AudioContext seconds
   })
   ```
3. `PsyLive` must periodically call `host.pushTransport(transportSnapshotAsV0, nowMs)` — requires a `TransportSnapshot → MusicalTransport v0` adapter (because of GAP-S5).
4. `SamplerDevice.onEvent(NoteEvent)` → `parseChannel(event.channel)` → `SelectionPolicy.select()` → `RuntimeScheduler.schedule()` → `VoicePool.allocate()` → `SampleVoice.trigger()` → `AudioGraph` → `ctx.destination`.

**Real files/interfaces in the path:**
- `psy4/src/lib/psyLive.ts` (PsyLive — must be modified)
- `psy4/foundation/music/MusicalSession.ts` (composer — unchanged)
- `psy4/foundation/transport/MusicalTransport.ts` (transport — unchanged, but needs adapter)
- `psy-sampler/src/psy-sampler/device.ts` (SamplerDevice — unchanged)
- `psy-sampler/src/psy-foundation-shim/host.ts` (DeviceHost — unchanged)
- `psy-sampler/src/psy-foundation-shim/protocol.ts` (NoteEvent, InMemoryChannel — unchanged)
- **MISSING:** `ComposedSection/NotePlan → NoteEvent` adapter (does not exist anywhere)
- **MISSING:** `TransportSnapshot → MusicalTransport v0` adapter (does not exist anywhere)

### Q2: "If tomorrow we build a new PSY realization device called GRANULAR, what existing family infrastructure can GRANULAR reuse without importing anything from SAMPLER?"

**Almost nothing — and that's the problem.**

GRANULAR could reuse (without importing from SAMPLER):
- `PsyDevice` interface (`psy-foundation/packages/device-sdk/src/device.ts:4-13`) — via foundation
- `DeviceHost` (`psy-foundation/packages/device-sdk/src/host.ts:15`) — via foundation
- `InMemoryChannel` (`psy-foundation/packages/protocol/src/channel.ts:13`) — via foundation
- `MusicalEvent` / `NoteEvent` (`psy-foundation/packages/protocol/src/events.ts:28`) — via foundation
- `MusicalTransport` v0 (`psy-foundation/packages/transport/src/types.ts:12`) — via foundation
- `MusicalContext` (`psy-foundation/packages/protocol/src/state.ts:11`) — via foundation
- `VoicePool<V>` + `Voice` (`psy-foundation/packages/dsp/src/voicePool.ts:12`) — via foundation
- `Rng` (`psy-foundation/packages/music/src/rng.ts:5`) — via foundation

GRANULAR could NOT reuse (because it doesn't exist at family level):
- Runtime lookahead scheduler — must reinvent (or copy from sampler, which means importing from sampler)
- NoteEvent channel taxonomy — must invent its own OR copy sampler's `"role[:bank]"` convention (which means importing from sampler)
- Sample/material registry — must build its own sample store OR copy sampler's `SampleLibrary`
- Audio graph / master chain — must build its own OR copy sampler's `AudioGraph`
- Transport adapter (if consuming psy4's TransportSnapshot) — must build its own
- Provenance system — must build its own OR copy sampler's

**If the answer is "almost nothing" — the architecture is not yet family-level.** The canonical foundation provides the *contracts* but not the *shared services*. GRANULAR would end up duplicating the same RuntimeScheduler, AudioGraph, and channel convention that SAMPLER duplicated.

**This is the strongest evidence that the family needs Phase 3 (extract shared infrastructure) before a second device makes sense.**

### Q3: "What does SAMPLER own that no other family component should own?"

**SAMPLER owns (correctly — HOW only):**
1. `SampleVoice` — the realization of a sample as audio (playbackRate, envelope, pan, saturation). No other device should know how to render a sample.
2. `VoicePool<SampleVoice>` allocation — which voice to steal when pool is full. Device-specific voice management.
3. `RoundRobinBank` — phrase-locked variant rotation (which of the 4 kicks to play). This is realization, not composition.
4. `SelectionPolicy` (variant → sampleId + pitch/gain/pan) — once composition says "play a kick", sampler picks WHICH kick. (The policy must be fixed per §11, but the ownership is correct.)
5. `AudioGraph` (sampler's 3 buses: drum/music/atmos) — the internal routing of sampler voices. (Should CONNECT to a host-level master when one exists, but the internal buses are sampler's.)

**SAMPLER does NOT own (correctly):**
- Transport — consumes via `onTransport`
- Composition — zero `publish()` calls
- Event system — uses foundation `NoteEvent`/`Channel`
- AudioContext — injected by host
- What role to play — host decides via `NoteEvent.channel`
- When to play — host decides via `NoteEvent.at`
- Arrangement / sections / motifs — host's job

**If the answer included transport, composition, arrangement, musical inference, or family orchestration — stop and fix.** The answer does NOT include any of these. The ownership boundary is correct.

**However, SAMPLER currently owns 4 things that SHOULD be family-level (and must move in Phase 3):**
1. `RuntimeScheduler` — should be `@psy-foundation/runtime-scheduler` (every device needs it)
2. NoteEvent channel taxonomy — should be in `@psy-foundation/protocol`
3. Sample manifest schema + provenance — should be in `@psy-foundation/material` (as `'sample'` MaterialType)
4. `barsPerPhrase=8` assumption — should come from `MusicalContext`

These are **ownership violations of the "no duplicated family infrastructure" principle**, not violations of the "device owns HOW only" principle. They must move UP to family level, not down into the device.

---

## 22. Final Statement

The PSY Sampler Device is **architecturally a Family Citizen but executionally a Standalone Product**. The shape is right: it implements `PsyDevice` verbatim, consumes (never owns) transport/context/events, proves multi-device coexistence, and keeps composition external. The wiring is wrong: the foundation is a vendored fork (not a real dependency), sample material is duplicated (not shared), the runtime scheduler is reinvented (5th copy), the channel convention is sampler-invented (not family-level), and the SelectionPolicy's determinism claim is false.

**No other PSY product can drive the Sampler today.** The reverse direction requires host-side adapters that do not exist, plus 3 pieces of missing family infrastructure (UMD bundle, TransportSnapshot→v0 adapter, channel taxonomy mapping). PSY4 is the lowest-cost host (~60-100 LoC) because it's the only product with a module system and its `NotePlan.ScheduledNote` is structurally close to `NoteEvent`.

**The composition→sound path in PSY4 is a closed loop** (`MusicalSession.planBar()` → `PsyLive.kick/hat/bass/lead()` → `ctx.createOscillator()`). There is no `DeviceHost.publish(NoteEvent)` hop. The composer's output type is incompatible with `NoteEvent`. No adapter exists. This is the central integration gap.

**If a second device (GRANULAR) were built today, it could reuse the foundation contracts but would have to reinvent the same shared services SAMPLER reinvented.** This proves the family architecture is not yet complete enough for multi-device realization.

**The recommendation is CONDITIONAL GO on Phase 0 (sampler-internal honesty fixes) + Phase 1 (make sampler consumable) + Phase 2 (wire psy4 as first host). Phases 3-5 (family-level extraction) require explicit GO from the foundation owner.**

---

*End of reconciliation document. No code was changed. No implementation was started. Awaiting explicit GO.*
