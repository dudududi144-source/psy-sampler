# PSY Sampler Device

> A canonical realization device in the PSY family. 53 features. 539 tests. 19 shortcuts. PWA. MIDI round-trip.

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
                  SampleVoice + VoicePool (O(1))
                        │
                    AudioGraph
              (3 buses + EQ + saturation + filter + limiter)
                        │
                  PSY4 Engine Bus
```

## What This Is

The PSY Sampler is a **realization device** — it receives `NoteEvent`s from a host and renders them as audio using sample playback. It does NOT compose, schedule, or own transport. It is a pure HOW layer.

**53 features · 539 tests · 19 keyboard shortcuts · PWA installable · MIDI round-trip (pitch-aware) · 31 samples**

## Features (53)

### Pattern Editor (8)
1. Per-step velocity (0-127 MIDI standard)
2. Pattern length (8/16/32 steps, selectable)
3. Drag-paint (mousedown + drag, Shift=accent, Alt=erase)
4. Per-step probability (100→75→50→25→100%, seeded RNG)
5. Copy/paste between roles (⧉ + ⤓)
6. Undo/redo (50 steps, Ctrl+Z/Ctrl+Shift+Z)
7. Randomize (seeded deterministic, X key)
8. Clear pattern (C key)

### Transport (6)
9. Play/stop (Space)
10. BPM slider (100-180) + tap tempo (T key)
11. Swing (0-70%)
12. Master volume
13. Section dropdown (INTRO/BUILD/DROP/BREAK/RISER)
14. Energy slider

### Audio Engine (10)
15. 3-bus mixer (drum/music/atmos) with gain + mute + solo
16. Per-bus 3-band EQ (lowShelf/peaking/highShelf)
17. Per-bus saturation (tanh waveshaper, 2× oversample)
18. Master filter (LP auto-wah / HP / off)
19. Sidechain ducking (kick → music+atmos)
20. Brickwall limiter (threshold=-1dB, 20:1)
21. Choke groups (hat-closed → hat-open)
22. Velocity layers + round-robin (deterministic)
23. Oversampled playback (2× + cascaded anti-alias)
24. Deterministic reverb (seeded mulberry32 IR)

### Song + Automation (4)
25. Song mode (A→B→A→C arrangement)
26. Timeline view with moving playhead
27. Automation editor (6 tracks, breakpoint interpolation)
28. Auto-evolve (deterministic mutation every 4 bars)

### I/O (8)
29. Offline WAV export (deterministic, 28× faster than real-time)
30. Stem export (drum/music/atmos as separate WAVs)
31. Live recording (MediaRecorder)
32. Project save/load (.psy.json)
33. MIDI export (.mid Standard MIDI File)
34. MIDI import (.mid round-trip with any DAW)
35. Sample import (drag-drop WAV, provenance-enforced)
36. Multi-output (bus direct MediaStreams)

### Performance (5)
37. Performance pads (3×3 grid, live one-shot triggering, keys 1-9)
38. Chord progression generator (9 scales, diatonic triads, key + D shortcut)
39. Per-step NoteMap (pitch override — piano-roll lite, chord-tone arpeggio)
40. Pitch-aware MIDI round-trip (export/import preserves melody)
41. Project persistence with NoteMap (save/load .psy.json preserves pitches)
42. Key + scale selector (12 keys, 9 scales — any harmonic territory)
43. Arpeggio pattern variations (up/down/upDown/downUp/random/chordal)
44. Bass pattern variations (root/walking/octave/pedal/arp)
45. Harmonic status bar (persistent key/scale/arp/bass/progression display)
46. A/B keyboard shortcuts (cycle arpeggio + bass patterns)
47. Lead density control (sparse 0.2 → dense 1.0, slider)
48. Melody octave control (shift lead register -2 to +2 octaves)

### UX (5)
49. Metronome (1kHz click, downbeat 1.5kHz, N shortcut)
50. Panic button (instant all-voice kill)
51. Per-role fill (FILL button per role, seeded)
52. Double/half pattern (×2/÷2, extend or shrink)
53. Help overlay (? key, all shortcuts + features) + Visualizer (3 modes)

## Keyboard Shortcuts (19)

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
| 1-9 | Trigger performance pads (Shift=accent, Alt=ghost) |
| D | Generate chord-aware bass/lead |
| A | Cycle arpeggio pattern |
| B | Cycle bass pattern |
| X | Randomize pattern |
| N | Toggle metronome |

## Performance

- **O(1) voice allocation** — free-list (was O(n))
- **O(1) scheduler dequeue** — head pointer (was O(n) shift)
- **Stale events played immediately** — no silence gaps (jitter, not drop)

## PWA

- Installable on desktop + mobile
- Offline-first (service worker caches app shell + samples)
- Standalone display, theme color

## Architecture

| Layer | Owner | What |
|---|---|---|
| **WHAT** | PSY4 CausalComposer | Decides what notes, when |
| **Contract** | PsyDevice interface | onTransport, onContext, onEvent |
| **HOW** | SamplerDevice | Sample selection, voice allocation, audio |
| **Audio** | AudioGraph | 3 buses + EQ + saturation + filter + limiter |

## Determinism Contract

Same inputs → byte-identical audio:
- Seeded selection (mulberry32, stateless)
- Seeded reverb IR (fixed per-channel seeds)
- Seeded round-robin (event-order-dependent)
- Seeded probability (same seed + same bar + same step → same skip)
- Seeded randomize (same seed → same pattern)
- Seeded chord progression (same seed + same context → same progression + patterns)
- Offline render produces byte-identical WAVs

## Testing

- **539 tests** across 34 files
- **167,165 expects**
- MIDI round-trip proof (export → import → same pattern)
- Real audio rendering + spectral analysis
- Voice stealing + choke group proofs
- Velocity layer + round-robin proofs
- Performance benchmarks

## Sample Library

31 procedural samples (all CC0 / no copyright):
- 4 velocity-layer pairs (kick soft/hard, clap soft/hard)
- 8 round-robin variants (3 hat-closed, 3 perc, 2 hat-open)
- 19 original procedural samples

## License

MIT. Samples are CC0. The loader refuses samples without explicit provenance.
