# PSY Sampler — Integration Guide

> How to connect the PSY Sampler Device to any PSY family host (PSY4, PSY6, or future products).

## Overview

The PSY Sampler is a **realization device** — it receives `NoteEvent`s and renders them as audio. It does not compose, schedule, or own transport. Any host that produces `NoteEvent`s can drive it.

```
Host (PSY4/PSY6/future)
  │
  Composition Engine → NoteEvent { type:'note', note, velocity, duration, channel, at }
  │
  SamplerBridge (adapter in host)
  │
  DeviceHost + InMemoryChannel (from foundation)
  │
  SamplerDevice (this repo)
  │
  Audio output (shared AudioContext)
```

## Step 1: Build the sampler bundle

```bash
cd psy-sampler
bun build src/psy-sampler/index.ts --outfile=public/psy-sampler.js --format=esm
```

This produces a 37KB ESM bundle at `public/psy-sampler.js`.

## Step 2: Copy bundle + samples to host

```bash
cp psy-sampler/public/psy-sampler.js  host/public/
cp -r psy-sampler/public/samples       host/public/
```

## Step 3: Create SamplerBridge in host

The host needs a `SamplerBridge` — an adapter that converts its internal note representation to canonical `NoteEvent`s and routes them through a `DeviceHost`.

See `psy-sampler/src/lib/` for a reference implementation. The bridge must:

1. Create an `InMemoryChannel` + `DeviceHost`
2. Convert host notes → `NoteEvent { type:'note', note, velocity, duration, channel, at }`
3. Call `host.publish(event)` for each note
4. Call `host.pushTransport(snapshot)` periodically
5. Expose `register(device)` so the sampler can be added

### Minimal bridge example

```typescript
import { InMemoryChannel, DeviceHost } from './sampler-bridge-contracts'

export class SamplerBridge {
  readonly host: DeviceHost

  constructor() {
    const channel = new InMemoryChannel('host-sampler')
    this.host = new DeviceHost(channel)
  }

  /** Call this when the host produces a note. */
  publishNote(time: number, note: { voice: string; midi: number | null; velocity: number }, stepDur: number): void {
    this.host.publish({
      type: 'note',
      note: note.midi ?? 60,
      velocity: note.velocity,
      duration: stepDur * 0.9,
      channel: note.voice,  // "kick", "bass", "lead", "hat-closed", etc.
      at: time,             // AudioContext.currentTime-based
    })
  }

  /** Call this when transport changes. */
  publishTransport(snap: { bpm: number; bar: number; revision: number }): void {
    this.host.pushTransport({
      bpm: snap.bpm, beat: snap.bar * 4, bar: snap.bar,
      beatsPerBar: 4, beatTime: 0, barTime: 0,
      phase: 0, barPhase: 0, confidence: 1, locked: true,
      revision: snap.revision,
      origin: { audioTime: 0, beatIndex: 0, bpm: snap.bpm },
      lastObservationAgo: 0, observationCount: 1,
    }, 0)
  }
}
```

## Step 4: Load sampler in host's page.tsx

```typescript
// After host engine initializes (AudioContext available):
const { SamplerBridge } = await import('../lib/sampler-bridge')
const bridge = new SamplerBridge()
hostEngine.attachSamplerBridge(bridge)

// Load the sampler bundle:
const samplerModule = await import('/psy-sampler.js')
const bundle = samplerModule.createSamplerDevice({
  audioContext: hostEngine.audioContext,  // SHARED — no duplicate AudioContext
  manifestUrl: '/samples/manifest.json',
  outputNode: hostEngine.engineBusInput,  // SHARED — routes through host's master chain
})

// Register the sampler device on the bridge's DeviceHost:
bridge.register(bundle.device)
bundle.device.onStart?.()

// Load samples (async, non-blocking):
await bundle.load()
console.log(`Sampler: ${bundle.library.size} samples loaded`)
```

## Step 5: Publish events from host's scheduler

In the host's note scheduler (e.g. `scheduleStep()`), after the host's own synth plays:

```typescript
// After host synth renders the note:
if (this.samplerBridge) {
  this.samplerBridge.publishNote(
    time,                           // AudioContext time
    { voice: note.channel,          // "kick", "bass", "lead", "hat"
      midi: note.midi,              // MIDI note (null for unpitched)
      velocity: note.velocity },
    stepDuration                     // 16th-note duration in seconds
  )
}
```

## Channel convention

The sampler parses `NoteEvent.channel` as `"role"` or `"role:bank"`:

| Channel | Role | Bus | Pitched? |
|---|---|---|---|
| `kick` | kick | drum | No (native pitch) |
| `bass` | bass | music | Yes (pitchRatio applied) |
| `lead` | lead | music | Yes (pitchRatio applied) |
| `hat-closed` | hat-closed | drum | No |
| `hat-open` | hat-open | drum | No |
| `clap` | clap | drum | No |
| `perc` | perc | drum | No |
| `texture` | texture | atmos | No |
| `fx` | fx | atmos | No |

Bank filter: `"kick:909"` selects only samples with `subcategory: "909"`.

## Shared resources

| Resource | Owner | How shared |
|---|---|---|
| **AudioContext** | Host | `createSamplerDevice({ audioContext: hostCtx })` |
| **Master bus** | Host | `outputNode: hostEngine.engineBusInput` |
| **Transport** | Host | `bridge.publishTransport(snapshot)` |
| **Sample library** | Sampler | `bundle.load()` fetches from `/samples/manifest.json` |
| **Voice pool** | Sampler | 32 preallocated voices (device-internal) |

## What the sampler does NOT own

- Transport (consumed via `onTransport`)
- Composition (zero `publish()` calls)
- AudioContext (injected by host)
- Master chain (routes to host's bus)
- Timing decisions (fires at host-decided `event.at`)

## Verification

### Unit tests (127 total)
```bash
bun test tests/psy-sampler/
```

### Engineering proofs (14 tests with spectral analysis)
- Pitch verification: kick → 55.2Hz, bass@octave → 110.3Hz
- Determinism: same seed → byte-identical rendered audio
- Voice stealing: 5ms fade → gain < 0.001
- Sidechain: min gain = 0.4, full recovery in 150ms

### Benchmark (5 tests)
- 10000 selections < 50ms
- 1000 events < 100ms
- Voice pool stays at 32 after 10000 events

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No sound from sampler | AudioContext not shared | Verify `audioContext: hostCtx` in `createSamplerDevice` |
| Samples don't load | Manifest 404 | Verify `/samples/manifest.json` is served |
| Kick pitched 2 octaves up | NoteEvent.note is placeholder | For unpitched roles, use `note: 0` (sampler skips pitchRatio for kick/hat/clap/perc) |
| Sampler too quiet | Output not routed through host bus | Set `outputNode: hostEngine.engineBusInput` |
| Duplicate AudioContext | Host creates its own | Don't create AudioContext in sampler — inject host's |
| Transport not updating | Dedup by revision | Disable `transportDedupByRevision` or bump revision per bar |
