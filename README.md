# PSY Sampler Device

> A canonical family member of the PSY music device family, implementing the `PsyDevice` interface from `psy-foundation`.

```
                 MUSICAL MODEL
                       │
                  FOUNDATION
                       │
                  DEVICE HOST
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      SYNTH           DRUMS        SAMPLER  ← this repo
        │              │              │
        └──────────────┼──────────────┘
                       │
                   AUDIO GRAPH
                       │
                    OUTPUT
```

## What this is

The PSY Sampler is a **device** (HOW layer) — not a synthesizer, not a composer, not a transport. It consumes canonical `MusicalEvent`s (`NoteEvent`) from a `DeviceHost` and renders them as sample-based audio via a pooled voice architecture with deterministic selection.

It fills the documented gap in the PSY family architecture: the third device alongside SYNTH and DRUMS.

## Architecture

See the two deliverable docs for the full design:

- **[`PSY-SAMPLER-ARCHITECTURE-AUDIT.md`](./PSY-SAMPLER-ARCHITECTURE-AUDIT.md)** — deep audit of all 6 PSY family repos, contract mapping, REUSE/ADAPT/REWRITE/REJECT classification, gap analysis, repo selection rationale.
- **[`PSY-SAMPLER-IMPLEMENTATION-PLAN.md`](./PSY-SAMPLER-IMPLEMENTATION-PLAN.md)** — file-by-file implementation plan, test matrix, performance criteria, acceptance checklist.

### Key decisions

| Decision | Rationale |
|---|---|
| New dedicated repo (not inside `psy-foundation`) | Foundation's CONTRIBUTING.md rule #6: "No device policy. Another device does not belong here." |
| Implements `PsyDevice` verbatim (via shim) | Canonical contract, not a fork. Shim is a verbatim copy with file-of-origin headers. |
| Main-thread `AudioBufferSourceNode` (not AudioWorklet) | Native Web Audio primitive for sample playback. Worklet is for custom DSP — not justified by audit. |
| Deterministic `SelectionPolicy` (seeded `Rng`) | No `Math.random()` in selection path. Same inputs → same output. |
| Phrase-locked round-robin | Variants rotate only on phrase boundary. Kick pitch variance ≤ ±0.5% (phase-safe). |
| Sample bank in private `Map` (not `MaterialLibrary`) | Foundation has no `'sample'` Material kind (GAP-S1). Documented as a gap to lobby for. |

## Quickstart

```bash
bun install
bun run dev        # http://localhost:3000
```

Click "Initialize Audio" → the device stack boots:
1. `AudioContext` created
2. `InMemoryChannel` + `DeviceHost` instantiated
3. `SamplerDevice` created + registered with host
4. `ReferenceDevice` stub registered (proves multi-device coexistence)
5. `DemoDirector` instantiated (mini pattern player)
6. MVP sample library loaded from `/samples/manifest.json` (12 samples, all commercially usable)

Press **PLAY** → the director fires `NoteEvent`s on a 16-step grid → the sampler selects samples deterministically → voices trigger → audio plays.

## Structure

```
src/
├── psy-foundation-shim/       ← verbatim canonical contracts (PsyDevice, DeviceHost, VoicePool, Rng, MusicalEvent, MusicalTransport, MusicalContext, Channel)
├── psy-sampler/               ← the device package
│   ├── types.ts               ← SampleId, SampleMetadata, SampleAsset, SelectionInput, ...
│   ├── provenance.ts          ← license validation (enforces "no sample without provenance")
│   ├── manifest.ts            ← manifest schema + validation
│   ├── loader.ts              ← fetch + decodeAudioData + feature extraction
│   ├── library.ts             ← SampleLibrary (Map-backed store)
│   ├── voice.ts               ← SampleVoice (AudioBufferSourceNode, linear interp, equal-power pan)
│   ├── round-robin.ts         ← RoundRobinBank (phrase-locked, phase-safe)
│   ├── selector.ts            ← SelectionPolicy (deterministic, context-aware)
│   ├── scheduler.ts           ← RuntimeScheduler (25ms Worker timer, 100ms lookahead)
│   ├── audio-graph.ts         ← bus routing (drum/music/atmos) + delay/reverb sends
│   ├── device.ts              ← SamplerDevice implements PsyDevice
│   ├── factory.ts             ← createSamplerDevice() wiring
│   └── index.ts               ← public API barrel
├── lib/
│   └── demo-director.ts       ← mini musical director (16-step pattern player)
└── app/
    └── page.tsx               ← demo host UI

public/samples/                ← MVP sample library (12 WAVs + manifest.json)
tests/psy-sampler/             ← test matrix (59 tests, all passing)
scripts/generate-samples.ts    ← procedural sample generator
```

## Tests

```bash
bun test tests/psy-sampler/
```

59 tests across 4 files:
- `contract.test.ts` — PsyDevice implementation, DeviceHost registration, transport/context/event reception, multi-device coexistence
- `selection.test.ts` — determinism, phrase-locking, pitch variance, Rng
- `voice.test.ts` — VoicePool allocation/stealing, RoundRobinBank variance rules
- `samples.test.ts` — manifest validation, provenance enforcement, missing-sample handling

## WHAT/HOW boundary

The sampler **never**:
- Decides WHAT to play (host's director decides via `NoteEvent`s)
- Decides WHEN to play (host sets `NoteEvent.at`)
- Touches the transport (host owns `DemoTransport`/`TransportClock`)
- Generates composition (foundation's music package does that)

The sampler **does**:
- Decide which sample variant to use (`SelectionPolicy`)
- Decide pitch/gain/pan variance (`RoundRobinBank`)
- Manage voice allocation (`VoicePool`)
- Render audio (`SampleVoice` + `AudioGraph`)

## Timing

`AudioContext.currentTime` is the **only** musical clock. The 25ms Web Worker timer only wakes the scheduler — it is never the musical clock. No `Date.now()`, no `setInterval` as musical clock, no `Math.random()` in the selection path.

## Sample provenance

Every sample in `public/samples/manifest.json` carries full provenance:
- `source`, `author`, `license`, `licenseUrl`, `commercialUse`, `attribution`, `dateAcquired`, `usageRestrictions`

The sampler **refuses to load** any sample with `commercialUse: false`. Policy: "NEVER assume a random downloaded sample is commercially usable."

The 12 MVP samples are:
- 6 PSY3 procedural samples (licensed "no copyright restriction")
- 6 procedurally generated by `scripts/generate-samples.ts` (licensed "no copyright restriction")

## Foundation gaps documented

The audit identified 10 gaps in `psy-foundation` for a sampler device. All are documented in `PSY-SAMPLER-ARCHITECTURE-AUDIT.md` §11. The most critical:

| Gap | Workaround |
|---|---|
| No `'sample'` Material kind | Sampler keeps bank in private `Map<SampleId, SampleAsset>` |
| `NoteEvent` too thin (no bank/slice) | Channel string convention: `"role:bank"` |
| No runtime scheduler | `RuntimeScheduler` built (lookahead pattern) |
| `PsyDevice.onTransport` takes v0 | Consume v0 today; migrate when foundation wires v1 |

## License

MIT (matching `psy-foundation`). Samples are individually licensed per their manifest entries (all "no copyright restriction" for MVP).
