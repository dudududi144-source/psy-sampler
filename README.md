# PSY Sampler Device

> A canonical realization device in the PSY family. Consumes `MusicalEvent`s from a `DeviceHost` and renders them as sample-based audio.

```
                 PSY4 (Host)
                 │
           CausalComposer
                 │
         CausalNoteEvent
                 │
          ┌──────┴──────┐
          │             │
    MaterialRealizer   SamplerBridge
    (PSY4 synth)       │
                      DeviceHost
                        │
                    SamplerDevice
                      (HOW only)
                        │
                  SampleVoice + VoicePool
                        │
                    AudioGraph
                        │
                  PSY4 Engine Bus
                  (shared master)
```

## What This Is

The PSY Sampler is a **realization device** — it receives `NoteEvent`s from a host (PSY4) and renders them as audio using sample playback. It does NOT compose, schedule, or own transport. It is a pure HOW layer.

**Host:** PSY4 (via `SamplerBridge` → `DeviceHost` → `SamplerDevice`)
**Audio:** Shared `AudioContext` + shared engine bus (no duplicate audio graph)
**Transport:** Consumed from host (no `DemoTransport` in production)
**Samples:** 19 procedural samples, all commercially usable

## Architecture

| Layer | Owner | What |
|---|---|---|
| **WHAT** (composition) | PSY4 `CausalComposer` | Decides what notes to play, when |
| **Contract** | `PsyDevice` interface | `onTransport`, `onContext`, `onEvent` |
| **Routing** | `DeviceHost` + `InMemoryChannel` | Fan-out events to registered devices |
| **HOW** (realization) | `SamplerDevice` | Sample selection, voice allocation, audio rendering |
| **Audio** | Shared `AudioContext` | One context per host, injected into device |

## Integration with PSY4

PSY4's `page.tsx` loads the sampler bundle and wires it:

```ts
const { SamplerBridge } = await import('../lib/sampler-bridge')
const bridge = new SamplerBridge()
e.attachSamplerBridge(bridge)

// On audio ready:
const samplerModule = await import('/psy-sampler.js')
const bundle = samplerModule.createSamplerDevice({
  audioContext: e.audioContext,      // SHARED
  manifestUrl: '/samples/manifest.json',
  outputNode: e.engineBusInput,      // SHARED master bus
})
bridge.register(bundle.device)
bundle.device.onStart?.()
await bundle.load()
```

PSY4's `psyLive.ts` publishes events:
```ts
// In scheduleStep(), after MaterialRealizer:
if (this.samplerBridge) {
  this.samplerBridge.publishNote(ev.at, {
    voice: ev.channel, midi: ev.note, velocity: ev.velocity
  }, false, ev.duration)
}
```

## Features

- **19 procedural samples** (kick/bass/lead/hat/clap/perc/texture/fx) — all CC0/no-copyright
- **Deterministic selection** — stateless, seeded (mulberry32). Same inputs → same output
- **Voice pool** — 32 preallocated voices, per-source gain for click-free stealing
- **Sidechain ducking** — kick ducks music+atmos buses (8ms attack, 150ms release)
- **3-bus mixer** — drum/music/atmos with gain/mute/solo
- **6 genre presets** — Psytrance/Techno/Progressive/Breaks/Minimal/Dark
- **Pattern save/load** — 4 localStorage slots + autosave
- **WAV export** — MediaRecorder with mimeType fallback (browser-portable)
- **Mobile UX** — 44px touch targets, responsive layout, no iOS zoom
- **ErrorBoundary** — graceful recovery from render errors
- **Keyboard shortcuts** — Space=play/stop, Escape=stop

## Key Files

```
src/psy-sampler/           ← the device package (HOW only)
├── device.ts              ← SamplerDevice implements PsyDevice
├── selector.ts            ← Deterministic, stateless sample selection
├── voice.ts               ← SampleVoice (per-source gain, click-free steal)
├── realization-scheduler.ts ← Device-local timing (fires at host-decided event.at)
├── audio-graph.ts         ← 3-bus mixer + sidechain + FX
├── library.ts             ← Parallel sample loading (concurrency 6)
├── loader.ts              ← fetch + decodeAudioData + feature extraction
├── manifest.ts            ← Verification-gated loader (VERIFIED/PROCEDURAL only)
├── provenance.ts          ← License enforcement
├── variance-rules.ts      ← Phase-safe pitch/gain/pan rules
├── factory.ts             ← createSamplerDevice() + dispose()
└── index.ts               ← Public API barrel

src/psy-foundation-shim/   ← Verbatim canonical contracts (PsyDevice, DeviceHost, etc.)
src/lib/                   ← Demo harness (DemoDirector, DemoTransport — test only)
src/app/page.tsx           ← Demo playground UI
public/psy-sampler.js      ← UMD bundle for cross-repo loading
public/samples/             ← 19 procedural WAVs + manifest.json
tests/psy-sampler/          ← 98 tests (contract, selection, voice, stress, render-proof)
```

## Foundation Contract

The sampler implements the canonical `PsyDevice` interface from `psy-foundation`:

```typescript
interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
```

Via a **verbatim shim** (pinned to foundation commit `4ae95d3`). The shim is a temporary adapter — when `@psy-foundation/*` is published to npm, replace `@/psy-foundation-shim` imports with real package imports.

## Determinism

- `SelectionPolicy` is stateless — same `(seed, role, phraseIndex)` → same sample
- `Rng` is mulberry32 (from foundation)
- No `Math.random()` in selection path
- Same event stream + same library → same audio output

## Testing

```bash
bun test tests/psy-sampler/  # 98 tests, 0 failures
bun run lint                  # ESLint clean
npx tsc --noEmit              # 0 TypeScript errors
```

Test coverage:
- Contract (11): PsyDevice implementation, DeviceHost registration, multi-device coexistence
- Selection (20): Determinism, phrase-locking, pitch variance, bank filter
- Voice (13): Pool allocation, stealing, panic, bounded concurrency
- Samples (23): Manifest validation, provenance enforcement, verification gating
- Stress (12): 1000 events, concurrent devices, memory stability
- Render-proof (7): Pitch correctness, voice leak, determinism
- Shim-sync (4): Foundation contract byte-equivalence
- Integration (8): Cross-repo event flow simulation

## License

MIT. All samples are procedurally generated (no copyright restriction).
