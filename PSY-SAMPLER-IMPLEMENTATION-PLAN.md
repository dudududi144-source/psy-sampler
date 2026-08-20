# PSY-SAMPLER-IMPLEMENTATION-PLAN.md

> **Companion to:** `PSY-SAMPLER-ARCHITECTURE-AUDIT.md`. Read the audit first — this plan assumes its decisions.

---

## 0. Implementation Order (strict)

```
1. Foundation shim (verbatim contracts)     ← no device can exist without the contract
2. Types + provenance + manifest             ← data shapes before logic
3. Loader + library                          ← samples must be loadable before playable
4. SampleVoice + VoicePool                   ← rendering primitive
5. RoundRobinBank                            ← selection needs variant rotation
6. SelectionPolicy                           ← deterministic sample choice
7. RuntimeScheduler                          ← lookahead firing
8. AudioGraph                                ← bus routing
9. SamplerDevice                             ← wires everything into PsyDevice
10. MVP sample library                       ← content to play
11. Host demo UI                             ← user-visible proof
12. Tests                                    ← verification
13. Performance validation                   ← acceptance
14. Push to GitHub                           ← delivery
```

No phase starts before its predecessor is verifiably complete. UI is phase 11, NOT phase 1.

---

## 1. Files to Create

### Phase 1: Foundation shim (5 files)

| File | Source (verbatim from) | LoC |
|---|---|---|
| `src/psy-foundation-shim/device.ts` | `psy-foundation/packages/device-sdk/src/device.ts` | ~15 |
| `src/psy-foundation-shim/host.ts` | `psy-foundation/packages/device-sdk/src/host.ts` | ~95 |
| `src/psy-foundation-shim/protocol.ts` | `psy-foundation/packages/protocol/src/{state,events,channel}.ts` merged | ~120 |
| `src/psy-foundation-shim/transport.ts` | `psy-foundation/packages/transport/src/{types,transport}.ts` (v0 only) | ~180 |
| `src/psy-foundation-shim/rng.ts` | `psy-foundation/packages/music/src/rng.ts` | ~35 |

Each file has a header: `// VERBATIM SHIM from psy-foundation/packages/<pkg>/src/<file>.ts — do not modify. Replace with @psy-foundation/<pkg> import when integrated into workspace.`

### Phase 2: Types + provenance + manifest (3 files)

| File | Purpose | Key exports |
|---|---|---|
| `src/psy-sampler/types.ts` | All sampler-specific types | `SampleId`, `SampleCategory`, `SampleMetadata`, `SampleAsset`, `SampleFeatures`, `ChannelConvention` |
| `src/psy-sampler/provenance.ts` | License validation | `validateProvenance(entry)`, `isCommerciallyUsable(metadata)` |
| `src/psy-sampler/manifest.ts` | Manifest schema + loading | `SampleManifestEntry`, `loadManifest(url)`, `validateManifest(data)` |

### Phase 3: Loader + library (2 files)

| File | Purpose | Key exports |
|---|---|---|
| `src/psy-sampler/loader.ts` | fetch + decodeAudioData + feature extraction | `SampleLoader`, `decodeSample(ctx, url)`, `extractFeatures(audioBuffer)` |
| `src/psy-sampler/library.ts` | In-memory sample store | `SampleLibrary`, `library.load(manifest, ctx)`, `library.get(id)`, `library.query({category, subcategory})` |

### Phase 4: Voice layer (3 files)

| File | Purpose | Key exports |
|---|---|---|
| `src/psy-sampler/voice.ts` | Single sample-playback voice | `SampleVoice extends Voice`, `voice.trigger(asset, opts)`, `voice.panic()` |
| `src/psy-foundation-shim/voice-pool.ts` | Verbatim VoicePool from dsp | `VoicePool<V extends Voice>`, `pool.allocate()`, `pool.allOff()`, `pool.panic()` |
| `src/psy-sampler/round-robin.ts` | Phrase-locked variant rotation | `RoundRobinBank`, `bank.next(category, phrasePosition)`, documented variance tables |

### Phase 5: Selection + scheduling + graph (3 files)

| File | Purpose | Key exports |
|---|---|---|
| `src/psy-sampler/selector.ts` | Deterministic sample selection | `SelectionPolicy`, `selector.select({role, velocity, section, energy, phrasePosition, seed})` |
| `src/psy-sampler/scheduler.ts` | Runtime lookahead scheduler | `RuntimeScheduler`, `scheduler.start(ctx)`, `scheduler.schedule(event)`, `scheduler.stop()` |
| `src/psy-sampler/audio-graph.ts` | Bus routing + FX sends | `AudioGraph`, `graph.create(ctx)`, `graph.getBus(name)`, `graph.connect(source, bus)` |

### Phase 6: Device (2 files)

| File | Purpose | Key exports |
|---|---|---|
| `src/psy-sampler/device.ts` | SamplerDevice implements PsyDevice | `SamplerDevice`, `createSamplerDevice(opts)` |
| `src/psy-sampler/index.ts` | Public API barrel | re-exports all public types + `createSamplerDevice` |

### Phase 7: MVP sample library

| File | Purpose |
|---|---|
| `public/samples/manifest.json` | Rich provenance manifest (~12 entries) |
| `public/samples/*.wav` | 6 PSY3 procedural samples (reused) + ~6 generated |
| `scripts/generate-samples-v2.ts` | Procedural sample generator (all 31 samples: kicks, snares, claps, hats, bass, lead, perc, texture) — uses biquad filters, pink noise, ADSR, saturation |

### Phase 8: Host demo

| File | Purpose |
|---|---|
| `src/app/page.tsx` | Demo host: TransportClock + mini director + DeviceHost + SamplerDevice + UI |
| `src/lib/demo-director.ts` | Mini musical director (generates NoteEvents from a pattern) |
| `src/app/api/samples/[...path]/route.ts` | Static sample file serving (Next.js route) |

### Phase 9: Tests

| File | Covers |
|---|---|
| `tests/psy-sampler/contract.test.ts` | PsyDevice implementation, registration, transport/context/event reception |
| `tests/psy-sampler/timing.test.ts` | Event scheduling at correct AudioTime, no wall-clock |
| `tests/psy-sampler/samples.test.ts` | Manifest validation, missing sample handling, license validation, decode failures |
| `tests/psy-sampler/selection.test.ts` | Deterministic seed, same input → same sample, different seed → valid variation |
| `tests/psy-sampler/voice.test.ts` | Allocation, stealing, max voices, release, no runaway |
| `tests/psy-sampler/pitch.test.ts` | Known sample → expected playback ratio, invalid fundamental → safe fallback |
| `tests/psy-sampler/integration.test.ts` | DeviceHost registration, simultaneous devices, context/section changes, transport start/stop |

---

## 2. Files to Modify

| File | Change | Reason |
|---|---|---|
| `package.json` | Add `@psy-foundation/shim` alias (tsconfig paths), test script | Workspace-less shim resolution |
| `tsconfig.json` | Add path alias `@psy-foundation/*` → `src/psy-foundation-shim/*` | Clean import paths that match future workspace |
| `.gitignore` | Add `upload/`, `psy-audit/`, `*.env` | Don't expose credentials or audit workspace |
| `src/app/page.tsx` | Replace placeholder with sampler demo host | User-visible proof |

---

## 3. Files NOT to Modify

- `psy-foundation/*` (the cloned audit copy at `/home/z/my-project/psy-audit/psy-foundation/`) — reference only, never written to
- Any file in `psy/`, `psy3-clean/`, `psy4/`, `psy5/`, `PSY6-ULTIMATE/` cloned repos — reference only
- `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json` — Next.js config is stable
- `prisma/` — sampler uses no database
- `mini-services/` — sampler uses no WebSocket services
- `skills/` — not relevant
- The uploaded `.env` file (`/home/z/my-project/upload/push and i will revove.env`) — **NEVER commit, NEVER push, NEVER log its contents**

---

## 4. Dependency Graph

```
psy-foundation-shim
  ├─ device.ts        ← (no deps)
  ├─ protocol.ts      ← (no deps)
  ├─ transport.ts     ← protocol.ts
  ├─ host.ts          ← device.ts, protocol.ts, transport.ts
  ├─ voice-pool.ts    ← (no deps)
  └─ rng.ts           ← (no deps)

psy-sampler
  ├─ types.ts         ← (no deps)
  ├─ provenance.ts    ← types.ts
  ├─ manifest.ts      ← types.ts, provenance.ts
  ├─ loader.ts        ← types.ts, manifest.ts
  ├─ library.ts       ← types.ts, loader.ts, manifest.ts
  ├─ voice.ts         ← types.ts, psy-foundation-shim/voice-pool.ts
  ├─ round-robin.ts   ← types.ts, psy-foundation-shim/rng.ts
  ├─ selector.ts      ← types.ts, round-robin.ts, library.ts, psy-foundation-shim/rng.ts
  ├─ scheduler.ts     ← types.ts, voice.ts, psy-foundation-shim/voice-pool.ts
  ├─ audio-graph.ts   ← types.ts
  ├─ device.ts        ← ALL ABOVE + psy-foundation-shim/{device,host,protocol,transport}
  └─ index.ts         ← re-exports

app layer
  ├─ demo-director.ts ← psy-sampler, psy-foundation-shim
  └─ page.tsx         ← demo-director, psy-sampler, psy-foundation-shim
```

No cycles. No upward dependencies from shim to sampler.

---

## 5. Test Plan

### Test matrix

| Category | Test | Acceptance |
|---|---|---|
| **Contract** | `SamplerDevice implements PsyDevice` | All 7 methods present, correct signatures |
| | `capabilities()` returns `roles: ['sampler']` | role string matches convention |
| | `DeviceHost.register(sampler)` succeeds | No throw, `deviceCount === 1` |
| | `host.pushTransport(t)` → `sampler.onTransport(t)` called | `lastTransport` cached |
| | `host.pushContext(c)` → `sampler.onContext(c)` called | `lastContext` cached |
| | `host.publish(noteEvent)` → `sampler.onEvent(e)` called | Event received, queued for scheduling |
| | `onStart()` / `onStop()` lifecycle | Called on host start/stop |
| **Timing** | Event scheduled at `at = ctx.currentTime + 0.5` fires at ±5ms of target | Measured via AnalyserNode or offline render |
| | No `Date.now()` in scheduling path | Code grep + runtime check |
| | No `setInterval` as musical clock | Only as timer to wake scheduler |
| | Stale event (`at < ctx.currentTime`) is dropped, not fired late | Logged as warning |
| **Samples** | Manifest with missing `license` field → `validateProvenance` rejects | Throws `ProvenanceError` |
| | Manifest with valid provenance → loads | All entries parsed |
| | Missing sample file (404) → warning, device continues | Other samples still loadable |
| | Malformed WAV (decode failure) → warning, device continues | Other samples still loadable |
| | Empty manifest → device starts with empty library, `onEvent` is no-op | No crash |
| **Selection** | Same `(seed, role, velocity, section, energy, phrasePosition)` → same sampleId | Deterministic across 100 runs |
| | Different seed → different sampleId (if variants exist) | Variation is real |
| | No `Math.random()` in selection path | Code grep |
| | Phrase-locked: same phrasePosition → same variant | Round-robin doesn't rotate mid-phrase |
| | Kick pitch variance never exceeds ±0.5% | Phase-safe rule enforced |
| **Voice** | `voicePool.allocate()` returns inactive voice first | Round-robin preference |
| | All voices active → steals oldest | `panic()` called on stolen voice |
| | Max 32 voices — 33rd allocate steals, doesn't create | Bounded |
| | `voice.trigger()` sets `active = true` | State tracked |
| | `source.onended` → `active = false` (returns to pool) | No leak |
| | `panic()` stops immediately | Hard cut |
| **Pitch** | `playbackRate = 2.0` → sample plays one octave up | Verified via frequency analysis |
| | `playbackRate = 0.5` → sample plays one octave down | Verified |
| | Invalid fundamental (NaN/0) → `playbackRate = 1.0` (safe fallback) | No crash |
| **Integration** | `DeviceHost` with SamplerDevice + ReferenceDevice (simulated synth) | Both receive events |
| | Context change (section = 'DROP') → selector uses new section | Selection adapts |
| | Transport start/stop → scheduler starts/stops | Lifecycle wired |
| | Rapid event stream (100 events/sec) → no voice leak | Active count bounded |
| **Regression** | Foundation shim types match foundation source | Verbatim check (diff) |
| | No `Math.random` in shim (except ReferenceDevice id, which is verbatim) | Audit |

### Test runner

- `bun test` (Bun's native test runner, already available)
- Tests in `tests/psy-sampler/*.test.ts`
- Audio tests use `OfflineAudioContext` for deterministic rendering (no real-time dependency)

---

## 6. Performance Plan

### Acceptance criteria (measured, not assumed)

| Metric | Target | Measurement |
|---|---|---|
| Voice count (peak) | ≤ 32 simultaneous | `voicePool.activeCount` never exceeds 32 |
| Scheduling load (per tick) | < 1ms for 100 queued events | `performance.now()` around tick() |
| Memory (sample library) | < 10MB for MVP (~12 samples) | `performance.memory.usedJSHeapSize` before/after load |
| Decode time (per sample) | < 50ms for < 1s WAV | `performance.now()` around decodeAudioData |
| Main-thread impact (during playback) | < 5% CPU at 145 BPM, 16th-note pattern | DevTools profiler |
| Voice stealing latency | < 1ms from `panic()` to re-trigger | `performance.now()` |
| Long-running stability | No voice leak over 10 minutes (145 BPM) | `activeCount` returns to 0 after stop |

### What we do NOT claim without measurement

- ❌ "Zero GC" — `AudioBufferSourceNode` creation per note does allocate. We measure and report.
- ❌ "Sample-accurate timing" — Web Audio `start(at)` is sample-accurate, but our 25ms timer introduces ±12ms scheduling jitter. The 100ms lookahead absorbs this.
- ❌ "Real-time safe" — main-thread scheduling is NOT real-time safe. If measurement shows glitches, we migrate to AudioWorklet (documented future path).

---

## 7. Migration Risk

### Risk: Foundation v0→v1 transport migration

**Current:** `PsyDevice.onTransport(MusicalTransport)` takes v0 type (13 fields).
**Future:** Foundation migrates DeviceHost to v1 `TransportSnapshot` (16 fields, readonly, with `epoch`/`source`/`holdover`/`predictBeats`).

**Migration cost:** One method signature change in `device.ts`. The sampler isolates transport reading in `onTransport()` — migration is a 5-line change.

### Risk: NoteEvent extension (GAP-S3)

If foundation adds `bank`/`slice`/`variant` fields to `NoteEvent`, the sampler's `channel` string convention becomes redundant.

**Migration cost:** `SelectionPolicy.select()` reads `event.channel` today → reads `event.bank` tomorrow. ~10 lines changed. Convention documented as transitional.

### Risk: AudioWorklet migration

If measurement shows main-thread `AudioBufferSourceNode` causes GC pressure:

**Migration cost:** Replace `SampleVoice` (AudioBufferSourceNode-based) with a worklet `SampleVoice` (renderStereo-based). Requires:
1. New `psy4-engine.js`-style worklet (extracted, ~300 LoC, NOT the full 2575 LoC)
2. `VoicePool` extension to support `process()`-based voices (OR bypass VoicePool for sampler)
3. `loadSamples` postMessage protocol (reuse from psy4 verbatim)

This is a future architectural decision, gated on measurement. NOT an MVP blocker.

---

## 8. Rollback Strategy

The sampler is a NEW repo (`psy-sampler`). It does not modify any existing repo. Rollback = delete the repo or revert the push. No existing functionality is affected.

Within the repo:
- Each phase is independently revertable (git commits per phase)
- The shim is isolated — removing it doesn't affect the sampler's internal logic (only its contract compliance)
- The MVP sample library is static files — removing samples doesn't crash the device (graceful degradation)

---

## 9. Acceptance Criteria (Definition of Done)

### Contract compliance
- [ ] `SamplerDevice implements PsyDevice` (TypeScript compiler enforces)
- [ ] `DeviceHost.register(sampler)` succeeds
- [ ] `host.pushTransport(t)` reaches `sampler.onTransport(t)`
- [ ] `host.pushContext(c)` reaches `sampler.onContext(c)`
- [ ] `host.publish(noteEvent)` reaches `sampler.onEvent(e)`
- [ ] `capabilities().roles` includes `'sampler'`

### Timing compliance
- [ ] No `Date.now()` in `src/psy-sampler/` (grep)
- [ ] No `setInterval` as musical clock (only in `RuntimeScheduler` as timer)
- [ ] No `Math.random()` in `src/psy-sampler/` (grep)
- [ ] Events fire within ±5ms of `event.at` (measured)

### Sample compliance
- [ ] Every sample in `manifest.json` has `license` + `source` + `author` fields
- [ ] `validateProvenance(entry)` passes for all MVP samples
- [ ] Missing sample file → warning, not crash
- [ ] Malformed WAV → warning, not crash

### Selection compliance
- [ ] Same inputs → same output (100 runs, identical)
- [ ] Kick pitch variance ≤ ±0.5%
- [ ] Phrase-locked rotation (no mid-phrase rotation)

### Voice compliance
- [ ] Max 32 voices (never 33rd created)
- [ ] Stealing calls `panic()` on stolen voice
- [ ] `onended` returns voice to pool (no leak over 10 min)

### Integration compliance
- [ ] Coexists with `ReferenceDevice` in same `DeviceHost`
- [ ] Transport start/stop → scheduler start/stop
- [ ] Context change → selector adapts

### Foundation compliance
- [ ] Shim is verbatim (diff against foundation source = 0 non-comment changes)
- [ ] No foundation file modified
- [ ] No `NoteEvent` extension (channel convention only)

### Documentation
- [ ] `PSY-SAMPLER-ARCHITECTURE-AUDIT.md` exists
- [ ] `PSY-SAMPLER-IMPLEMENTATION-PLAN.md` exists (this doc)
- [ ] `README.md` exists with quickstart

### Delivery
- [ ] Pushed to GitHub (new repo `psy-sampler`)
- [ ] `.env` file NOT pushed (verified in `.gitignore` + pre-push check)
- [ ] `psy-audit/` NOT pushed (audit workspace, not deliverable)

---

## 10. MVP Sample Library Specification

### Categories and counts (MVP target)

| Category | Count | Source | Notes |
|---|---|---|---|
| kick | 3 | 1 PSY3 + 2 generated | Phase-safe round-robin (4 variants target, 3 acceptable) |
| bass | 2 | 1 PSY3 + 1 generated | Mono, low pitch variance |
| lead | 2 | 1 PSY3 + 1 generated | Stereo-able |
| hat (closed) | 2 | 1 PSY3 + 1 generated | |
| hat (open) | 1 | 1 PSY3 | |
| clap | 2 | 1 PSY3 + 1 generated | |
| perc | 2 | 2 generated | |
| texture | 1 | 1 generated | For atmos bus |
| **Total** | **15** | | |

### Provenance schema (per manifest entry)

```json
{
  "id": "kick-909-02",
  "file": "samples/909_BD_02.wav",
  "category": "kick",
  "subcategory": "909",
  "source": "PSY3 repository (procedural sample)",
  "author": "PSY3 project",
  "license": "PSY3 reference (procedural sample, no copyright restriction)",
  "licenseUrl": null,
  "commercialUse": true,
  "attribution": "Generated by PSY3 for testing/reference",
  "dateAcquired": "2025-01-15",
  "usageRestrictions": "None — freely usable",
  "duration": 0.28,
  "sampleRate": 44100,
  "channels": 1,
  "character": ["deep", "punchy"],
  "genreFit": ["psytrance", "techno"],
  "bpmRange": [120, 160],
  "rootNote": 33
}
```

### License policy

- **ALL samples must have `license` + `source` + `author` + `commercialUse` fields.**
- **NO sample is loaded if `commercialUse === false`** (sampler refuses to load it, logs error).
- **Procedurally generated samples** (built by `scripts/generate-samples-v2.ts`) are licensed `"Procedurally generated by psy-sampler build script — no copyright restriction"`.
- **PSY3 samples** (reused from psy4) retain their original license string.

---

## 11. Host Demo Specification

### What the demo proves

1. **Contract compliance:** SamplerDevice registers with DeviceHost, receives transport/context/events.
2. **End-to-end audio:** NoteEvents → sample selection → voice triggering → audio output.
3. **Deterministic selection:** Same seed → same audio.
4. **Coexistence:** Sampler + ReferenceDevice (simulated synth) both receive events.

### Demo components

```
src/app/page.tsx
├── Transport control (BPM, play/stop)
├── Pattern editor (16-step grid, 6 tracks: kick/bass/lead/hat/clap/perc)
├── Sample library browser (lists loaded samples, shows provenance)
├── Device status panel (sampler registered, voices active, last event)
├── Audio visualizer (waveform from AnalyserNode)
└── Transport/Context live display
```

### Mini musical director

`src/lib/demo-director.ts`:
- Reads a 16-step pattern (user-editable via UI)
- On each 16th-note tick, generates `NoteEvent`s for active steps
- Each NoteEvent has `channel` = role (e.g. "kick", "hat:closed")
- Publishes events via `host.publish(event)`
- Respects transport (only fires when `isPlaying`)

This is a MINIMAL director — it does NOT do composition, arrangement, or grammar. It's a pattern player that proves the sampler works end-to-end. The real musical director (future, from foundation's music package) would replace this.

---

## 12. Push to GitHub

### Target repo

**New repo:** `psy-sampler` (created via GitHub API using the provided token)

### Pre-push checklist

- [ ] `.gitignore` includes: `upload/`, `psy-audit/`, `*.env`, `.next/`, `node_modules/`, `dev.log`
- [ ] No `.env` file in working tree (only in `upload/` which is gitignored)
- [ ] `PSY-SAMPLER-ARCHITECTURE-AUDIT.md` + `PSY-SAMPLER-IMPLEMENTATION-PLAN.md` at root
- [ ] `README.md` with quickstart
- [ ] All source in `src/`
- [ ] MVP samples in `public/samples/`
- [ ] Tests in `tests/psy-sampler/`

### Push command

```bash
# Create repo via API
curl -X POST https://api.github.com/user/repos \
  -H "Authorization: token $GITHUB_TOKEN" \
  -d '{"name":"psy-sampler","description":"PSY Sampler Device — canonical family member implementing PsyDevice","private":false}'

# Push
git remote add origin https://$GITHUB_TOKEN@github.com/dudududi144-source/psy-sampler.git
git push -u origin main
```

### Post-push verification

- [ ] Repo exists at `https://github.com/dudududi144-source/psy-sampler`
- [ ] `.env` is NOT in the repo (check via API: `GET /repos/.../contents/.env` → 404)
- [ ] All files present (audit doc, plan doc, src/, public/, tests/)

---

*End of implementation plan. Audit document: `PSY-SAMPLER-ARCHITECTURE-AUDIT.md`.*
