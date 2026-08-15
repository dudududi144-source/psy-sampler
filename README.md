# PSY Sampler Device

> A canonical realization device in the PSY family. Consumes `MusicalEvent`s from a `DeviceHost` and renders them as sample-based audio. Now a full production tool — not just a demo.

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
                   (3 buses + FX)
                        │
                  Brickwall Limiter
                        │
                  PSY4 Engine Bus
```

## What This Is

The PSY Sampler is a **realization device** — it receives `NoteEvent`s from a host and renders them as audio using sample playback. It does NOT compose, schedule, or own transport. It is a pure HOW layer.

**31 procedural samples** with velocity layers + round-robin. **31 features**. **14 keyboard shortcuts**. **283 tests**. **0 TypeScript errors**.

## Features

### Pattern Editor
- **Per-step velocity** (0-127 MIDI standard) — not binary on/off
- **Pattern length** — 8 / 16 / 32 steps (selectable)
- **Drag-paint** — mousedown + drag paints velocity; Shift=accent, Alt=erase
- **Per-step probability** — 100→75→50→25→100% (human-like variation, deterministic seeded RNG)
- **Copy/paste between roles** — ⧉ copy, ⤓ paste (adjusts length automatically)
- **Undo/redo** — 50-step history (Ctrl+Z / Ctrl+Shift+Z)
- **Clear pattern** — CLR button or C key

### Transport
- **PLAY/STOP** — Space
- **BPM** slider (100-180) + **tap tempo** (T key)
- **Swing** (0-70%)
- **Master volume**
- **Section** dropdown (INTRO/BUILD/DROP/BREAK/RISER)
- **Energy** slider

### Audio Engine
- **3-bus mixer** (drum/music/atmos) with per-bus:
  - Gain + mute + solo
  - 3-band EQ (lowShelf 200Hz / peaking 1kHz / highShelf 4kHz)
  - Saturation (tanh waveshaper, 2× oversample, 0-10 drive)
- **Master filter** — LP (auto-wah on kick) / HP / off
- **Sidechain ducking** — kick ducks music+atmos (PUMP toggle)
- **Brickwall limiter** — threshold=-1dB, ratio=20:1 (prevents clipping)
- **Choke groups** — hat-closed chokes hat-open (2ms fade)
- **Velocity layers** — soft/hard kick + clap (selector picks by velocity)
- **Round-robin** — 3 hat-closed, 3 perc, 2 hat-open variants (deterministic)
- **Oversampled playback** — 2× anti-alias lowpass + cascaded for >2× pitch
- **Deterministic reverb** — seeded mulberry32 IR (byte-identical across runs)
- **O(1) voice allocation** — free-list (was O(n))

### Song Mode
- **Song arrangement** — chain saved slots into A→B→A→C
- **Timeline view** — visual segments + moving playhead
- **Auto-advance** — director switches patterns at bar boundaries

### Automation
- **6 tracks** — FLT FREQ, MASTER, DRUM/MUSIC/ATMOS GAIN, DRUM SAT
- **Breakpoint editor** — click to add, SVG polyline interpolation
- **Live application** — director samples bank on every tick

### I/O
- **Offline WAV export** — deterministic, 28× faster than real-time
- **Stem export** — drum/music/atmos as separate WAVs
- **Live recording** — MediaRecorder captures live performance
- **Project save/load** — .psy.json (pattern + mixer + song + all settings)
- **Sample import** — drag-drop WAV with mandatory provenance assertion
- **MIDI input** — Web MIDI API (play from keyboard, CC→filter/gain)
- **Multi-output** — each bus as separate MediaStream

### Visualizer
- **3 modes** — BARS (spectrum), WAVE (oscilloscope), BOTH
- DPR-aware canvas + ResizeObserver

### Session
- **Full session persistence** — restores everything on reload
- **Autosave** — pattern + transport + mixer + probabilities

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Space | Play / Stop |
| Escape | Stop |
| T | Tap tempo |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z | Redo |
| ? | Help overlay |
| M | Mute drum bus |
| S | Solo drum bus |
| C | Clear pattern |
| F | Cycle filter (off→lp→hp) |
| P | Toggle pump |
| E | Toggle evolve |
| R | Toggle recording |
| 1/2/3 | Pattern length (8/16/32) |

## Architecture

| Layer | Owner | What |
|---|---|---|
| **WHAT** (composition) | PSY4 `CausalComposer` | Decides what notes to play, when |
| **Contract** | `PsyDevice` interface | `onTransport`, `onContext`, `onEvent` |
| **HOW** (realization) | `SamplerDevice` | Sample selection, voice allocation, audio rendering |
| **Audio** | `AudioGraph` | 3 buses + EQ + saturation + filter + limiter |

## Determinism Contract

Same inputs → byte-identical audio:
- Seeded selection (mulberry32, stateless)
- Seeded reverb IR (fixed per-channel seeds)
- Seeded round-robin (event-order-dependent, not wall-clock)
- Seeded probability (same seed + same bar + same step → same skip)
- Offline render produces byte-identical WAVs

## Testing

- **283 tests** across 21 files
- **166,787 expects**
- Real audio rendering (OfflineAudioContext) + spectral analysis
- Pitch detection (autocorrelation)
- Byte-identical replay proof
- Voice stealing + choke group proofs
- Velocity layer + round-robin selection proofs
- Performance benchmarks (10,000 selections < 50ms)

## Sample Library

31 procedural samples (all CC0 / no copyright):
- 4 velocity-layer pairs (kick soft/hard, clap soft/hard)
- 8 round-robin variants (3 hat-closed, 3 perc, 2 hat-open)
- 19 original procedural samples (kick, bass, lead, hats, claps, perc, texture, fx)

## License

MIT. Samples are CC0 (procedurally generated). The loader refuses samples without explicit provenance.
