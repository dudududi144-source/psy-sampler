# PSY-SAMPLER-ARCHITECTURE-AUDIT.md

> **Status:** Authoritative audit, derived from reading actual source code of all six PSY family repositories (cloned to `/home/z/my-project/psy-audit/`). Code is the source of truth. Where prior reports conflict with code, code wins and the conflict is documented.

---

## 0. Executive Summary

The PSY family is a set of **browser-based Web Audio grooveboxes**, not hardware. The word "device" in this family refers to a logical software instrument (synth / drum machine / sampler), not a physical unit.

The audit confirms four load-bearing findings:

1. **The canonical device contract exists only in `psy-foundation`.** `PsyDevice`, `DeviceHost`, `VoicePool`, `Channel`, `MusicalEvent`, `MusicalTransport`, `MusicalContext` are all defined and tested there (648 tests, 391,299 expect() calls, 0 failures). None of the five other repos consumes these contracts at runtime.

2. **No runtime in the family implements the DRUMS/SYNTH/SAMPLER device topology.** The diagram in `psy/PSY6_ARCHITECTURE.md §1` is explicitly labelled "Critical deviation from today's code". Every runtime (`psy/index.html`, `psy3-clean/index.html`, `PSY6-ULTIMATE/index.html`, `psy5/index.html`, `psy4/src/lib/psyLive.ts`) is a monolithic Groovebox / PooledEngine that does composition + scheduling + rendering + UI in one scope.

3. **Sample playback exists only as dead infrastructure in `psy4` and `psy5`.** The `psy4-engine.js` AudioWorklet has a complete `SampleVoice` class, `loadSamples` message handler, sample pools, and round-robin logic — byte-identical in both repos. But no main-thread code ever calls `fetch` + `decodeAudioData` + `postMessage({type:'loadSamples'})`. The live `PsyLive` runtime in psy4 plays raw `createOscillator` per hit.

4. **The 141 real samples in `psy4/public/samples/real/` have NO license metadata**, violating the project's own documented policy. They are REJECT. Only 6 PSY3 procedural samples carry proper provenance ("no copyright restriction").

The sampler device is therefore a **green-field implementation** that consumes the canonical foundation contracts, with selective reuse of psy4's `SampleVoice` DSP skeleton and `loadSamples` protocol (both adapted, not copied verbatim).

---

## 1. Family Topology (code-verified)

| Repo | What it actually is (code) | Device contract? | Sample playback? | Tests |
|---|---|---|---|---|
| `psy` | `Groovebox` class, 1385-line single `index.html`. Pure synthesis. Inline composition model (no foundation import at runtime). `setInterval(25ms)` scheduler. | NO | ZERO | 48/48 green (foundation.test.mjs + playground.test.mjs) |
| `psy3-clean` | `Groovebox` + `PooledEngine` (20 synth + 24 drum voices, round-robin, no stealing). 4973-line single `index.html`. Pure synthesis. | NO | ZERO | none |
| `psy4` | Next.js 16 app. Live runtime = `PsyLive` (1341 LoC, main-thread Web Audio, `createOscillator` per hit). `studio/engine/` tree (~10k LoC) is DEAD — `SampleBank`, `SampleVoice`, `multisampleGenerator`, `layerEngine`, `soundBank`, `psy4EngineV2` all unused by live runtime. | NO (types only in dead code) | Infrastructure exists, **NOT wired** | none for audio |
| `psy5` | Two runtimes: `index.html` (60KB standalone `PooledEngine`, pure synth) + `playground/index.html` (98KB, structurally broken HTML head, oscillator-based). `samples/real/` has 16 WAVs. `worklets/psy4-engine.js` is byte-identical to psy4's. | NO (`.ts` interfaces exist but never compiled/imported) | Worklet is sample-capable; **main thread never loads samples** | 5 files (1,656 LoC), all foundation-package tests, no sampler test |
| `psy-foundation` | TypeScript monorepo. 10 packages. **The ONLY repo with canonical `PsyDevice` + `DeviceHost` + `VoicePool` + `Channel` + `MusicalEvent` + `MusicalTransport` + `MusicalContext`.** 648 tests green. | **YES (canonical)** | NO (foundation is headless — `CONTRIBUTING.md` rule: "no devices here") | 648/648 green (391,299 expect calls) |
| `PSY6-ULTIMATE` | Module-globals soup (no class). `PooledEngine` (20 synth + 24 drum). 2476-line single `index.html`. Pure synthesis. | NO | ZERO | none |

### Lineage (from commit messages + CROSS_REPO_AUDIT.md)

```
psy (mainline, v5.0.0-p1-foundation)
 ├─ psy3-clean (archived, v3.0.0-m1-fullon, pre-M2)
 ├─ psy4 (research line, Next.js, radio-following)
 ├─ psy5 (pooled-engine experiment, foundation subset)
 ├─ PSY6-ULTIMATE (unified endpoint, consolidates psy3/4/5)
 └─ psy-foundation (canonical shared infrastructure, NOT a device)
```

---

## 2. Canonical Repo Recommendation

### Decision: New dedicated repo `psy-sampler`

The sampler is a **device** (HOW layer), not foundation (WHAT layer). `psy-foundation/CONTRIBUTING.md` rule #6 explicitly forbids devices in foundation:

> "No device policy. If a feature looks like 'another device', it does not belong here."
> "Another device (synth, drum machine, groovebox) — that's a PSY DEVICE, not foundation."

Therefore the sampler cannot live inside `psy-foundation/packages/`. It must be a **sibling repo** that depends on `@psy-foundation/*`.

### Options evaluated

| Option | Verdict | Reason |
|---|---|---|
| A. Inside `psy4` | REJECT | psy4 is a research line; live runtime doesn't use the worklet; 141 unlicensed samples; Next.js structure couples device to one app |
| B. Inside `psy` (mainline) | REJECT | Single-file HTML constraint forces inline code; no DeviceHost runtime; adding a device means duplicating the contract inline |
| C. Inside `psy-foundation/packages/sampler/` | REJECT | Violates CONTRIBUTING rule #6 (no devices in foundation); mixes WHAT and HOW layers |
| D. Inside `psy3-clean` or `PSY6-ULTIMATE` | REJECT | Both are single-file HTML; no device abstraction; pure-synthesis; adding a sampler breaks the "open index.html directly" deployment rule |
| **E. New dedicated repo `psy-sampler`** | **ACCEPT** | Clean dependency direction (depends on `@psy-foundation/*`); owns its sample library, voice pool, scheduler; ships a demo host app; doesn't modify existing repos; aligns with "sampler as a family member" |

### Repository structure for `psy-sampler`

```
psy-sampler/
├── PSY-SAMPLER-ARCHITECTURE-AUDIT.md      ← this doc
├── PSY-SAMPLER-IMPLEMENTATION-PLAN.md     ← companion doc
├── README.md
├── package.json
├── tsconfig.json
├── next.config.ts                          ← demo host (Next.js 16)
├── src/
│   ├── app/page.tsx                        ← demo host UI
│   ├── psy-sampler/                        ← the device package
│   │   ├── index.ts                        ← public exports
│   │   ├── device.ts                       ← SamplerDevice implements PsyDevice
│   │   ├── types.ts                        ← SampleId, SampleMetadata, SampleAsset, ...
│   │   ├── manifest.ts                     ← SampleManifest schema + validation
│   │   ├── library.ts                      ← SampleLibrary (load, store, query)
│   │   ├── loader.ts                       ← SampleLoader (fetch + decodeAudioData)
│   │   ├── voice.ts                        ← SampleVoice (linear interp, pitch, env, pan)
│   │   ├── voice-pool.ts                   ← VoicePool<SampleVoice>
│   │   ├── selector.ts                     ← SelectionPolicy (deterministic)
│   │   ├── round-robin.ts                  ← RoundRobinBank (phrase-locked)
│   │   ├── scheduler.ts                    ← RuntimeScheduler (lookahead)
│   │   ├── audio-graph.ts                  ← bus routing + FX sends
│   │   └── provenance.ts                   ← license validation
│   ├── psy-foundation-shim/                ← verbatim canonical contracts
│   │   ├── device.ts                       ← PsyDevice interface (verbatim)
│   │   ├── host.ts                         ← DeviceHost (verbatim)
│   │   ├── protocol.ts                     ← MusicalEvent, MusicalTransport, MusicalContext, Channel
│   │   ├── transport.ts                    ← TransportClock (v0, what devices receive today)
│   │   └── rng.ts                          ← mulberry32 Rng
│   └── app/api/samples/[...path]/route.ts  ← sample file serving
├── public/samples/                          ← MVP sample library
│   ├── manifest.json                        ← rich provenance manifest
│   └── *.wav
└── tests/psy-sampler/                       ← test matrix
```

### The `psy-foundation-shim` compromise

The canonical contracts live in `psy-foundation` (TypeScript workspace packages). To consume them canonically, `psy-sampler` would need a workspace dependency on `psy-foundation`. In this initial delivery, we ship a **verbatim shim** containing the exact interface definitions from `psy-foundation/packages/{device-sdk,protocol,transport,dsp}/src/`. This is explicitly documented as a shim, not a fork:

- The shim contains ONLY type definitions and the `DeviceHost`/`VoicePool`/`TransportClock`/`Rng` implementations, copied verbatim with file-of-origin headers.
- When `psy-sampler` is integrated into the real family workspace, the shim is replaced by `import { PsyDevice } from '@psy-foundation/device-sdk'` etc.
- The shim is NOT a divergence — it is a verbatim copy. Any change to foundation contracts requires updating the shim in lockstep.

---

## 3. Existing Reusable Components (REUSE / ADAPT / REWRITE / REJECT)

| # | Component | Source | Verdict | Justification |
|---|---|---|---|---|
| 1 | `PsyDevice` interface | `psy-foundation/packages/device-sdk/src/device.ts:4-13` | **REUSE (verbatim via shim)** | Canonical contract. 7 methods. Cannot change. |
| 2 | `DeviceHost` class | `psy-foundation/packages/device-sdk/src/host.ts` | **REUSE (verbatim via shim)** | Canonical. Has `register/unregister/pushTransport/pushContext/publish/dispose` + dedup + throttle. |
| 3 | `DeviceCapabilities` type | `psy-foundation/packages/protocol/src/state.ts:21-29` | **REUSE** | 7 fields. `roles: string[]` is free-form — sampler self-declares `roles: ['sampler']`. |
| 4 | `MusicalEvent` union | `psy-foundation/packages/protocol/src/events.ts` | **REUSE** | 6 variants. `NoteEvent` is what the sampler consumes. |
| 5 | `MusicalTransport` (v0) | `psy-foundation/packages/transport/src/types.ts:12-27` | **REUSE** | This is what `PsyDevice.onTransport` receives today. v1 (`TransportSnapshot`) is NOT wired to DeviceHost (GAP-S5). |
| 6 | `MusicalContext` (protocol) | `psy-foundation/packages/protocol/src/state.ts:11-19` | **REUSE** | 7 fields (key, rootPc, scale, energy, style, section, beatsPerBar). Thin but canonical. |
| 7 | `Channel` + `InMemoryChannel` | `psy-foundation/packages/protocol/src/channel.ts` | **REUSE** | Synchronous fan-out. Sufficient for device-event bus. |
| 8 | `VoicePool<V>` | `psy-foundation/packages/dsp/src/voicePool.ts` | **REUSE** | Generic, preallocated, round-robin, voice stealing. `Voice` interface has `noteOn(note, vel)` only — see GAP-S8. |
| 9 | `Rng` (mulberry32) | `psy-foundation/packages/music/src/rng.ts` | **REUSE** | Deterministic PRNG. Has `next()`, `range()`, `int()`, `pick()`. |
| 10 | `schedule()` (offline) | `psy-foundation/packages/scheduler/src/scheduler.ts` | **REJECT** | Offline pure function. Sampler needs runtime lookahead scheduler (GAP-S4). Build our own. |
| 11 | `ReferenceDevice` | `psy-foundation/packages/device-sdk/src/reference.ts` | **REJECT** | Test stub with `audio:false, voices:0`. Not a base class. Sampler implements `PsyDevice` directly. |
| 12 | `MaterialLibrary` | `psy-foundation/packages/material/src/material.ts` | **REJECT (for samples)** | 9 kinds, NO `'sample'` kind (GAP-S1). Sampler keeps its sample bank in a private `Map<SampleId, SampleAsset>`, NOT in MaterialLibrary. Pattern metadata can still use Material. |
| 13 | `SampleBank` class | `psy4/src/lib/studio/engine/sampleBank.ts` (266 LoC) | **ADAPT** | Clean (no React/Prisma). Issues: O(N²) DFT → replace with FFT or skip spectral features for MVP; hardcoded `/samples/` URLs → parameterize; `SampleInfo` lacks `character/genreFit/bpmRange`. Reuse: Float32Array mono downmix, `toWorkletPayload()` pattern. |
| 14 | `SampleVoice` (worklet) | `psy4/public/worklets/psy4-engine.js:1167-1226` | **ADAPT** | Self-contained (depends only on `fastTanh`). Bugs to fix: (a) pan law is LINEAR not equal-power despite misleading comment — fix to `cos/sin`; (b) envelope is exp-decay-only — add attack/release; (c) saturation drive hardcoded at 1.4 — parameterize; (d) no loop mode; (e) no AA filter on down-pitch. Reuse: trigger/renderStereo skeleton, linear interpolation, playbackRate×(sampleRate/sr) ratio. |
| 15 | `loadSamples` postMessage protocol | `psy4/public/worklets/psy4-engine.js:1998-2013` | **REUSE** | `{type:'loadSamples', samples:[{name,category,subcategory,sampleRate,data:Float32Array}]}` + transferables. Clean, no coupling. |
| 16 | `manifest.json` (simple) | `psy4/public/samples/real/manifest.json` | **REJECT** | 1-line array of `{file, category, subcategory}`. No metadata. Replace with rich schema. |
| 17 | `SAMPLE_MANIFEST.json` (rich) | `psy4/SAMPLE_MANIFEST.json` (root, 164 LoC) | **ADAPT** | Good schema (16 fields incl. license/source/author/attribution). Only documents 6 PSY3 samples — extend to all MVP samples. Reuse schema as-is. |
| 18 | `multisampleGenerator.ts` | `psy4/src/lib/studio/engine/multisampleGenerator.ts` (524 LoC) | **REJECT** | Dead code. Generates 46 procedural samples — we ship real MVP samples instead. |
| 19 | `layerEngine.ts` | `psy4/src/lib/studio/engine/layerEngine.ts` (259 LoC) | **REJECT** | Dead code + BROKEN (references fantasy sample names that don't exist). |
| 20 | `soundBank.ts` | `psy4/src/lib/soundBank.ts` (698 LoC) | **REJECT** | Dead code. 142 presets for SYNTH/DRUM engines, not sampler. |
| 21 | `psy4-engine.js` worklet (as a whole) | `psy4/public/worklets/psy4-engine.js` (2575 LoC) | **ADAPT (extract only)** | Extract: `SampleVoice` + `loadSamples` handler + RT-safe pattern (preallocated pools, voice stealing, CPU budget). Drop: 11 synth voices, 5-bus architecture, SchroederReverb/StereoDelay/MultibandComp/MasterChain (overkill for sampler MVP). |
| 22 | Round-robin rules | `psy4/public/worklets/psy4-engine.js:2052-2275` | **ADAPT** | Phrase-locked rotation + microVar pattern is sound. Issues: actual values don't match docs (Kick ±0.3% code vs ±0.45% doc). Extract to a real `RoundRobinBank` class with documented values. Keep "kick never pitched beyond ±0.5%" rule. |
| 23 | Context-aware selection | (described in `SAMPLE_SELECTION_RULES.md` but DOES NOT EXIST in code) | **REWRITE** | The `SampleSelector` class is aspirational documentation only. Actual worklet selection is naive phrase-locked round-robin. Build real `SelectionPolicy` taking `(role, velocity, section, energy, phrasePosition)` + seeded RNG → deterministic selection. |
| 24 | 141 real sample files | `psy4/public/samples/real/` | **REJECT** | NO license metadata. Named `909_BD_*`, `md_*`, `nord_*` → Roland TR-909, Elektron MachineDrum, Clavia Nord Drum (commercial hardware). Violates project's own `licensePolicy`. |
| 25 | 6 PSY3 procedural samples | `psy4/public/samples/*.wav` (kick, bass_A, lead, hat_closed, hat_open, clap) | **REUSE** | Properly licensed: `"PSY3 reference (procedural sample, no copyright restriction)"`. Safe to use as MVP seeds. |
| 26 | `PooledEngine` (psy3-clean / PSY6-ULTIMATE) | single-file HTML repos | **REJECT** | No voice stealing, no DeviceHost, no foundation. Not reusable. |

---

## 4. Contract Mapping

### What the sampler consumes (canonical contracts)

```
PsyDevice (device-sdk/src/device.ts:4-13)
 ├─ id: string                                    ← "psy-sampler"
 ├─ capabilities(): DeviceCapabilities            ← {audio:true, midi:false, inputs:0, outputs:1, voices:32, latencyMs, roles:['sampler']}
 ├─ onTransport(MusicalTransport): void           ← receive bpm/beat/bar/phase/locked
 ├─ onContext(MusicalContext): void               ← receive key/scale/energy/style/section
 ├─ onEvent(MusicalEvent): void                   ← receive NoteEvent → trigger sample
 ├─ onStart?(): void                              ← audio context resumed
 ├─ onStop?(): void                               ← audio context suspended
 └─ reportLatencyMs?(): number                    ← measured scheduling latency

DeviceHost (device-sdk/src/host.ts)
 ├─ register(device): void                        ← sampler registers here
 ├─ pushTransport(MusicalTransport, nowMs): void  ← host pushes transport to sampler
 ├─ pushContext(MusicalContext): void             ← host pushes context to sampler
 └─ publish(MusicalEvent): void                   ← host publishes events → sampler.onEvent

MusicalEvent (protocol/src/events.ts)
 └─ NoteEvent { type:'note', note:number, velocity:number, duration:number, channel:string, at:EventTime }
                                                   ← sampler's primary input
                                                   ← `note` = MIDI note number (encodes pitch)
                                                   ← `channel` = free-form string (encodes role/bank)
                                                   ← `at` = AudioContext time in seconds

MusicalTransport (transport/src/types.ts:12-27, v0)
 └─ { bpm, beat, bar, beatsPerBar, beatTime, barTime, phase, barPhase, confidence, locked, revision, origin:{audioTime, beatIndex, bpm}, lastObservationAgo, observationCount }
                                                   ← sampler reads bpm + origin.audioTime for scheduling

MusicalContext (protocol/src/state.ts:11-19)
 └─ { key, rootPc, scale, energy, style, section, beatsPerBar }
                                                   ← sampler reads section/energy for sample selection

VoicePool<V> (dsp/src/voicePool.ts)
 └─ allocate(): V                                  ← round-robin, steals oldest if all active
 └─ V.noteOn(note, velocity): void                 ← triggers a voice

Channel (protocol/src/channel.ts)
 └─ InMemoryChannel: subscribe/publish/close       ← DeviceHost uses this internally
```

### What the sampler owns (HOW layer)

```
SampleLibrary
 ├─ Map<SampleId, SampleAsset>
 ├─ load(manifest): Promise<void>
 ├─ get(id): SampleAsset
 └─ query({category, subcategory, role}): SampleAsset[]

SampleAsset
 ├─ id: string
 ├─ metadata: SampleMetadata (id, category, subcategory, source, author, license, ...)
 ├─ audioBuffer: AudioBuffer (decoded, in-memory)
 └─ features: SampleFeatures (peak, rms, duration, sampleRate, channels)

SelectionPolicy
 ├─ select({role, velocity, section, energy, phrasePosition, seed}): SampleId
 └─ deterministic (seeded Rng, no Math.random)

RoundRobinBank
 ├─ next(category, phrasePosition): {sampleId, pitchVar, gainVar, panVar}
 └─ phrase-locked (rotates only on phrase boundary)

VoicePool<SampleVoice> (32 voices)
 ├─ allocate(): SampleVoice
 └─ SampleVoice.trigger(sampleData, sampleRate, playbackRate, amp, decay, pan)

RuntimeScheduler
 ├─ start(audioContext): void
 ├─ schedule(event: NoteEvent): void   ← queues event for lookahead firing
 └─ tick(): lookahead loop (25ms timer, 100ms horizon, AudioContext.currentTime)
```

---

## 5. Data Flow

```
                 ┌─────────────────────────────────────────────────────┐
                 │  HOST (demo app, src/app/page.tsx)                   │
                 │                                                      │
                 │  ┌──────────────┐    ┌──────────────────────────┐   │
                 │  │ Transport    │    │ Musical Director (mini)  │   │
                 │  │ (TransportClock)│  │  - reads transport       │   │
                 │  │  bpm/beat/bar │   │  - generates NoteEvents   │   │
                 │  └──────┬───────┘    │  - publishes to channel   │   │
                 │         │            └──────────┬───────────────┘   │
                 │         │                       │                    │
                 │  pushTransport(t, nowMs)  publish(NoteEvent)        │
                 │         │                       │                    │
                 │         ▼                       ▼                    │
                 │  ┌──────────────────────────────────────────────┐   │
                 │  │  DeviceHost (canonical, from shim)            │   │
                 │  │  ├─ register(samplerDevice)                   │   │
                 │  │  ├─ pushTransport → sampler.onTransport(t)    │   │
                 │  │  ├─ pushContext   → sampler.onContext(c)      │   │
                 │  │  └─ publish       → sampler.onEvent(e)        │   │
                 │  └──────────────────────┬───────────────────────┘   │
                 └─────────────────────────┼──────────────────────────┘
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│  SamplerDevice implements PsyDevice                                      │
│                                                                          │
│  onTransport(t)  → stores {bpm, origin.audioTime} for scheduling        │
│  onContext(c)    → stores {section, energy, style} for selection        │
│  onEvent(e):                                                             │
│    if e.type === 'note':                                                 │
│      1. Decode role from e.channel (e.g. "kick", "hat", "clap")          │
│      2. SelectionPolicy.select({role, velocity, section, energy, ...})   │
│         → sampleId + pitchVar + gainVar + panVar                         │
│      3. RuntimeScheduler.schedule({at: e.at, sampleId, ...})             │
│                                                                          │
│  RuntimeScheduler tick (25ms):                                           │
│    while (nextEventTime < audioCtx.currentTime + 0.1):                   │
│      voice = voicePool.allocate()        ← round-robin, steals oldest    │
│      asset = library.get(sampleId)                                       │
│      voice.trigger(asset.data, asset.sampleRate, playbackRate, ...)      │
│      voice.connect(bus)                  ← route to drum/music/atmos bus │
│                                                                          │
│  Audio graph:                                                            │
│    SampleVoice → busGain → masterGain → compressor → destination        │
│                                 ↑                                         │
│                          delay/reverb sends (per bus)                    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Timing Flow

### Rule: `AudioContext.currentTime` is the ONLY musical clock.

The foundation's `MusicalTransport.origin.audioTime` is in AudioContext-seconds. `NoteEvent.at` is `EventTime = number` (also AudioContext-seconds in practice). The sampler schedules `AudioBufferSourceNode.start(at)` against this clock.

### Scheduler design (runtime lookahead — GAP-S4 filled)

```
RuntimeScheduler:
  - timer: Web Worker (Blob URL) firing postMessage('tick') every 25ms
    (main-thread setInterval fallback if Worker unavailable)
  - horizon: 100ms lookahead (audioCtx.currentTime + 0.1)
  - queue: sorted array of {at, sampleId, playbackRate, amp, decay, pan, bus}
  - tick():
      while (queue.peek().at < audioCtx.currentTime + 0.1):
        event = queue.shift()
        if (event.at < audioCtx.currentTime):
          // stale event — drop (don't fire late)
          continue
        voice = voicePool.allocate()
        voice.trigger(event)
  - schedule(event):
      queue.insertSorted(event)  // by .at ascending
```

### What the sampler NEVER does

- ❌ `Date.now()` for musical timing
- ❌ `setInterval` as the musical clock (only as a timer to WAKE the scheduler)
- ❌ `setTimeout` for note scheduling
- ❌ `Math.random()` in the selection path (uses seeded `Rng`)

### Transport sync

When `onTransport(t)` fires:
- Store `bpm = t.bpm`
- Store `origin = t.origin` (audioTime + beatIndex + bpm)
- If `t.locked` is false, scheduler continues at last known bpm (holdover)

The sampler does NOT re-derive beat positions from transport — it trusts `NoteEvent.at` (which the host/director already computed from transport). This keeps the sampler a "dumb consumer" per the foundation's consumer-contract pattern.

---

## 7. Sample Lifecycle

```
1. INGESTION (build-time, offline)
   ├── Author creates WAV file (procedural or licensed)
   ├── Author adds entry to public/samples/manifest.json with FULL provenance:
   │     { id, file, category, subcategory, source, author, license,
   │       licenseUrl, commercialUse, duration, sampleRate, channels,
   │       character: [], genreFit: [], bpmRange: [min,max] }
   └── ProvenanceValidator.validate(entry) → must pass or REJECT

2. LOADING (runtime, on device init)
   ├── SampleLibrary.load(manifestUrl):
   │     for each entry in manifest:
   │       1. fetch(entry.file) → arrayBuffer
   │       2. audioCtx.decodeAudioData(arrayBuffer) → AudioBuffer
   │       3. Extract Float32Array (mono downmix if stereo)
   │       4. Compute features: peak, rms, duration (cheap — no DFT for MVP)
   │       5. Store as SampleAsset { id, metadata, audioBuffer, features }
   └── Library ready event fires

3. SELECTION (runtime, per NoteEvent)
   ├── SelectionPolicy.select({role, velocity, section, energy, phrasePosition, seed}):
   │     1. Filter library by role/category
   │     2. RoundRobinBank.next(category, phrasePosition) → variant index
   │     3. Apply pitch/gain/pan variance (phase-safe for kick)
   │     4. Return {sampleId, playbackRate, amp, pan}
   └── Deterministic: same inputs → same output

4. PLAYBACK (runtime, scheduled)
   ├── RuntimeScheduler fires voice.trigger(sampleData, sampleRate, playbackRate, ...)
   ├── SampleVoice renders via AudioBufferSourceNode (main-thread) OR worklet renderStereo
   └── Voice returns to pool when envelope completes

5. EVICTION (never)
   └── Samples stay loaded for device lifetime. No LRU. No unloading.
       (MVP library is small (~2MB). If library grows >50MB, add LRU.)
```

---

## 8. Voice Lifecycle

```
VoicePool<SampleVoice> (32 voices, preallocated at construction)

allocate():
  1. Scan pool for inactive voice (round-robin from `next`)
  2. If found: return it, advance `next`
  3. If all active: steal voices[next] (oldest in round-robin)
     - call stolen.panic() (hard stop)
     - return it, advance `next`

SampleVoice.trigger(sampleData, sampleRate, playbackRate, amp, decay, pan):
  1. Set active = true
  2. Create AudioBufferSourceNode (or reuse in worklet mode)
  3. Set playbackRate, connect gain envelope, connect panner
  4. source.start(at)
  5. Schedule source.onended → active = false (returns to pool)

SampleVoice.panic():
  - source.stop() immediately
  - active = false

Voice budget:
  - MAX_VOICES = 32 (matches psy4's proven size)
  - If allocate() called when all 32 active → steal oldest (kick/bass protected? NO — round-robin stealing is fair. MVP accepts this.)
  - Future: priority-based stealing (kick/bass > lead > pad > fx)
```

### Implementation choice: main-thread `AudioBufferSourceNode` vs AudioWorklet

**Decision: Main-thread `AudioBufferSourceNode` for MVP.**

Rationale (from audit, not assumption):
- The foundation's `VoicePool<V>` is a main-thread abstraction (`Voice` interface has `noteOn`/`noteOff`/`panic` — no `process()` method). It does NOT fit an AudioWorklet `process()` loop.
- psy4's worklet `SampleVoice` has a `renderStereo(currentTime, sr)` method — a sample-by-sample renderer for the worklet's `process()` loop. This is a DIFFERENT voice contract than foundation's `Voice`.
- For MVP, `AudioBufferSourceNode` is the Web Audio native primitive for sample playback with precise scheduling. It is zero-GC per note (the node is created once and reused via pool, or created/collected — see performance plan).
- AudioWorklet is justified ONLY for custom DSP that Web Audio can't express natively. Sample playback with pitch + envelope + pan IS expressible natively. **The audit confirms: do NOT assume AudioWorklet is required.**

**Migration path to AudioWorklet (future, if measured necessary):**
- If profiling shows main-thread `AudioBufferSourceNode` creation causes GC pressure at high voice counts (>24 simultaneous), migrate to a worklet with a `SampleVoice` that has a `process()` method.
- This requires EXTENDING the foundation's `Voice` interface (GAP-S8) OR bypassing `VoicePool<V>` for the sampler.
- This is a future architectural decision, not an MVP blocker.

---

## 9. Selection Model

### Inputs (from `NoteEvent` + `MusicalContext`)

| Input | Source | Used for |
|---|---|---|
| `event.note` (MIDI) | NoteEvent | Pitch transposition (`playbackRate = midiToFreq(target) / midiToFreq(root)`) |
| `event.velocity` (0-1) | NoteEvent | Gain scaling + velocity layer selection (future) |
| `event.channel` (string) | NoteEvent | Role/bank decoding (e.g. `"kick"`, `"hat"`, `"clap:909"`) |
| `event.at` (AudioTime) | NoteEvent | Scheduling |
| `context.section` | MusicalContext | Sample variant weighting (DROP → harder hits) |
| `context.energy` (0-1) | MusicalContext | Sample variant weighting (high energy → punchier) |
| `context.style` | MusicalContext | Genre fit filtering (e.g. "psytrance" → prefer 909 kicks) |
| `phrasePosition` (derived) | RuntimeScheduler (tracks phrase boundary) | Round-robin rotation |

### Channel string convention (documented, since NoteEvent is thin — GAP-S3)

The `channel` field is a free-form string. The sampler defines a convention:

```
channel = role[:bank]
Examples:
  "kick"          → role=kick, default bank
  "kick:909"      → role=kick, bank=909 (prefer 909 samples)
  "hat:closed"    → role=hat, bank=closed
  "clap"          → role=clap
  "perc"          → role=perc
  "bass"          → role=bass
  "lead"          → role=lead
```

This is the sampler's OWN convention — it does NOT modify the foundation's `NoteEvent` type. The sampler parses `channel` internally.

### Determinism

- `SelectionPolicy.select()` uses `Rng` (mulberry32) seeded from `(seed * 1000 + phrasePosition)`.
- Same `(seed, role, velocity, section, energy, phrasePosition)` → same `sampleId` + same variance.
- NO `Math.random()` in the selection path.
- The seed comes from the host (transport `revision` or a fixed demo seed).

### Round-robin rules (adapted from psy4, with doc/code reconciliation)

| Category | Variants | Pitch Var | Gain Var | Pan Var | Phase-safe? |
|---|---|---|---|---|---|
| kick | 4 | ±0.3% | ±4.5% | 0 (mono) | YES (never exceed ±0.5%) |
| hat (closed) | 4 | ±0.45% | 0 | ±0.045 | no constraint |
| hat (open) | 8 | ±1.75% | 0 | ±0.14 | no constraint |
| clap | 4 | ±0.3% | ±3% | 0 (mono) | YES |
| perc | 4 | ±0.5% | ±3% | ±0.05 | no constraint |
| bass | 2 | ±0.2% | 0 | 0 (mono) | YES |
| lead | 2 | ±1.0% | 0 | ±0.1 | no constraint |

Phrase-locked: variant index rotates ONLY on phrase boundary (every 8 bars by default). Within a phrase, the same variant plays for the same role.

---

## 10. Integration Boundaries

### WHAT/HOW boundary (enforced)

| Layer | Owner | Examples |
|---|---|---|
| **WHAT (foundation)** | `psy-foundation` | `MusicalEvent`, `MusicalTransport`, `MusicalContext`, `PsyDevice`, `DeviceHost`, `VoicePool`, `Rng` |
| **HOW (sampler)** | `psy-sampler` | `SampleLibrary`, `SampleVoice`, `SelectionPolicy`, `RoundRobinBank`, `RuntimeScheduler`, `AudioGraph` |
| **HOST (demo app)** | `src/app/page.tsx` | Transport source, musical director (generates NoteEvents), UI |

The sampler NEVER:
- Decides what role to play (host decides via NoteEvent.channel)
- Decides when to play (host decides via NoteEvent.at)
- Decides arrangement (host's musical director)
- Generates motifs/grammar (foundation's music package)
- Touches the transport (host owns TransportClock)

The sampler DOES:
- Decide which sample variant to use (SelectionPolicy)
- Decide pitch/gain/pan variance (RoundRobinBank)
- Manage voice allocation (VoicePool)
- Render audio (SampleVoice + AudioGraph)

### Files NOT to modify

- `psy-foundation/*` — the shim is verbatim, not modified
- Existing PSY family repos — this is a new sibling repo
- Foundation contracts — if a gap is found, it's documented (see §11), not silently extended

---

## 11. Architectural Risks + GAPs

### GAPs identified in foundation (from audit, with severity)

| ID | Severity | Gap | Sampler workaround |
|---|---|---|---|
| GAP-S1 | CRITICAL | No `'sample'` Material kind | Sampler keeps sample bank in private `Map<SampleId, SampleAsset>`, NOT in MaterialLibrary. Documented as a gap to lobby for. |
| GAP-S2 | CRITICAL | No sample-loading abstraction | Sampler builds `SampleLoader` (fetch + decodeAudioData). Not in foundation — correct, since foundation is headless. |
| GAP-S3 | CRITICAL | `NoteEvent` too thin (no bank/slice/variant) | Sampler encodes selection info into `channel` string convention. Documented. Future: propose `SampleNoteEvent` extension. |
| GAP-S4 | CRITICAL | No runtime scheduler | Sampler builds `RuntimeScheduler` (lookahead). Correct — foundation scheduler is offline-only by design. |
| GAP-S5 | HIGH | `PsyDevice.onTransport` takes v0, not v1 | Sampler consumes v0 `MusicalTransport` today. When foundation migrates DeviceHost to v1, sampler updates `onTransport` signature. Documented. |
| GAP-S6 | HIGH | No canonical `'sampler'` role | Sampler self-declares `roles: ['sampler']`. Documented convention. Future: canonicalize in protocol. |
| GAP-S7 | HIGH | Thin device-facing MusicalContext | Sampler uses only `section` + `energy` + `style` (all present in v0 context). Future: richer context for expressive selection. |
| GAP-S8 | MEDIUM | `Voice.noteOn(note, vel)` has no sample param | `SampleVoice` extends `Voice` with a `trigger(sampleData, ...)` method. `VoicePool<SampleVoice>` generic supports this. Not a contract violation. |
| GAP-S9 | MEDIUM | No enforced Math.random ban | Sampler self-imposes seeded `Rng`. No lint rule needed for MVP. |
| GAP-S10 | MEDIUM | No abstract BaseAudioDevice | Sampler implements `PsyDevice` directly. ~20 lines of boilerplate (transport/context caching). Acceptable. |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `AudioBufferSourceNode` creation per note causes GC at high voice counts | MEDIUM | Audio glitches | MVP voice count ≤32; profile with performance test; migrate to worklet if measured |
| Main-thread scheduler jitter (25ms timer) | LOW | ±12ms timing imprecision | Lookahead horizon 100ms absorbs jitter; AudioBufferSourceNode.start(at) is sample-accurate |
| Sample loading blocks main thread | MEDIUM | UI freeze during init | Load samples async with progress callback; decode in sequence (not parallel) to avoid memory spike |
| Channel string convention conflicts with host | LOW | Misrouted events | Document convention clearly; sampler logs unknown channels to console as warning |
| Foundation v0→v1 migration breaks sampler | MEDIUM | onTransport signature change | Sampler isolates transport handling in one method; migration is a one-line change |

---

## 12. Rejected Approaches

| Approach | Why rejected |
|---|---|
| Fork psy4's worklet wholesale | 2575 LoC, 11 synth voices we don't need, 5-bus architecture overkill, dead code, 141 unlicensed samples |
| Build sampler inside psy-foundation | Violates CONTRIBUTING rule #6 (no devices in foundation) |
| Build sampler as inline code in psy/psy3-clean/PSY6-ULTIMATE | Single-file HTML constraint forces inline; no DeviceHost runtime; duplicates contract |
| Use AudioWorklet for MVP | Not justified by audit — `AudioBufferSourceNode` is the native primitive for sample playback; worklet is for custom DSP |
| Extend foundation's `NoteEvent` with sample fields | Would modify canonical contract without approval — violates "no contract extension without explicit decision" |
| Use the 141 unlicensed psy4 samples | Violates project's own license policy; commercial hardware samples without provenance |
| Build a full musical director in the sampler | Violates WHAT/HOW boundary — the sampler is a dumb consumer of NoteEvents |

---

## 13. Unresolved Questions

| # | Question | Why it matters | Default decision for MVP |
|---|---|---|---|
| 1 | Should the sampler support stereo samples? | Most drums are mono; leads/pads may be stereo | MVP: mono only (downmix stereo). Document as limitation. |
| 2 | Should the sampler support sample slicing (one WAV, multiple regions)? | Useful for breakbeats | MVP: no slicing. One sample per file. Future: `Slice` metadata. |
| 3 | Should the sampler support velocity layers (multiple samples per note at different velocities)? | Standard for drum samplers | MVP: single layer, velocity scales gain. Future: multi-velocity. |
| 4 | Should the sampler expose MIDI OUT? | Could trigger external samplers | MVP: no MIDI OUT. MIDI is input-only (via host). |
| 5 | Should the sampler persist its state (selected samples, round-robin position)? | Useful for session recall | MVP: persistence via `localStorage` namespace `psy-sampler:`. |
| 6 | Should the sampler support hot-swap (load samples at runtime)? | Useful for live performance | MVP: load once at init. Future: `library.add(file)` API. |

---

## 14. Implementation Plan (summary — full plan in companion doc)

### Phase 1: Foundation shim (verbatim contracts)
- `src/psy-foundation-shim/{device,host,protocol,transport,rng}.ts`
- Verbatim copies with file-of-origin headers

### Phase 2: Sampler core
- `types.ts` — SampleId, SampleMetadata, SampleAsset, SampleFeatures
- `provenance.ts` — license validation
- `manifest.ts` — schema + validation
- `loader.ts` — fetch + decodeAudioData + feature extraction
- `library.ts` — SampleLibrary (Map-backed store)

### Phase 3: Voice layer
- `voice.ts` — SampleVoice (AudioBufferSourceNode-based, linear interp via playbackRate, gain envelope, equal-power pan)
- `voice-pool.ts` — VoicePool<SampleVoice> (preallocated, round-robin, stealing)
- `round-robin.ts` — RoundRobinBank (phrase-locked, phase-safe)

### Phase 4: Selection + scheduling
- `selector.ts` — SelectionPolicy (deterministic, context-aware)
- `scheduler.ts` — RuntimeScheduler (Worker timer, 100ms lookahead)
- `audio-graph.ts` — bus routing + FX sends

### Phase 5: Device
- `device.ts` — SamplerDevice implements PsyDevice
- `index.ts` — public exports

### Phase 6: MVP sample library
- `public/samples/manifest.json` — rich provenance
- 6 PSY3 procedural samples (reuse from psy4, properly licensed)
- Procedurally generate ~6 more (kick variants, perc, texture) via build script

### Phase 7: Host demo
- `src/app/page.tsx` — TransportClock + mini musical director + DeviceHost + SamplerDevice + UI

### Phase 8: Tests
- Contract, timing, samples, selection, voice, pitch, integration, regression

### Phase 9: Performance validation
- Voice count, scheduling load, memory, decode time, main-thread impact

---

## 15. Definition of Done (acceptance criteria)

- [ ] Sampler implements canonical `PsyDevice` (verbatim from foundation)
- [ ] Registered through canonical `DeviceHost`
- [ ] Consumes canonical `MusicalTransport` (v0)
- [ ] Consumes canonical `MusicalContext`
- [ ] Consumes canonical `MusicalEvent` (NoteEvent)
- [ ] Uses canonical timing (`AudioContext.currentTime`, no wall-clock)
- [ ] Deterministic sample selection (seeded `Rng`, no `Math.random`)
- [ ] Sample provenance/license metadata for every sample
- [ ] Robust sample loading (missing file → warning, not crash)
- [ ] Voice pooling / bounded allocation (32 max, stealing)
- [ ] Pitch handling (playbackRate, safe fallback)
- [ ] Round-robin where appropriate (phrase-locked, phase-safe for kick)
- [ ] Graceful missing-asset handling (skip event, log warning)
- [ ] Simultaneous operation with other devices (DeviceHost fan-out)
- [ ] No Foundation contract violation (shim is verbatim)
- [ ] No WHAT/HOW boundary violation (sampler makes no musical decisions)
- [ ] No duplicate transport (sampler reads transport, never owns it)
- [ ] No duplicate event system (sampler consumes events, never creates them)
- [ ] No duplicate scheduler (sampler has runtime scheduler for lookahead, but this is HOW, not WHAT)
- [ ] Tests pass (contract, timing, samples, selection, voice, pitch, integration)
- [ ] Performance acceptance criteria met (see plan doc)
- [ ] Documentation exists (this doc + plan doc + README)
- [ ] No unexplained architectural shortcuts

---

*End of audit. Companion document: `PSY-SAMPLER-IMPLEMENTATION-PLAN.md`.*
