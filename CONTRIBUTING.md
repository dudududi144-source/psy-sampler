# CONTRIBUTING — PSY Sampler Device

## Non-negotiable rules

1. **Investigation before code.** Read the actual code before making changes.
2. **No monolith.** Every module has an explicit API and tests.
3. **One source of truth.** Every piece of state has exactly one owner.
4. **Transport ≠ renderer ≠ UI.** The sampler is HOW only.
5. **No device policy.** The sampler receives events and renders them. It does NOT decide what to play.
6. **Every claim has evidence.** "Real-time" requires a benchmark. "Deterministic" requires a test.
7. **AudioContext.currentTime is the ONLY clock.** No `Date.now()`, no `setInterval` for musical timing.
8. **No `Math.random()` in the selection path.** Use seeded `Rng` (mulberry32).
9. **Foundation contracts are consumed, not duplicated.** The shim is temporary (see below).
10. **PSY4 is the host.** The sampler is a guest. DemoDirector is a test harness, not production.

## Architecture

```
PSY4 (Host — NOT in this repo)
  │
  CausalComposer → CausalNoteEvent
  │
  SamplerBridge (in psy4/src/lib/sampler-bridge.ts)
  │
  DeviceHost + InMemoryChannel (from foundation)
  │
  SamplerDevice (this repo — implements PsyDevice)
  │
  SampleVoice + VoicePool + AudioGraph
  │
  PSY4 Engine Bus (shared AudioContext)
```

### WHAT / HOW boundary

| Layer | Owner | What |
|---|---|---|
| **WHAT** | PSY4 `CausalComposer` | Decides what notes to play, when |
| **Contract** | `PsyDevice` interface | `onTransport`, `onContext`, `onEvent` |
| **HOW** | `SamplerDevice` (this repo) | Sample selection, voice allocation, audio rendering |
| **Audio** | Shared `AudioContext` | One context per host, injected into device |

### DemoDirector

`DemoDirector` (in `src/lib/demo-director.ts`) is a **test harness** — it simulates a host by generating NoteEvents from a 16-step pattern grid. It is used by:
- The demo playground UI (`src/app/page.tsx`) for standalone testing
- Integration tests that verify the sampler without running PSY4

It is **NOT** part of the sampler device architecture. In production, PSY4 replaces DemoDirector entirely.

## Foundation shim

The `src/psy-foundation-shim/` directory contains **verbatim copies** of canonical contracts from `psy-foundation`:

| Shim file | Canonical source | Pinned commit |
|---|---|---|
| `device.ts` | `packages/device-sdk/src/device.ts` | `4ae95d3` |
| `host.ts` | `packages/device-sdk/src/host.ts` | `4ae95d3` |
| `protocol.ts` | `packages/protocol/src/{state,events,channel}.ts` | `4ae95d3` |
| `transport.ts` | `packages/transport/src/types.ts` (v0 only) | `4ae95d3` |
| `voice-pool.ts` | `packages/dsp/src/voicePool.ts` + `packages/music/src/rng.ts` | `4ae95d3` |

### Removal path

The shim exists because `psy-foundation` is a Bun workspace monorepo that is **not published to npm**. When one of these happens, remove the shim:

1. **Publish `@psy-foundation/*` to npm** — Replace `@/psy-foundation-shim` imports with `@psy-foundation/*` package imports.
2. **Create a family monorepo** — Add both `psy-foundation` and `psy-sampler` as workspace packages. Import via `workspace:*` protocol.
3. **Use `file:` protocol** — `"@psy-foundation/device-sdk": "file:../psy-foundation/packages/device-sdk"` in `package.json`.

### Sync test

`tests/psy-sampler/shim-sync.test.ts` verifies the shim stays byte-equivalent to the canonical source. If foundation contracts evolve, the test fails and the shim must be re-synced.

## Testing

```bash
bun test tests/psy-sampler/   # 113 tests
bun run lint                   # ESLint
npx tsc --noEmit               # TypeScript
```

### Test structure

| File | What it tests |
|---|---|
| `contract.test.ts` | PsyDevice interface compliance, DeviceHost registration |
| `selection.test.ts` | Determinism, phrase-locking, pitch variance |
| `voice.test.ts` | VoicePool allocation, stealing, bounded concurrency |
| `samples.test.ts` | Manifest validation, provenance enforcement |
| `stress.test.ts` | 1000 events, concurrent devices, memory stability |
| `render-proof.test.ts` | Pitch correctness, voice leak, determinism |
| `shim-sync.test.ts` | Foundation contract byte-equivalence |
| `integration.test.ts` | Cross-repo event flow simulation |
| `psy4-integration.test.ts` | PSY4 → Sampler bridge flow proof |
| `benchmark.test.ts` | Performance measurements |

## Adding samples

All samples must:
1. Be **procedurally generated** (no external audio) OR have **explicit license metadata**
2. Be declared in `public/samples/manifest.json` with full provenance
3. Have `verification: "PROCEDURAL"` or `"VERIFIED"` (never `"UNKNOWN"` or `"QUARANTINED"`)
4. Have `commercialUse: true`

Use `scripts/generate-samples-v2.ts` to generate new procedural samples.

## Code style

- TypeScript strict mode
- shadcn/ui components (only `badge`, `button`, `card`, `slider`, `toast`, `toaster`)
- Tailwind CSS 4
- No `any` types (use `unknown` + type guard)
- No `Math.random()` in device code
- `AudioContext.currentTime` is the only musical clock
