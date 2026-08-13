# PSY FAMILY-WIDE ARCHITECTURE CHALLENGE

> **Status:** AUDIT ONLY. No code changes. No implementation. No Foundation modifications.
> **Date:** 2026-08-13
> **Evidence base:** 6 parallel audit agents read actual source code across all PSY repos. Every claim has file:line evidence. Prior reports were verified against code — where they conflicted, code wins.

---

## A. Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  psy-foundation (CANONICAL — contracts only, tests only)             │
│  NEVER imported at runtime by ANY product repo.                      │
│  648 tests green. Headless. No AudioContext. No runtime.             │
└─────────────────────────────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────────────────────┐
        │ VERBATIM FORK (sync test)             │ LOCAL COPY (tests only)
        ▼                                        ▼
┌──────────────────────┐                ┌──────────────────────┐
│ psy-foundation-shim  │                │ psy5/foundation/     │
│ (6 files, pinned to  │                │ (subset, unused at   │
│ commit 4ae95d3)      │                │  runtime)            │
│                      │                └──────────────────────┘
│ package.json declares│
│ @psy-foundation/* as │
│ file:/tmp/psy-found… │
│ — PATH DOESN'T EXIST │
└──────────┬───────────┘
           │
    ┌──────┴──────────────────────────────────┐
    │  src/psy-sampler (16 files)             │
    │  + src/psy-sampler/registry.ts (DEAD)   │
    │  + src/psy-sampler/sampler-factory.ts   │
    │  SamplerDevice implements PsyDevice     │
    │  FIRST concrete device that makes sound │
    └──────┬──────────────────────────────────┘
           │
    ┌──────┴──────────────────────────────────┐
    │  src/app/page.tsx (Next.js host)        │
    │  + src/lib/demo-director.ts (fake host) │
    │  + src/lib/demo-transport.ts            │
    │  WIRES canonical contract at runtime    │
    │  — FIRST & ONLY in family to do so      │
    └─────────────────────────────────────────┘

─── ISOLATED RUNTIMES (no foundation wiring) ───
psy/index.html           (single-file, Groovebox, pure synth)
psy3-clean/index.html    (single-file, archived)
PSY6-ULTIMATE/index.html (single-file, module globals)
psy5/index.html          (single-file, PooledEngine)
psy5/playground/         (BROKEN: stray JS+HTML before <html>)
psy4 PsyLive.ts          (Next.js, uses LOCAL foundation copy)
psy4-work PsyLive.ts     (psy4 + DORMANT SamplerBridge seam)
```

**Key facts from code:**
- 12 repos total (8 PSY + 4 non-PSY). Only 4 produce sound at runtime.
- Only my-project (psy-sampler) instantiates `DeviceHost`/`PsyDevice`/`InMemoryChannel` at runtime.
- `psy4-work`'s `SamplerBridge` is **DORMANT** — `page.tsx` is byte-identical to psy4 (md5 e45078c4) and never calls `attachSamplerBridge()`.
- `package.json` declares `@psy-foundation/*` as `file:/tmp/psy-foundation/packages/*` — **path doesn't exist**. The shim is the actual delivery vehicle.

---

## B. Broken / Weak Boundaries

| # | Boundary | Problem | Evidence |
|---|---|---|---|
| B1 | **NoteEvent.note for unpitched voices** | Coerced placeholder `midi ?? 60` is treated as authoritative pitch by the sampler → kick pitched 2 octaves up | `sampler-bridge.ts:188`, `selector.ts:117-122` |
| B2 | **NoteEvent.duration is dead** | Never read by any device; sampler uses `decayFor(role)` instead | `device.ts:157` |
| B3 | **NoteEvent type defined in 2 places** | Inline in `psy4-work/sampler-bridge.ts:71` AND in `psy-foundation-shim/protocol.ts:127`. Type-unsafe crossing. | Both claim "VERBATIM from foundation" |
| B4 | **ScheduledNote.step dropped** | Step-level info lost in conversion to NoteEvent | `sampler-bridge.ts:186` omits `step` |
| B5 | **Typed voice union → string → unsafe cast** | `voice: 'kick'\|'bass'\|'lead'\|'hat'` → `channel: 'kick'` (string) → `role = parts[0] as SampleRole` (no validation) | `sampler-bridge.ts:186`, `types.ts:178` |
| B6 | **barsPerPhrase=8 hardcoded in device** | Musical assumption in the HOW layer; must match composer's phrase length or silently desync | `device.ts:57` |
| B7 | **2 plan caches** | `MusicalSession.currentPlan` (MusicalSession.ts:502) AND `PsyLive.currentNotePlan` (psyLive.ts:889) — two sources of truth | |
| B8 | **2 independent 25ms schedulers** | PSY4's `scheduler()` + sampler's `RealizationScheduler` — both wake every 25ms, both have queues, both have stale-drop policies | `psyLive.ts:834`, `realization-scheduler.ts:104` |
| B9 | **latencyMs mismatch** | Factory declares `latencyMs: 5`, device returns `latencyMs: 12` — undetected by tests | `sampler-factory.ts:32`, `device.ts:79` |
| B10 | **Roles taxonomy mismatch** | Capabilities advertise `'hat'` and `'snare'` but `SampleRole` enum has `'hat-closed'`, `'hat-open'`, no `'snare'` | `device.ts:82`, `types.ts:11` |
| B11 | **`at` duplicated** | `ScheduledSampleEvent.at` (top-level) AND `ScheduledSampleEvent.opts.at` — voice only reads `opts.at` | `device.ts:162-173` |
| B12 | **Transport revision cached twice** | `DeviceHost.lastTransportRevision` + `SamplerDevice.transport` | `sampler-bridge.ts:116`, `device.ts:52` |

---

## C. Duplication Map

| Category | Copies | Worst offenders | Action |
|---|---|---|---|
| **Schedulers** (lookahead 25ms) | 7+ | psy, psy3-clean, PSY6-ULTIMATE, psy5×2, psy4, RealizationScheduler, DemoDirector — all Blob Worker + ctx.currentTime + horizon | MOVE 1 canonical to foundation/dsp |
| **Transports** | 4 | v0 TransportClock (deprecated), v1 Transport (canonical), psy4 MusicalTransport (incompatible), DemoTransport | Pick v1, DELETE v0 + psy4-local |
| **RNG (mulberry32)** | 14 | 9 `class Rng` copies + 5 inline `function mulberry32` | MOVE music's `Rng` (richest) to foundation, DELETE all others |
| **Audio graphs** | 6+ | psy, psy3-clean, PSY6-ULTIMATE, psy5, psy4 PsyLive, psy4 worklet, sampler AudioGraph | MOVE minimal AudioGraph to foundation |
| **AudioContext factory** | 8 | Every repo does `new (window.AudioContext\|\|webkitAudioContext)()` inline | MOVE `createAudioContext()` to foundation |
| **Blob Worker source string** | 4 byte-identical | psy3-clean, psy5, RealizationScheduler, DemoDirector | Collapse into foundation scheduler |
| **Sample manifests** | 5 files / 4 schemas | psy4-rich, psy4-simple, psy5-simple, my-project-rich | Unify on my schema (richest) |
| **Sample loaders** | 3 | psy4 SampleBank (dead), psy4 validation (Node), my SampleLoader | MOVE my loader to foundation |
| **Role taxonomy** | 6 different sets | psy (6 roles), psy4 (4), psy5 (8), PSY6 (6), sampler (9), factory (9 mismatched) | MOVE canonical enum to foundation/protocol |
| **Provenance systems** | 3 | psy4-rich (no enforcement), psy4-simple (no provenance), my system (enforces) | MOVE my system to foundation |
| **Musical state** | 3 sources in psy4 | TransportState, MusicalContext, PsyLive.musicState (duplicate) | DELETE PsyLive.musicState |

---

## D. Cross-Repo Dependency Map

```
                    ┌─────────────────────────┐
                    │  psy-foundation          │
                    │  (canonical, headless)   │
                    │  NEVER imported at       │
                    │  runtime by anyone       │
                    └────────┬────────────────┘
                             │
              ┌──────────────┼──────────────────┐
              │ FORK         │ LOCAL COPY       │ (tests only)
              ▼              ▼                  ▼
     ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
     │ psy-sampler  │ │ psy4         │  │ psy5         │
     │ (via shim)   │ │ (local found)│  │ (subset)     │
     └──────┬───────┘ └──────┬───────┘  └──────────────┘
            │                │
            │ DORMANT        │ PsyLive uses
            │ bridge seam    │ ../../foundation/*
            ▼                ▼
     ┌──────────────┐ ┌──────────────┐
     │ page.tsx     │ │ psyLive.ts   │
     │ (host)       │ │ (runtime)    │
     └──────────────┘ └──────────────┘

  ISOLATED (no foundation at all):
  psy, psy3-clean, PSY6-ULTIMATE, psy5/index.html

  REVERSE: NO repo imports FROM psy-sampler or FROM psy4
```

**Key finding:** The dependency direction is clean (nothing imports from sampler; foundation never imports from devices). But the dependency is NOT REAL — it's a code fork, not a package reference. `package.json`'s `file:/tmp/psy-foundation/` entries point to a non-existent path.

---

## E. Event Trace (kick drum, end-to-end)

| Step | Shape | Created by | State held | Clock | Scheduler | Conversion |
|---|---|---|---|---|---|---|
| 1 | `ScheduledNote {step, voice, midi, velocity}` | `MusicalSession.ts:567` | `currentPlan` + `phraseNotes` | none | none | — |
| 2 | (read cached plan) | `PsyLive.ts:889` | `currentNotePlan` (DUPLICATE cache) | `transport.snapshot()` | PSY4 scheduler (25ms) | — |
| 3a | SYNTH PATH: `this.kick(time, vel)` | `psyLive.ts:484` | none | `ctx.currentTime` via `t` | Web Audio internal | direct |
| 3b | `samplerBridge.publishNote(time, note, ...)` | `psyLive.ts:917` | none | none | none | **CONV #1: ScheduledNote → NoteEvent** (lossy: midi=null → 60, step dropped, voice → string) |
| 4 | `NoteEvent {type, note, velocity, duration, channel, at}` | `sampler-bridge.ts:186` | none | none | none | crosses repo boundary (type defined in 2 places) |
| 5 | (passthrough) | `InMemoryChannel.publish` → `DeviceHost` → `device.onEvent` | `DeviceHost.devices` | none | none | — |
| 6 | `SelectionInput {role, bank, velocity, phraseIndex, seed}` | `device.ts:134` | `this.transport`, `this.context` | none | none | **CONV #2: NoteEvent → SelectionInput** (note=60 treated as pitch, phraseIndex re-derived from bar/8, seed from revision) |
| 7 | `SelectionOutput {sampleId, playbackRate, gain, pan}` | `selector.ts:105` | none (stateless) | none | none | **CONV #3: SelectionInput → SelectionOutput** (playbackRate = pitchRatio(rootNote, 60) → kick at 4× speed = 2 octaves up) |
| 8 | `ScheduledSampleEvent {at, sampleId, buffer, bus, opts}` | `device.ts:162` | none | none | `RealizationScheduler.schedule()` | **CONV #4: NoteEvent + SelectionOutput → ScheduledSampleEvent** (at duplicated) |
| 9 | (queue drain) | `realization-scheduler.ts:104` | `queue[]` | `ctx.currentTime` | RealizationScheduler (25ms Worker) | — |
| 10 | `voice.trigger(buffer, opts)` | `device.ts:211` | voice pool | none | none | — |
| 11 | `AudioBufferSourceNode.start(at)` | `voice.ts:97` | `currentSource`, `gainEnv`, `panner` | `ctx.currentTime` | Web Audio internal | **CONV #5: opts → node config** (FINAL) |

**7 data shapes. 5 conversions. 2 plan caches. 2 schedulers. 6 contract bypasses.**

**Critical bug:** The kick plays at 4× speed (2 octaves up) because `note.midi ?? 60` (placeholder for unpitched) is treated as authoritative pitch by `pitchRatio(rootNote, 60)`.

---

## F. Causal Composition Audit

**VERDICT: PSY4's live composition is NOT truly causal. It is template-driven with causal-flavored internal state.**

### Hidden templates (from code)

| Template | Location | What it hides |
|---|---|---|
| `COMPOSITION_ARC` | `MusicalContext.ts:58-67` | Fixed 64-bar 8-section arc with pre-set tension/novelty/density |
| `BAR_ACTIONS` | `MusicalSession.ts:67` | Fixed 8-bar action sequence (introduce/repeat/develop/cadence/response) |
| `PHRASE_STRUCTURE` | `MusicalSession.ts:66` | Fixed 8-phrase motif-group rotation `[0,0,1,0,0,1,2,0]` |
| `KICK_GRAMMARS` | `MusicalSession.ts:72-95` | 14 hardcoded kick step-arrays |
| Section switches | ~30+ sites in MusicalSession/TensionState/HarmonicState/GrooveState | `section === 'CLIMAX'` → behavior everywhere |
| Style switches | ~15 sites in MusicalSession | `style === 'DARK'/'ACID'/'PROGRESSIVE'/'FULL_ON'` → preset mappings |
| `CHORD_PROGRESSIONS` | `learning.ts:371-389` | Per-scale chord template library |
| `RHYTHM_VARIATIONS` | `learning.ts:392-412` | Fixed kickPatterns/bassPatterns/hatPatterns boolean arrays |

### The dead causal architecture

PSY4 has a **truly causal** composer (`CausalComposer` + `InferenceEngine` + `CausalState` + `MusicalMemoryStore`, ~940 LoC) — but it is **DEAD CODE**, wired only to tests. The runtime uses `MusicalSession.planBar()` which is template-driven.

`CandidateGenerator` (5 candidates, 6 scoring dimensions) also exists but is **BYPASSED** — the F22 P0-A comment at `MusicalSession.ts:1058` says "generateRelationalLead() is the ONLY lead path. The old generateLearnedLead and generateLead paths are REMOVED."

### The 4-channel trap

`ScheduledNote.voice` is typed `'kick' | 'bass' | 'lead' | 'hat'` (MusicalSession.ts:34). Adding clap, snare, shaker, tom, ride, crash, perc, texture, fx, counterline requires modifying the union + the switch + adding voice functions + modifying every filter site. **NOT a natural extension.**

`MusicalStrategies.ts` defines `TextureStrategyType` and `TransitionStrategyType` — but these are **NEVER consumed by any generator**. They're computed for reward calculation (post-hoc), not for generation.

### PSY4 vs canonical foundation

The canonical `CompositionEngine` is **more causal** than PSY4's `MusicalSession`:
- Uses real functional harmony (tonic/predominant/dominant) instead of section switches
- Consumes a learned `InteractionGrammar` (Markov bass transitions) at every bass decision
- Has `repetitionPressure`/`noveltyPressure` as first-class context fields
- Has first-class plan objects (`KickPlan`, `BassPlan`, `LeadPlan`)

They are **DIVERGING**, not converging. PSY4 has 1403 LoC of template logic + 940 LoC of dead causal architecture. The canonical foundation has a different design that PSY4 has not adopted.

---

## G. Audio Runtime Audit

| Concern | Owner today | Should be | Gap? |
|---|---|---|---|
| AudioContext | Each product creates its own (8 call sites) | Host-level, shared | YES — no factory |
| Master chain | Each product owns its own (6+ graphs) | Host-level shared master | YES — no shared mixer |
| Bus routing | Each product defines its own buses | Host-level shared buses | YES |
| Gain staging | Per-product, uncoordinated | Host-level | YES |
| Ducking/sidechain | Per-product (psy4 has it, sampler doesn't) | Host-level | YES |
| Voice pool | Foundation has `VoicePool<V>` (canonical) | Correct — products should use it | Products don't use it |
| Voice stealing | Foundation's round-robin steal is correct | Correct | — |
| AudioBufferSourceNode lifecycle | Per-trigger allocation (unavoidable in main-thread Web Audio) | Acceptable for MVP; AudioWorklet for zero-GC | Documented future path |
| Limiter | Per-product (psy4 has safetyLimiter, sampler has compressor) | Host-level shared limiter | YES |

**No multi-device audio story exists.** When sampler + synth coexist, they both write to `ctx.destination` and the browser sums them. No shared ducking, no shared metering, no master limiter coordination.

---

## H. Sampler Audit

### What the sampler CORRECTLY owns (HOW only)

| Component | Correct? | Notes |
|---|---|---|
| `SamplerDevice` implements `PsyDevice` | ✅ | Verbatim from foundation |
| Pure event consumer (zero `publish()`) | ✅ | Verified by grep |
| Does NOT own transport | ✅ | `onTransport` only reads |
| Does NOT own composition | ✅ | `DemoDirector` is external |
| Single AudioContext injected | ✅ | Zero `new AudioContext` in package |
| `SampleVoice` (AudioBufferSourceNode + equal-power pan) | ✅ | Fixed psy4's linear pan bug |
| `VoicePool<SampleVoice>` (reused from foundation) | ✅ | Via shim, byte-equivalent |
| `SelectionPolicy` (stateless, seeded) | ✅ | Genuinely deterministic now |
| License enforcement at load | ✅ | Refuses UNKNOWN/QUARANTINED |
| `DemoDirector` external to device package | ✅ | In `src/lib/`, not `src/psy-sampler/` |

### What the sampler WRONGLY owns

| Component | Problem | Should move to |
|---|---|---|
| `DeviceRegistry` (registry.ts) | **DEAD CODE** — only used by tests, not by page.tsx. Invented abstraction not in foundation. | DELETE, or move to foundation/device-sdk if genuinely needed |
| `sampler-factory.ts` | Returns `SamplerBundle` not `PsyDevice` — defeats uniform factory contract | If registry is deleted, delete this too |
| `barsPerPhrase = 8` | Musical assumption in HOW layer | Receive from host (MusicalContext or channel convention) |
| Channel convention `"role:bank"` | Sampler-OWNED, not family-level | Move to foundation/protocol |
| `RealizationScheduler` | 5th reinvention of family lookahead pattern | Move to foundation/dsp as `LookaheadScheduler` |
| `AudioGraph` (3-bus master chain) | No multi-device story | Move minimal version to foundation; connect to host master when available |
| `SampleLibrary` + `SampleLoader` | Sampler-OWNED, not family-level | Move to foundation as `AudioAssetLibrary` |
| `SampleProvenance` + verification | Sampler-OWNED | Move to foundation (policy enforcement) |
| `variance-rules.ts` | Sampler-OWNED | Could stay (HOW) or move to foundation (shared) |
| `onContext` | **DEAD** — context received but never used | Either delete or actually use it |

### Real bugs found

1. **Kick pitch bug**: `note.midi ?? 60` placeholder → `pitchRatio(rootNote, 60)` → kick plays 2 octaves up
2. **latencyMs mismatch**: factory says 5, device says 12
3. **Roles mismatch**: capabilities advertise `'hat'`/`'snare'` but enum has `'hat-closed'`/`'hat-open'`/no `'snare'`
4. **`deriveVariant()` is O(phraseIndex)**: loops `phraseIndex+1` times; at phrase 1000, that's 1000 Rng calls per note
5. **`reference.ts` in shim**: uses broken `@psy-foundation/*` imports (dead code, type-only stripped)
6. **`shim-sync.test.ts` gives false confidence**: only checks exported names, not byte-equivalence

---

## I. Asset / Sample Audit

### Inventory

| Repo | Files | Size | Provenance? | License? | Commercial? | Status |
|---|---|---|---|---|---|---|
| psy4 top-level (PSY3 procedural) | 6 | 0.12 MB | ✅ rich | ✅ explicit | ✅ "freely usable" | VERIFIED PROCEDURAL |
| psy4 real/ (909/MD/Nord) | 141 | 20.39 MB | ❌ none | ❌ none | ❌ unknown | **QUARANTINED** (commercial hardware, no license) |
| psy5 real/ | 16 | 1.32 MB | ❌ none | ❌ none | ❌ unknown | **QUARANTINED** (byte-identical copies of psy4 + 12 phantom entries) |
| my project | 12 | 0.42 MB | ✅ rich | ✅ explicit | ✅ true | VERIFIED PROCEDURAL (6 byte-identical to psy4 + 6 generated) |

**175 WAVs total → 153 unique → 22 cross-repo duplicates.**

### Key findings

1. **141 psy4 real/ samples are UNLICENSED** — recordings of Roland TR-909, Elektron Machinedrum, Clavia Nord Drum. Violates psy4's OWN documented policy: "NEVER assume a random downloaded sample is commercially usable."
2. **psy5's manifest has 12 phantom entries** — 43% of entries point to non-existent files.
3. **6 of my 12 samples are byte-identical to psy4** — but my manifest correctly documents the source chain.
4. **3 preset banks (142+119+52 presets) — ALL dead code.** None is wired into any runtime.
5. **Foundation has NO `'sample'` MaterialType** (GAP-S1). Samples cannot be Materials — they need a parallel `AudioAsset` system.

### Material ≠ Instrument ≠ Role ≠ Channel ≠ Device ≠ Sample ≠ Voice

The family **conflates** these 7 concepts:
- `Material` (foundation) — runtime selection container (9 kinds, no 'sample')
- `Preset` (foundation `PresetPayload`) — flat number-only params map (incompatible with psy4's 30+-field `SoundPreset`)
- `Sample` (NOT in foundation) — binary audio asset
- `Voice` (foundation abstract) — `{active, noteOn, noteOff, panic}`
- `Role` (free-form string, NO family taxonomy) — 6 different role sets across the family
- `Channel` (overloaded!) — protocol Channel = pub/sub for events vs audio Channel/Bus = role-routed GainNode
- `Instrument` — NOT in foundation at all

**Clean model needed:**
- `Material` = musical intent (what to play, described)
- `AudioAsset` = binary audio data (the WAV file + provenance)
- `Voice` = realization primitive (how to render)
- `Role` = family-level enum (what musical function)
- `Channel` = event routing (pub/sub)
- `Bus` = audio routing (GainNode)
- `Device` = PsyDevice (consumes events, renders audio)

---

## J. Device / Registry Audit

### DeviceHost (foundation) vs DeviceRegistry (sampler)

| | DeviceHost | DeviceRegistry |
|---|---|---|
| Layer | Runtime (instance-level) | Discovery (factory-level) |
| Stores | Live `PsyDevice` instances | `DeviceFactory` entries by type |
| When | After instantiation | Before instantiation |
| In foundation? | ✅ Yes | ❌ No (sampler-invented) |
| Used at runtime? | ✅ Yes (by page.tsx) | ❌ No (only by tests) |

**Verdict: DeviceRegistry is PREMATURE.** It's well-written but has zero runtime consumers. `page.tsx` bypasses it entirely. Either:
- **DELETE it** (recommended — KISS, no real consumer)
- Or move to foundation/device-sdk if pre-instantiation discovery is genuinely a family need

### PsyDevice interface

The interface itself is correct (7 methods, verbatim from foundation). But:
- `onContext` is dead (context received, never used)
- `capabilities().roles` is free-form `string[]` — no canonical enum
- `reportLatencyMs()` returns a hardcoded number, not measured

### Lifecycle

- `register(device)` calls `device.onStart?.()` — correct
- `unregister(id)` calls `device.onStop?.()` — correct
- `dispose()` calls `onStop?.()` on all + clears — correct
- No device destruction/cleanup of AudioGraph nodes (potential leak if device is unregistered)

---

## K. UI Architecture Audit

**Current UI** (`page.tsx`, 1173 LoC):
- Creates AudioContext on gesture ✅
- Instantiates DeviceHost + InMemoryChannel + SamplerDevice ✅
- Has a 16-step pattern editor, BPM slider, section selector, sample library browser, visualizer ✅
- Polls device stats at 200ms ✅

**Problems:**
1. **UI IS the host** — `page.tsx` instantiates everything. There's no headless host. The device can't run without React.
2. **DemoDirector is the only event source** — it's a fake composer (hardcoded 16-step pattern). No real composition engine feeds the sampler.
3. **UI mutates state directly** — `director.toggleStep(role, step)` mutates the pattern. UI is a source of truth, not an observer.
4. **No causal state visibility** — the UI shows transport/device stats but NOT the composition engine's internal state (tension, expectation, memory, candidates, decisions).

**What the UI SHOULD expose (when a real composition engine exists):**
- Causal state (tension dimensions, expectation, familiarity)
- Material memory (what's been played, what's pending)
- Current decision + why-now (inference output)
- Active roles + active materials
- Voice allocation (which sample is playing)
- Event flow (composition → device → audio)
- Transport (BPM, bar, beat, phase, section)
- Audio devices (registered, capabilities, active voices)

**Architecture rule:** UI must be an observer/debugger/control surface — NEVER the source of truth. The composition engine owns state; the UI projects it.

---

## L. 10+ New Opportunities We Missed

| # | Opportunity | Evidence | Impact |
|---|---|---|---|
| 1 | **Event provenance tracking** — tag each NoteEvent with its causal origin (which inference rule, which candidate, which material) | Currently NoteEvent has no `provenance` field; impossible to trace WHY a note was played | Enables debugging, replay, A/B testing of composition decisions |
| 2 | **Deterministic replay** — `seed + initial state + event stream + library version = reproducible track` | Currently impossible: `deriveVariant` is seeded but `MusicalSession` uses `Math.random()` in places + `PsyLive` caches plans | Enables CI audio tests, regression detection, sharing compositions |
| 3 | **Offline rendering** — `OfflineAudioContext` render of an entire composition | Foundation's `CompositionEngine` is offline-capable but no renderer exists; psy4 has dead `offlineRenderer.ts` | Enables benchmarking, WAV export, quality verification |
| 4 | **Shared AudioRuntime** — one AudioContext + one master chain + one bus set per host | Currently 8 AudioContext call sites, 6+ audio graphs, no shared mixer | Eliminates 5+ duplicated audio graphs, enables ducking coordination |
| 5 | **Material identity** — `Material.id` that's stable across sessions, references by composition | Currently `MaterialLibrary` has `id` but no cross-session stability; samples have no Material kind | Enables material reuse, learning ("this motif worked before"), memory |
| 6 | **Causal feedback loop** — device reports outcome back to composition engine | Currently one-way: composition → device → audio. No "the sample was clipped" or "the voice was stolen" feedback | Enables adaptive composition (avoid material that overloads voices) |
| 7 | **Reusable device graph** — devices declare their audio input/output nodes; host wires them | Currently each device connects directly to `ctx.destination` | Enables host-level mixing, ducking, FX routing without device coupling |
| 8 | **Debugging/replay timeline** — record all events + state changes for post-hoc analysis | Currently no event log; `psy6_events` localStorage is just a counter | Enables "what happened at bar 32?" debugging, visual replay |
| 9 | **Cross-product composition engine** — one composition engine feeds multiple products | Currently psy4 has MusicalSession, psy has Groovebox.buildSong, PSY6 has inline — all different | Eliminates 7+ composition engine duplications |
| 10 | **Unified asset provenance** — one license/provenance system for ALL assets (samples, presets, motifs) | Currently 3 systems (my manifest, psy4-rich, psy4-simple) | Eliminates license risk, enables commercial deployment |
| 11 | **Voice budget negotiation** — devices declare voice needs; host allocates budget | Currently each device has its own pool with no coordination | Prevents voice overload when multiple devices coexist |
| 12 | **Test infrastructure for audio** — `OfflineAudioContext`-based tests that verify actual audio output | Currently all tests use `StubAudioContext` — can't verify sound | Enables regression detection for audio quality |
| 13 | **Channel taxonomy as protocol** — canonical role enum in `@psy-foundation/protocol` | Currently 6 different role sets; sampler-OWNED convention | Eliminates `voiceToChannel()` adapters, enables cross-product sample sharing |

---

## M. Optimization Opportunities

| # | What | Current | Optimized | Savings |
|---|---|---|---|---|
| M1 | `deriveVariant()` O(phraseIndex) loop | `for (let i=0; i<=idx; i++) variant = rng.int(...)` | Hash `(seed, role, phraseIndex)` → single `rng.int()` | O(n) → O(1) per note |
| M2 | 7 lookahead schedulers | Each product has its own 25ms Blob Worker | 1 foundation `LookaheadScheduler` per AudioContext | ~500 LoC deleted |
| M3 | 14 RNG copies | 9 class + 5 inline | 1 canonical `Rng` in foundation | ~400 LoC deleted |
| M4 | 6+ audio graphs | Each product builds its own master chain | 1 foundation `AudioGraph` + product-specific buses | ~800 LoC deleted |
| M5 | 8 AudioContext call sites | Inline `new AudioContext()` everywhere | `createAudioContext({latencyHint})` in foundation | Consistency + resume-on-gesture handling |
| M6 | 5 manifest schemas | 4 different shapes | 1 unified schema in foundation | Sample portability across products |
| M7 | `at` duplicated in `ScheduledSampleEvent` | Top-level + `opts.at` | Just `opts.at` (or just top-level) | 1 field removed |
| M8 | `NoteEvent.duration` dead field | Never read by any device | Remove from contract OR use it | 1 field removed or utilized |
| M9 | `PsyLive.currentNotePlan` duplicate cache | Cached in both MusicalSession and PsyLive | PsyLive reads from MusicalSession directly | 1 source of truth |
| M10 | `reference.ts` in shim | Dead code with broken imports | Delete | 1 file removed |
| M11 | `DeviceRegistry` + `sampler-factory.ts` | Dead code (only test consumer) | Delete | ~200 LoC removed |
| M12 | psy4 dead studio engine (~10k LoC) | `studio/engine/*` never used by PsyLive | Delete or archive | ~10,000 LoC removed |

---

## N. Proposed Target Architecture

```
                 ┌──────────────────────────────────────┐
                 │   FOUNDATION (canonical, headless)    │
                 │                                      │
                 │   Protocol:                           │
                 │     MusicalEvent / NoteEvent          │
                 │     MusicalTransport (v1 only)        │
                 │     MusicalContext                    │
                 │     Channel / InMemoryChannel         │
                 │     Role enum (canonical)             │
                 │                                      │
                 │   Device Contract:                    │
                 │     PsyDevice interface               │
                 │     DeviceHost                        │
                 │     DeviceCapabilities                │
                 │                                      │
                 │   Audio Runtime:                      │
                 │     createAudioContext()              │
                 │     AudioGraph (master + buses)       │
                 │     VoicePool<V>                      │
                 │     LookaheadScheduler (realization)  │
                 │     Rng (mulberry32, single copy)     │
                 │                                      │
                 │   Material / Assets:                  │
                 │     MaterialLibrary (9 kinds + 'sample')│
                 │     AudioAsset / AudioAssetLibrary    │
                 │     SampleManifest schema             │
                 │     validateProvenance()              │
                 │                                      │
                 │   Composition:                        │
                 │     CompositionEngine (causal)        │
                 │     schedule() (offline pure fn)      │
                 └──────────────┬───────────────────────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
                 ▼              ▼              ▼
           ┌──────────┐  ┌──────────┐  ┌──────────┐
           │  Synth   │  │  Drums   │  │ Sampler  │
           │ (future) │  │ (future) │  │ (exists)  │
           │          │  │          │  │          │
           │ HOW only │  │ HOW only │  │ HOW only │
           └────┬─────┘  └────┬─────┘  └────┬─────┘
                │              │              │
                └──────────────┼──────────────┘
                               │
                 ┌─────────────┴──────────────┐
                 │   FAMILY RUNTIME (host)     │
                 │                             │
                 │   Shared AudioContext       │
                 │   Shared Transport (v1)     │
                 │   Shared DeviceHost         │
                 │   Shared AudioGraph         │
                 │   Composition Engine        │
                 └─────────────┬──────────────┘
                               │
                 ┌─────────────┴──────────────┐
                 │   PRODUCTS                  │
                 │                             │
                 │   PSY4 (radio-following)    │
                 │   PSY3 (simple groovebox)   │
                 │   PSY6 (performance)        │
                 │   future products           │
                 │                             │
                 │   Each product = UI + config│
                 │   + composition policy      │
                 └─────────────────────────────┘
```

**Key differences from current:**
1. Foundation owns MORE: AudioGraph, LookaheadScheduler, Rng, AudioAsset, provenance, Role enum
2. Products own LESS: no own audio graph, no own scheduler, no own RNG, no own transport
3. Devices are pure HOW: receive events, render audio, report nothing upstream except latency
4. Runtime is shared: one AudioContext, one transport, one DeviceHost, one AudioGraph per host
5. Composition is causal: state → memory → inference → decision → consequence (not templates)

---

## O. Migration Plan (NOT to be executed — for review)

### Phase 1: Delete dead code (psy-sampler)
- Delete `registry.ts`, `sampler-factory.ts` (DeviceRegistry is unused at runtime)
- Delete `reference.ts` from shim (broken imports, dead code)
- Fix `latencyMs` mismatch (5 vs 12)
- Fix roles mismatch (`'hat'`/`'snare'` → `'hat-closed'`/`'hat-open'`/`'clap'`)
- Fix `deriveVariant()` O(phraseIndex) → O(1) hash
- Fix kick pitch bug (`note.midi ?? 60` → `null` handling in selector)
- Either use `onContext` or delete it

### Phase 2: Delete dead code (psy4)
- Delete `studio/engine/*` (~10k LoC dead code)
- Delete dead `CausalComposer` OR wire it into runtime (replace `MusicalSession.planBar()`)
- Delete `learning.ts:generateComposition()` (fully template-driven, parallel to MusicalSession)
- Fix `PsyLive.musicState` duplicate (use transport + context instead)

### Phase 3: Extract to foundation (requires GO)
- Move `Rng` (music's copy, richest) to `foundation/dsp` as canonical
- Move `LookaheadScheduler` to `foundation/dsp` (from sampler's RealizationScheduler)
- Move `AudioGraph` (minimal) to `foundation/dsp`
- Move `createAudioContext()` to `foundation/dsp`
- Move `AudioAsset` + `AudioAssetLibrary` + `SampleManifest` + `validateProvenance()` to new `foundation/audio-assets`
- Add `'sample'` MaterialType to `foundation/protocol`
- Add canonical `Role` enum to `foundation/protocol`
- Wire v1 `Transport` to `DeviceHost.pushTransport` (fix GAP-S5)

### Phase 4: Unify transports
- Delete v0 `TransportClock` from foundation
- Replace psy4's local `MusicalTransport` with foundation v1 `Transport`
- Delete `DemoTransport` (use foundation v1 with manual BPM control)

### Phase 5: Causal composition
- Replace `MusicalSession.planBar()` with `CausalComposer.composeBar()` OR canonical `CompositionEngine.composeSection()`
- Remove all hardcoded templates (COMPOSITION_ARC, BAR_ACTIONS, PHRASE_STRUCTURE, KICK_GRAMMARS)
- Wire `CandidateGenerator` + `InferenceEngine` into runtime
- Replace `ScheduledNote` with canonical `NoteEvent` (or add adapter)

### Phase 6: Family sample registry
- Create `psy-samples` repo with CC0/procedural samples only
- Delete 141 quarantined psy4 real/ samples
- Fix psy5 phantom manifest entries
- Point all products at the shared registry

---

## P. What To Delete

| What | Where | LoC | Why |
|---|---|---|---|
| `DeviceRegistry` + `sampler-factory.ts` | psy-sampler | ~200 | Dead code, zero runtime consumers |
| `reference.ts` in shim | psy-sampler | ~80 | Broken imports, dead code |
| `psy4/studio/engine/*` | psy4 | ~10,000 | Dead code, never imported by PsyLive |
| `psy4/CausalComposer` etc. | psy4 | ~940 | Dead code (OR wire it in — don't keep it dead) |
| `learning.ts:generateComposition()` | psy4 | ~200 | Fully template-driven, parallel to MusicalSession |
| `PsyLive.musicState` duplicate | psy4 | ~20 | Duplicate of transport + context |
| v0 `TransportClock` | foundation | ~160 | Deprecated by v1 |
| psy4 local `MusicalTransport.ts` | psy4 | ~500 | Duplicate of foundation v1 |
| 141 quarantined psy4 real/ samples | psy4 | 20 MB | Unlicensed commercial hardware recordings |
| 12 phantom psy5 manifest entries | psy5 | 12 entries | Point to non-existent files |
| `DemoTransport` | psy-sampler | ~90 | Replace with foundation v1 Transport |
| `shim-sync.test.ts` (current form) | psy-sampler | ~80 | False confidence — only checks exported names |
| `psy5/soundBank.js` | psy5 | 577 | TypeScript in .js, dead code |
| `psy5/factory-presets.js` | psy5 | 165 | Redundant duplicate of inline `<script>` |
| `psysampler` repo (no hyphen) | GitHub | 0 | Empty placeholder |

**Total deletions: ~12,000+ LoC + 20 MB unlicensed samples**

---

## Q. What To Move

| What | From | To | Why |
|---|---|---|---|
| `Rng` (mulberry32) | 14 copies | foundation/dsp | Single canonical copy |
| `LookaheadScheduler` | psy-sampler | foundation/dsp | Family-level service (7 duplicates) |
| `AudioGraph` (minimal) | psy-sampler | foundation/dsp | Family-level service (6 duplicates) |
| `createAudioContext()` | 8 inline sites | foundation/dsp | Consistency |
| `SampleLoader` | psy-sampler | foundation/audio-assets | Family-level service |
| `SampleManifest` schema | psy-sampler | foundation/audio-assets | Family-level schema |
| `validateProvenance()` | psy-sampler | foundation/audio-assets | Family-level policy |
| `SampleRole` enum | psy-sampler/types.ts | foundation/protocol | Family-level taxonomy |
| Channel convention | psy-sampler | foundation/protocol | Family-level contract |
| `barsPerPhrase` | psy-sampler/device.ts | MusicalContext (host-provided) | Musical assumption doesn't belong in device |
| 6 PSY3 procedural samples | psy4 + psy-sampler | psy-samples repo | Deduplicate |

---

## R. What To Keep

| What | Where | Why |
|---|---|---|
| `PsyDevice` interface | foundation/device-sdk | Canonical contract, correct |
| `DeviceHost` | foundation/device-sdk | Canonical, correct |
| `InMemoryChannel` | foundation/protocol | Canonical, correct |
| `NoteEvent` / `MusicalEvent` | foundation/protocol | Canonical (but fix dead `duration` field) |
| `MusicalTransport` v1 | foundation/transport | Canonical candidate |
| `MusicalContext` | foundation/protocol | Canonical (but add `phraseIndex` or `barsPerPhrase`) |
| `VoicePool<V>` | foundation/dsp | Canonical, correct |
| `CompositionEngine` | foundation/music | Canonical (more causal than psy4's) |
| `schedule()` offline | foundation/scheduler | Canonical (different purpose from runtime scheduler) |
| `SamplerDevice` core | psy-sampler | Correct (HOW only, pure consumer) |
| `SampleVoice` | psy-sampler | Correct (AudioBufferSourceNode, equal-power pan) |
| `SelectionPolicy` | psy-sampler | Correct (stateless, seeded) — after O(1) fix |
| `RoundRobinBank` variance rules | psy-sampler/variance-rules.ts | Correct (HOW) |
| `DemoDirector` | psy-sampler/src/lib | Correct (demo harness, external to device) |
| `SamplerBridge` | psy4/src/lib | Correct (smallest adapter) — but must be WIRED |
| PSY4's `MusicalSession` causal state (TensionState, GrooveState, HarmonicState, PhraseDevelopmentState) | psy4 | Correct concepts — but must remove templates |
| License enforcement | psy-sampler → foundation | Correct policy, wrong location |

---

## S. What Foundation Must Eventually Own

| Concern | Current owner | Should move to | Blocker |
|---|---|---|---|
| Canonical `Rng` | 14 copies | foundation/dsp | None — just pick music's copy |
| `LookaheadScheduler` | 7 copies | foundation/dsp | None — extract from sampler |
| `AudioGraph` (minimal) | 6 copies | foundation/dsp | None — extract from sampler |
| `createAudioContext()` | 8 inline | foundation/dsp | None |
| `AudioAsset` + library | psy-sampler | foundation/audio-assets (new package) | GAP-S1: no 'sample' MaterialType |
| `SampleManifest` schema | psy-sampler | foundation/audio-assets | None |
| `validateProvenance()` | psy-sampler | foundation/audio-assets | None |
| Canonical `Role` enum | 6 different sets | foundation/protocol | None — pick sampler's 9-role set |
| Channel convention | psy-sampler | foundation/protocol | None |
| v1 Transport wired to DeviceHost | foundation (v1 exists, not wired) | foundation/transport + device-sdk | GAP-S5 |
| `'sample'` MaterialType | missing | foundation/protocol | GAP-S1 |
| `phraseIndex` in MusicalContext | missing | foundation/protocol | None — add field |
| Runtime scheduler (vs offline) | missing | foundation/scheduler or foundation/dsp | GAP-S4 |
| Family sample registry | missing | new `psy-samples` repo | None — just create it |
| Multi-device audio coordination | missing | foundation/dsp | Needs shared AudioGraph first |

**These are Foundation's responsibility. They should NOT be done by the sampler or by psy4. They require explicit GO from the Foundation owner.**

---

## T. Risks / Contradictions

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| T1 | **Kick pitch bug is live** — sampler plays kicks 2 octaves up | HIGH | Fix `note.midi ?? 60` → handle null in selector (skip pitchRatio for unpitched) |
| T2 | **141 unlicensed samples in psy4** | HIGH (legal) | Quarantine + replace with CC0 |
| T3 | **PSY4 composition is template-driven** despite causal architecture existing | HIGH | Wire CausalComposer OR adopt canonical CompositionEngine |
| T4 | **Shim is a permanent fork** — package.json deps point to /tmp/ | MEDIUM | Either fix paths to real local clone, or publish foundation to npm |
| T5 | **2 independent schedulers** running in PSY4 + sampler | MEDIUM | Extract shared LookaheadScheduler to foundation |
| T6 | **DeviceRegistry is dead code** — creates maintenance burden | LOW | Delete it |
| T7 | **No multi-device audio story** — devices don't coordinate | MEDIUM | Shared AudioGraph in foundation |
| T8 | **6 different role taxonomies** — products can't share samples | MEDIUM | Canonical Role enum in protocol |
| T9 | **`deriveVariant()` O(phraseIndex)** — latent perf bug | LOW | Hash-based O(1) derivation |
| T10 | **Contradiction:** user wants causal composition but PSY4 has 1403 LoC of templates + 940 LoC of dead causal code | HIGH | Must choose: wire causal code OR delete it. Don't keep both. |

---

## REVERSE THIS DECISION

| Decision | Why it was wrong | What to do instead |
|---|---|---|
| **Adding DeviceRegistry to psy-sampler** | It's dead code. No runtime consumer. Invented abstraction not in foundation. | DELETE `registry.ts` + `sampler-factory.ts`. If pre-instantiation discovery is needed later, propose to foundation. |
| **Putting DemoTransport in the shim** | Conflated canonical contracts with demo helpers. | Already fixed (moved to `src/lib/demo-transport.ts`). ✅ |
| **`note.midi ?? 60` for unpitched voices** | Placeholder treated as authoritative pitch → kick plays 2 octaves up. | NoteEvent.note should be `number \| null`. Selector should skip `pitchRatio` when null. |
| **`barsPerPhrase = 8` in the device** | Musical assumption in HOW layer. | Receive from host (MusicalContext field or channel convention). |
| **Keeping `onContext` without using it** | Dead code disguised as future-proofing. | Either use it (context-aware selection) or delete it. |
| **`shim-sync.test.ts` checking only exported names** | False confidence — body could differ. | Strengthen to byte-comparison (modulo imports + comments). |
| **Advertising `'hat'` and `'snare'` in capabilities** | Mismatched with `SampleRole` enum. | Use `'hat-closed'`/`'hat-open'`/`'clap'` consistently. |

---

## FINAL QUESTION

**"If we were starting PSY4 + Sampler today with the knowledge we have now, what would we build differently?"**

We would build **one foundation, one runtime, one device contract, and zero duplicates**:

1. **Foundation owns ALL shared infrastructure** — not just contracts, but also `Rng`, `LookaheadScheduler`, `AudioGraph`, `createAudioContext()`, `AudioAssetLibrary`, `validateProvenance()`, canonical `Role` enum, channel convention. Today foundation owns only contracts and every product reinvents the rest (14 RNG copies, 7 schedulers, 6 audio graphs).

2. **One transport, v1 only.** No v0 legacy. No psy4-local MusicalTransport. No DemoTransport. `PsyDevice.onTransport` takes `TransportSnapshot` (v1) from day one.

3. **One composition engine, causal from the start.** No `COMPOSITION_ARC`, no `BAR_ACTIONS`, no `KICK_GRAMMARS`. State → memory → inference → decision → consequence. `CandidateGenerator` + `InferenceEngine` wired into runtime, not dead code. No role-first generation — material-first.

4. **No 4-channel trap.** The composition engine produces `MusicalEvent`s with a canonical `Role` enum (9+ roles). Adding clap/snare/shaker/tom/ride/crash/texture/fx is adding roles to the enum, not modifying switch statements.

5. **One audio runtime per host.** Shared `AudioContext`, shared `AudioGraph` (master + buses), shared `LookaheadScheduler`. Devices connect to host-provided bus inputs, not directly to `ctx.destination`. Multi-device ducking and gain staging work automatically.

6. **Samples are `AudioAsset`s, not `Material`s.** Parallel system: `MaterialLibrary` for musical intent (note arrays, rhythms, parameter maps), `AudioAssetLibrary` for binary audio (WAVs + provenance). `PresetPayload` references `sampleId` but doesn't own the audio.

7. **One sample pack repo.** `psy-samples` with CC0/procedural samples only. No 141 unlicensed commercial-hardware recordings. No 22 cross-repo duplicates. One manifest schema, one provenance system, one license policy enforced at load.

8. **No shim.** Foundation is either a workspace package (monorepo) or published to npm. No verbatim copy with a sync test that gives false confidence.

9. **UI is an observer.** The composition engine owns all state. The UI projects it (tension, expectation, memory, candidates, decisions, voice allocation). The UI never mutates composition state directly.

10. **Deterministic replay from day one.** `seed + initial state + event stream + library version = reproducible track`. No `Math.random()` anywhere in the composition path. CI runs audio tests via `OfflineAudioContext`.

**The cost of this refactor is ~2,000 lines deleted from psy-sampler + psy4, ~12,000 lines of dead code deleted from psy4's studio engine, and ~500 lines added to foundation. Net reduction: ~10,000 lines. Net capability gain: causal composition, multi-device audio, deterministic replay, cross-product sample sharing.**

The architecture we have today works — but it's a working prototype of the wrong architecture. Every duplication we've identified is a place where we'll pay compound interest if we keep building on top of it.

---

*End of audit. No code was changed. No implementation was started. Awaiting decisions on which phases to execute.*
