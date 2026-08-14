# PSY Sampler — Competitive Analysis

**Document ID:** COMPETITE-1
**Author:** general-purpose (competitive research agent)
**Date:** 2025
**Scope:** PSY Sampler vs. 6 competitor sampler products across 10 dimensions.

---

## 1. Executive Summary

PSY Sampler is a Web Audio sampler built around three architectural commitments that **no competitor matches in combination**: (1) it is a pure "HOW" realization device — it implements the canonical `PsyDevice` contract (`onTransport` / `onContext` / `onEvent` / `onStart` / `onStop`) and produces zero composition of its own, leaving the WHAT and WHEN entirely to the host; (2) sample selection is **genuinely seeded-deterministic** via a stateless hash of `(seed, role, phraseIndex)` → variant, so identical inputs always produce identical audio across runs; and (3) every sample is **provenance-enforced at load time** — the manifest refuses samples missing required license metadata, with non-commercial / unverified samples rejected before they enter the audio graph. Against this, the Web Audio competitors (Tone.js, SMPLR, soundfont-player) are all richer in breadth of instruments and bundled FX but are imperative, non-deterministic, and license-agnostic; the desktop gold standards (Kontakt, Ableton Drum Rack) are vastly more capable audio engines but are closed-source, GUI-bound, and embedded in a host DAW; Tracktion Engine is the closest in spirit (open-source, headless) but is C++/JUCE-only, GPL-licensed, and its `SamplerPlugin` is a basic 32-voice note dropper with no stealing, no choke groups, and no provenance tracking. **PSY Sampler's defensible niche is the intersection of these three commitments; outside that intersection it is genuinely behind on FX breadth, instrument library, pitch-shifting quality, and offline rendering.**

---

## 2. Per-Competitor Deep-Dive

### 2.1 Tone.js (`Tone.Sampler`, `Tone.Players`, `Tone.Player`, `Tone.PolySynth`)

**Sources:** https://tonejs.github.io/docs/15.1.22/classes/Sampler.html, https://github.com/Tonejs/Tone.js (README + `Tone/instrument/PolySynth.ts` source fetched at `dev` branch), https://bundlephobia.com/api/size?package=tone.

- **Voice management:** `Tone.PolySynth` wraps a monophonic voice constructor (e.g. `Synth`, `FMSynth`) and exposes `maxPolyphony: 32` by default. The internal `_getNextAvailableVoice()` source — read in full — does **NOT steal voices**: it returns `undefined` and calls `warn("Max polyphony exceeded. Note dropped.")` when the polyphony limit is hit. `Tone.Sampler` is natively polyphonic (built on top of PolySynth semantics) with the same drop-on-overflow behaviour. There is no concept of choke groups.
- **Pitch shifting:** Native Web Audio `AudioBufferSourceNode.playbackRate` (linear interpolation, no oversampling). `Tone.Sampler` auto-repitches between pitched samples — pass `urls: { C4, F#4, A4 }` and intermediate notes are calculated by ratio. `Tone.PitchShift` exists as a separate effect node (delay-line based, near-real-time) but is not part of the sampler engine itself. No anti-aliasing.
- **Routing:** Flexible node graph — `node.connect(node)` is the API. Per-instrument `output` chain (`volume` in dB). Tons of FX classes (Reverb, Freeverb, FeedbackDelay, Chorus, Distortion, Compressor, PitchShift, etc.) — but the user wires these manually; there is no per-instrument bus matrix.
- **Determinism:** None. `Tone.getTransport()` is the global timeline (start/stop/bpm/loop). Selection is caller-driven (you pass the note). No seeded randomisation API. No reproducible-render guarantee.
- **Bundle size:** 333 KB raw / 78 KB gzip (v15.1.22, 2 deps: `standardized-audio-context`, `tslib`). One of the heavier Web Audio libraries.
- **API style:** Imperative `triggerAttack(note, time, velocity)` / `triggerRelease(note, time)`. The Transport owns musical time; the user calls `triggerAttack` from inside `Tone.Loop` callbacks. NOT event-driven — the device has no `onEvent(transport, context, event)` contract.
- **Sidechain ducking:** Not built in. `Tone.Compressor` accepts a sidechain input via `connect()`, so a user can wire kick → compressor on bass. No first-class ducking abstraction.
- **Sample format / provenance:** Just URL strings or pre-loaded `AudioBuffer`s. No manifest schema, no license metadata, no commercial-use flag.
- **License:** MIT.

### 2.2 SMPLR (`danigb/smplr`)

**Sources:** https://github.com/danigb/smplr README (fetched raw, 1140 lines), `src/smplr/instrument.ts` (258 lines), `src/smplr/smplr.ts` (493 lines), `src/smplr/voice-manager.ts` (81 lines), https://bundlephobia.com/api/size?package=smplr.

- **Voice management:** `VoiceManager` tracks active voices in a `Set` plus two indexes (`#byStopId`, `#byGroup`). There is **no polyphony limit** and **no voice stealing** — every `start()` creates a new `Voice` and registers it; the auto-remove fires when the underlying `AudioBufferSourceNode` emits `onended`. **However, SMPLR has exclusive groups** (SFZ-style `offBy` field): when a new voice starts in a group, `voiceManager.stopGroup(match.offBy, time)` is called, cutting all other voices in that group. This is choke-group behaviour — a feature PSY Sampler lacks.
- **Pitch shifting:** Native `playbackRate`. `setDetune(cents)` mutates the instrument-wide detune for future notes. `setReverse(true)` plays samples reversed. No anti-aliasing. No granular mode.
- **Routing:** Per-instrument `OutputChannel` with `addEffect(name, effect, mix)` — a post-fader send-bus model (one send per named effect). DattorroReverbNode is bundled as a packaged algorithmic reverb (`AudioWorkletNode`). The destination is configurable. No multi-bus matrix; one output per instrument.
- **Determinism:** None. The `Sequencer` accepts `randomize: { timingMs: 10, velocity: 8 }` — **random**, not seeded. `renderOffline()` uses `OfflineAudioContext` for fast WAV export, but the rendered output is not bit-reproducible across runs because (a) the scheduler randomisation is `Math.random`-based, (b) the `Reverb` worklet may use stochastic IRs, (c) the AudioContext clock drifts. Reproducible offline render is supported structurally but not guaranteed deterministically.
- **Bundle size:** 65 KB raw / 22 KB gzip (v1.0.0, 0 dependencies). Smallest of the Web Audio competitors. Samples are loaded lazily from `smpldsnds.github.io` (or a custom `storage`).
- **API style:** Factory function `Instrument(ctx, opts)` returns a `Smplr` instance. `piano.start({ note, time, velocity, duration })` returns a `stopFn`. Imperative — there is no `onEvent` contract. `Sequencer` provides a host-level arrangement API (`addTrack`, `loop`).
- **Sidechain ducking:** Not built in. You would wire this manually via the `OutputChannel` and a Compressor node.
- **Sample format:** SFZ-style JSON preset (`SmplrPreset` with `groups[]`, each with `regions[]`). Plus 11 bundled instruments: `Sampler`, `Soundfont`, `SplendidGrandPiano` (4 velocity layers, sampled Steinway), `ElectricPiano`, `DrumMachine` (TR-808 etc.), `DrumAbuse` (~210 machines), `Mallet`, `Mellotron`, `Smolken`, `Versilian`, `Soundfont2` (reads .sf2 files directly). Sample storage backend is pluggable (`HttpStorage` default, `CacheStorage` for `Cache API` caching).
- **Provenance tracking:** None. Samples are referenced by URL only.
- **License:** MIT.

### 2.3 soundfont-player (`danigb/soundfont-player`)

**Sources:** https://github.com/danigb/soundfont-player README (262 lines), https://bundlephobia.com/api/size?package=soundfont-player.

- **Voice management:** Per the README: "Unlimited poliphony (and stop all sounds with a single function call)". No stealing, no limit, no choke groups. Voices are created per `play()` call and tracked by `sample-player` underneath.
- **Pitch shifting:** Native `playbackRate`. Accepts decimal MIDI note numbers (`60.5` = +50 cents) for detune — simple and effective for small pitch shifts.
- **Routing:** Single `destination` AudioNode via `connect()`. No bus matrix.
- **Determinism:** None.
- **Bundle size:** 15 KB raw / 5.7 KB gzip (5 transitive deps via `audio-loader`, `sample-player`, `note-parser`, `adsr`, `midimessage`). Tiny.
- **API style:** `Soundfont.instrument(ac, 'marimba').then(piano => piano.play('C4'))`. Imperative. Returns a player with `play(note, time, duration, options)`, `stop(when, nodes)`, `schedule(when, events)`, `listenToMidi(input)`.
- **Sidechain ducking:** None.
- **Sample format:** Pre-rendered MIDI.js soundfonts (mp3/ogg) hosted at `gleitz.github.io/midi-js-soundfonts`. Two presets: `MusyngKite` (higher quality, larger) and `FluidR3_GM`. Can also load custom `.js` soundfont files.
- **Provenance tracking:** None.
- **Status:** **ARCHIVED.** The README explicitly says: *"⚠️ Archived. There are better alternatives. This is one of it: https://github.com/danigb/smplr Thanks for the fish! ⚠️"*
- **License:** MIT.

### 2.4 Native Instruments Kontakt 7 / 8 (industry-standard desktop sampler)

**Sources:** https://www.native-instruments.com/ni-tech-manuals/kontakt-manual/en/modulation.html, https://www.native-instruments.com/ni-tech-manuals/ksp-manual/en/engine-parameters, https://www.sweetwater.com/insync/voice-stealing-mode-kontakt-3, https://ask.video/article/audio-software/kontakt-5-the-new-bus-architecture, KONTAKT_7_Manual_en.pdf reference.

- **Voice architecture:** Each Instrument has multiple **Groups**, each Group has its own Source module + Amplifier + Group Insert FX chain + Modulation Router. Voices are allocated per-Group; instrument-level polyphony is configurable. Global engine polyphony can exceed 256 voices.
- **Voice stealing:** Configurable per-instrument. Stealing modes: **Oldest, Newest, Lowest, Highest, Same Key** (cuts the previous voice on the same MIDI note). Voice reduction settings: `loose`, `strict`, `off`. **Voice groups** (`$ENGINE_PAR_VOICE_GROUP`) provide choke-style muting per Group.
- **Pitch shifting:** Best-in-class — multiple engine modes selected per Group:
  - `$NI_SOURCE_MODE_SAMPLER` with HQI modes Standard / High / Perfect (anti-aliased interpolation)
  - `$NI_SOURCE_MODE_DFD` (Direct From Disk streaming — samples not loaded into RAM)
  - `$NI_SOURCE_MODE_TONE_MACHINE` (PSOLA-style formant-preserving)
  - `$NI_SOURCE_MODE_TIME_MACHINE_1/2/PRO` (granular, time-stretch independent of pitch)
  - `$NI_SOURCE_MODE_BEAT_MACHINE` (slice mode with transient detection)
  - `$NI_SOURCE_MODE_MP60_MACHINE` / `$NI_SOURCE_MODE_S1200_MACHINE` (vintage sampler emulation — Emu MP-60 / Akai S1200 character)
  - `$NI_SOURCE_MODE_WAVETABLE` (scans through a multi-sample set as a wavetable position)
- **Routing:** Per-Group Source → Group Insert FX → Amplifier → Group Sends → Instrument Insert FX → Send Effects → Main Effects → Output. Up to **16 internal buses** per instrument (`$NI_BUS_OFFSET + 0..15`), up to **64 output channels**. Bus-to-bus routing is not allowed (buses route to outputs only). Send levels are post-fader.
- **Modulation:** Modulation Router on most modules. Sources: 5 envelope types, 5 LFO waveforms + Complex LFO, External Sources (MIDI CC, random, constant), Step Sequencer, Envelope Follower. Per-voice random is supported (different value per voice).
- **Scripting (KSP):** Kontakt Script Processor — a Turing-complete imperative language with callbacks: `on note`, `on release`, `on controller`, `on init`, `on ui_control`, `on_persistent_changed`. Can rewrite MIDI (multiscript), manipulate UI, persist state, build custom samplers. This is Kontakt's killer feature — entire commercial instruments (Spitfire, Heavyocity, Orchestral Tools) are built in KSP.
- **Determinism:** None for selection unless scripted. Modulation sources include random (per-voice random, step sequencer). No first-class seeded-reproducible render.
- **Sidechain ducking:** Built-in via Compressor / Solid Bus Comp / Solid Dynamics sidechain input. Common pattern: kick → Compressor on bass bus. `Feedback Compressor` (`$NI_COMP_TYPE_*`) also has sidechain.
- **Effects library:** Massive — Solid G-EQ, Solid Bus Comp, Ladder filters, Monark filters, Daft filter, Formant filters, Compressor, Feedback Compressor, Saturation, Transient Master, Reverb, Convolution, Delay, Chorus, Flanger, Phasers, Distortion, Tape Saturator, Skreamer, Cabinet, Lo-Fi, AET Filter, plus dozens of Send/Main FX.
- **Sample format:** Proprietary NKI (instrument), NKM (multi), NKR (resource container), NKT (Kontakt sample format). Native format only; no .sf2 / .sfz import without conversion.
- **Provenance tracking:** None enforced by the engine. Library vendors self-police licensing.
- **License:** Proprietary. **Kontakt 7 Full: $399** (allows building libraries). **Kontakt Player: free** (can only load Player-licensed libraries — vendors pay NI a fee to publish). Closed-source.
- **Bundle footprint:** Gigabytes (full library typically 50–200 GB for a commercial orchestral library). VST3 / AU / AAX plugin format. Desktop only (macOS / Windows). No Linux. No web.

### 2.5 Ableton Drum Rack / Sampler / Simpler (DAW-native samplers)

**Sources:** https://www.ableton.com/en/manual/instrument-drum-and-effect-racks (Rack manual — choke groups, return chains, key/velocity/chain-select zones), https://www.ableton.com/en/manual/live-instrument-reference, https://blog.faderpro.com/instruments/ableton-simpler-modes, https://www.audeobox.com/learn/ableton/simpler-sampler-complete-guide.

- **Voice management:** Drum Rack chains inherit Simpler/Sampler polyphony per pad. **16 choke groups** per Drum Rack — any chains in the same choke group silence the others when triggered (the canonical use is open hi-hat choked by closed hi-hat). Sampler/Simpler have per-instance polyphony with implicit voice stealing (oldest-voice-on-same-note for monophonic operation).
- **Pitch shifting:** Simpler has `Transpose` (semitones) + `Detune` (cents) on the sample itself. Sampler supports full multi-sample keyzones with per-zone root note. Underlying engine uses Ableton's proprietary **warp modes** (Beats, Tones, Texture, Re-Pitch, Complex, Complex Pro) — for clip-level time/pitch stretching. For one-shot sample playback in Simpler Classic mode, it's straightforward playbackRate-based transposition; in Slice mode, transient detection slices the sample and each slice is mapped to a pad.
- **Routing (Drum Rack):** Parallel chains (one per pad), each containing a chain of instruments + audio effects. **Up to 6 return chains** of audio effects per Drum Rack, with **per-chain send sliders** (post-fader). Return chains can route to Rack main output OR directly to the Set's return tracks. Each pad has its own mixer section (gain, pan, sends, Audio To chooser).
- **Routing (Sampler/Simpler):** Single output, plus internal modulation routing (LFO → pitch/filter/amp, envelopes → same). Sampler has a full **modulation matrix**: 3 LFOs, 5 multimode envelopes, MIDI inputs as modulation sources, aux envelope. Modulation can target post-processing parameters.
- **Modes (Simpler):** Classic (ADSR-style), One-Shot (Fade In / Fade Out, no sustain loop), Slice (transient-detect and chop into pads).
- **Determinism:** None.
- **Sidechain ducking:** Built-in to the DAW. Live's **Compressor** and **Glue Compressor** both have sidechain inputs. The classic "psytrance pump" is wired by routing the kick to a Compressor's sidechain input on the bass bus. This is a DAW feature, not a Sampler feature.
- **Sample format:** ALS (Live Sets), ADV (device presets), ADG (Drum Rack presets). Samples can be WAV/AIFF/FLAC/OGG/MP3.
- **Provenance tracking:** None enforced.
- **License:** Proprietary. **Live Suite $749 / Standard $449 / Intro $99**. Sampler is Suite-only. Closed-source. Desktop only (macOS / Windows). Push hardware integration.
- **Bundle footprint:** Several GB for the DAW alone, 70+ GB with the Suite library.
- **API style:** GUI-only. No scripting. (Live 12 introduced "Note Tools" generative MIDI processing, but that's at the clip level, not the device level.)

### 2.6 Tracktion Engine (open-source DAW engine)

**Sources:** https://github.com/Tracktion/tracktion_engine (README + FEATURES.md), `modules/tracktion_engine/plugins/effects/tracktion_SamplerPlugin.h` (121 lines), `modules/tracktion_engine/plugins/effects/tracktion_SamplerPlugin.cpp` (726 lines, full source read).

- **Voice management:** `SamplerPlugin` has `static constexpr int maximumSimultaneousNotes = 32;` hardcoded. From `playNotes()` and `applyToBuffer()` source: when the limit is hit, new notes are **silently rejected** (`playingNotes.size() < maximumSimultaneousNotes` — no stealing, no warning, just drop). Notes are `ReferenceCountedObject` instances, removed when `isFinished`. No choke groups. No voice groups. The simplest possible voice manager.
- **Voice stop:** `static constexpr int minimumSamplesToPlayWhenStopping = 8;` — when a note-off is received, `samplesLeftToPlay` is set to `max(minimumSamplesToPlayWhenStopping, noteTimeSample)` — a fast fade-out (100 samples max in the `startFade` path) using `AudioFadeCurve::applyCrossfadeSection`. This is the same problem PSY Sampler's 5ms exponential fade-out on steal solves, but for note-offs rather than steals.
- **Pitch shifting:** `juce::LagrangeInterpolator resampler[2];` — JUCE's polynomial (4-tap Lagrange) resampler. `playbackRatio = hz_target / hz_keynote * (file_sample_rate / sample_rate)`. **Better than native Web Audio linear interpolation** (Lagrange is a 3rd-order polynomial; Web Audio's default is linear), but not as good as Kontakt's HQI Perfect (sinc interpolation) or Ableton's Complex Pro. For audio clip time-stretching (not the sampler plugin), Tracktion uses **Elastique** (commercial license required), **Rubber Band** (GPL), or **SoundTouch** (LGPL).
- **Routing:** Track-based — tracks → aux sends → return tracks. Insert plugins per-track. **Rack patching environment for multi-track plugin buses**. The sampler plugin itself is a single stereo-in / stereo-out insert.
- **Determinism:** None. Automation modifiers include random (Random LFO, breakpoint random, random step) — none are seeded for reproducibility.
- **Bundle footprint:** C++/JUCE module, compiles to a native binary. Multi-platform (macOS / Windows / Linux / iOS / Android / Raspberry Pi). **NOT browser-compatible.**
- **API style:** C++ class hierarchy. `SamplerPlugin` extends `Plugin`, takes MIDI in via `applyToBuffer(PluginRenderContext)`, processes audio blocks in-place. Imperative / pull-model. No `onEvent` contract.
- **Sidechain ducking:** Not built in to the SamplerPlugin. The Compressor plugin has a sidechain input.
- **Sample format:** WAV, AIFF, FLAC, OGG, MP3, CAF, REX file formats. `SamplerSound` struct has `keyNote`, `minNote`, `maxNote`, `gainDb`, `pan`, `openEnded` flag, `setExcerpt(startTime, length)` for sample subset. Multi-sampled (key zones only — no velocity zones, no round-robin).
- **Provenance tracking:** None.
- **License:** **GPL v3 / Commercial dual license.** GPL is viral — any product using Tracktion Engine must also be GPL, OR you must purchase a commercial license from Tracktion Corporation. The README is explicit: *"Tracktion Engine is not included in a JUCE licence and you must get the above mentioned Tracktion Engine licence to distribute products."* This is a significant commercial restriction.

---

## 3. Feature Comparison Matrix

| Feature | Tone.js | SMPLR | soundfont-player | Kontakt 7 | Ableton Drum Rack | Tracktion Engine | **PSY Sampler** |
|---|---|---|---|---|---|---|---|
| **Pure "HOW" realization device** (no transport ownership, no composition) | ✗ (owns Transport) | ✗ (owns Sequencer) | ✗ (has schedule()) | ✗ (full instrument) | ✓ (DAW-owned) | ✗ (owns DAW document) | **✓ (canonical PsyDevice contract)** |
| **Event-driven API** (`onEvent` contract) | ✗ (imperative `trigger`) | ✗ (imperative `start`) | ✗ (imperative `play`) | ✗ (KSP callbacks per-instrument) | ✗ (MIDI only) | ✗ (MIDI buffer pull-model) | **✓ (`onEvent(MusicalEvent)`)** |
| **Polyphony limit** | 32 (configurable) | Unlimited | Unlimited | 256+ (configurable) | Per-instance | 32 (hardcoded) | **32 (configurable)** |
| **Voice stealing** | ✗ drops note + warns | ✗ (unbounded) | ✗ (unbounded) | ✓ Oldest/Newest/Lowest/Highest/Same-Key + reduction modes | ✓ (implicit) | ✗ drops silently | ✓ round-robin steal oldest (panic + fade) |
| **Choke groups** | ✗ | ✓ (SFZ `offBy` / exclusive groups) | ✗ | ✓ (voice groups) | ✓ (16 per Drum Rack) | ✗ | ✗ (planned — STRATEGY-1 #1 candidate) |
| **Pitch shifting method** | Native `playbackRate` (linear) | Native `playbackRate` | Native `playbackRate` (decimal MIDI) | Multi-mode: HQI Sampler / DFD / Tone Machine / Time Machine / Beat Machine / MP60 / S1200 / Wavetable | Simpler Transpose + Warp modes (Beats/Tones/Texture/Re-Pitch/Complex/Complex Pro) | Lagrange interpolation (4-tap) | Native `playbackRate` (linear, no anti-aliasing) |
| **Anti-aliasing on pitch shift** | ✗ | ✗ | ✗ | ✓ (HQI High/Perfect) | ✓ (Complex/Complex Pro) | partial (Lagrange is better than linear) | ✗ (GAP-1 audio quality gap #5) |
| **Routing (buses)** | Manual `connect()` | 1 output + post-fader send FX bus | 1 output | 16 buses + 64 outputs + Group/Insert/Send/Main FX chains | Drum Rack: 6 return chains + per-pad sends; Sampler: modulation matrix | Track-based aux/return + rack patching | **3 buses (drum/music/atmos) + delay + reverb sends** |
| **Sidechain ducking** | ✗ (manual via Compressor) | ✗ | ✗ | ✓ (Compressor sidechain built-in) | ✓ (Compressor + Glue Comp sidechain, classic psy pump) | ✗ (manual via Compressor plugin) | ✓ (kick → duckGain on music+atmos, attack 8ms / release 150ms / depth 0.6 — built into AudioGraph) |
| **FX chain per voice / bus** | Manual | 1 send bus per instrument | None | Massive (per-Group Insert + Instrument Insert + Send + Main) | Per-chain in Rack, per-track in Set | Per-track inserts | Per-bus delay + reverb sends, master glue compressor |
| **Determinism (seeded selection)** | ✗ | ✗ | ✗ | ✗ (unless scripted) | ✗ | ✗ | **✓ (stateless hash of seed+role+phraseIndex → mulberry32 Rng)** |
| **Reproducible render** | ✗ | structural ✓ (`renderOffline`) but not bit-identical | ✗ | ✗ | ✗ | ✗ | partial (deterministic selection; reverb IR uses Math.random — GAP-1 audio #7) |
| **Sample provenance enforcement at load** | ✗ | ✗ | ✗ | ✗ (vendor self-police) | ✗ | ✗ | **✓ (manifest validation refuses missing license / non-commercial / UNKNOWN/QUARANTINED)** |
| **License policy enforcement** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ (commercialUse flag + verification status gate loading)** |
| **Sample format** | URLs / `AudioBuffer`s | SFZ-style JSON preset + 11 bundled instruments | Pre-rendered MIDI.js soundfonts | NKI/NKM/NKR (proprietary) | ADV/ADG/ALS + WAV/AIFF/FLAC | WAV/AIFF/FLAC/OGG/MP3/CAF/REX | Manifest.json with schema-validated entries (id, file, category, subcategory, source, author, license, licenseUrl, commercialUse, attribution, dateAcquired, usageRestrictions, character, genreFit, bpmRange, rootNote, verification) |
| **Bundle size (raw / gzip)** | 333 KB / 78 KB | 65 KB / 22 KB | 15 KB / 5.7 KB | Multi-GB | Multi-GB | C++ native binary | **~91 KB raw TS source (sampler + shim), est. ~25-30 KB gzip** |
| **External dependencies** | 2 (standardized-audio-context, tslib) | 0 | 5 transitive | 0 (self-contained) | 0 (self-contained) | JUCE + libsamplerate + rpmalloc + choc + ... | 0 (zero `npm install` for the sampler package itself; the Next.js app pulls React/shadcn) |
| **API style** | Imperative `triggerAttack`/`triggerRelease` | Imperative `start`/`stop` | Imperative `play`/`schedule` | KSP scripting + GUI | GUI + MIDI | C++ class hierarchy + MIDI buffers | **Event-driven `onEvent(MusicalEvent)` + lifecycle hooks** |
| **Offline render** | ✗ (no first-class API; Transport supports offline context) | ✓ `renderOffline(async (ctx) => {...})` → WAV | ✗ | Bounce-to-disk in host DAW | Bounce-to-disk in host DAW | ✓ background thread rendering of Edits | ✗ (wav-export.ts uses real-time `MediaRecorder` 8s capture — STRATEGY-1, GAP-1 #7) |
| **Bundled instruments** | Synths (Synth, FMSynth, AMSynth, MonoSynth, NoiseSynth, MembraneSynth, MetalSynth, PolySynth) + Sampler + Players | 11 (SplendidGrandPiano, ElectricPiano, DrumMachine, DrumAbuse, Mallet, Mellotron, Smolken, Versilian, Soundfont, Soundfont2, Sampler) | ~128 GM soundfonts | Unlimited (third-party libraries; Kontakt Factory Library 53 GB) | Unlimited (Live Suite library) | 1 (basic SamplerPlugin) + 4OSC synth | **0 (manifest-driven; user supplies samples)** |
| **License** | MIT | MIT | MIT (archived) | Proprietary ($399 Full / free Player) | Proprietary ($99-$749) | GPL v3 / Commercial dual | TBD (currently no LICENSE file in repo; should be MIT or Apache-2.0 to be defensible) |
| **Platform** | Web (browser) | Web (browser) | Web (browser) | Desktop (macOS, Windows) | Desktop (macOS, Windows) | Native (macOS, Windows, Linux, iOS, Android, RPi) | Web (browser) |
| **Open source** | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ (GPL) | ✓ (currently in private repo; should be open) |

Legend: ✓ = supported · ✗ = not supported · "partial" / "structural" = some support but with caveats.

---

## 4. Where PSY Sampler Wins (Honest)

### 4.1 Pure "HOW" event-driven contract — **unique among Web Audio samplers**

This is the only Web Audio sampler that exposes a canonical device contract (`onTransport` / `onContext` / `onEvent` / `onStart` / `onStop` / `capabilities` / `reportLatencyMs`) and produces **zero composition** of its own. Tone.js owns the Transport. SMPLR owns its Sequencer. soundfont-player has `schedule()`. Tracktion Engine owns the entire DAW document model. Kontakt and Ableton Drum Rack are GUI-driven instruments embedded in a host DAW.

**PSY Sampler is the only one where the host (the composer) and the device (the realiser) are formally separated by a contract.** This means:
- A host can swap in any compliant device (a synth device, a sampler device, a MIDI-out device) without changing the composition code.
- The same composition can be rendered by different devices for A/B comparison.
- The device can be unit-tested in isolation by feeding it canned `MusicalEvent` streams.
- The host owns musical time; the device owns only AudioContext time. This separation is *unusual* in the Web Audio world and is genuinely aligned with how modular desktop audio works (e.g., VST3 plugins receive `processBlock` calls — they don't own the transport).

### 4.2 Seeded-deterministic sample selection — **nobody else does this**

PSY Sampler's `SelectionPolicy.deriveVariant(seed, role, phraseIndex)` is genuinely stateless: `hashSeed3` (FNV-style XOR with `0x9e3779b9` golden ratio + `0x01000193` FNV prime) → single `Rng.int(0, variants-1)` call. No mutable counters, no `Math.random()`. Same `(seed, role, phraseIndex)` always yields the same variant, the same pitch/gain/pan variance, and the same `sampleId`.

No competitor does this:
- Tone.js: caller picks the note. No selection at all.
- SMPLR: `randomize: { timingMs, velocity }` is `Math.random`-based. Even `renderOffline` is not bit-reproducible.
- Kontakt: per-voice random is a modulation source, but it's not a selection policy. KSP scripts *can* implement determinism, but it's the script author's job — not an engine feature.
- Ableton Drum Rack: no selection concept (one sample per pad).
- Tracktion Engine: random modifiers, not seeded.

**This matters for:** (a) bug reproduction (same seed → same audio, so audio regressions are detectable), (b) collaborative composition (two users with the same seed + library get the same render), (c) competitive / scored music (deterministic renders are auditable), (d) shrinking the test surface (no flaky audio tests from RNG drift).

### 4.3 Provenance-enforced loading — **unique and commercially defensible**

The manifest validator (`manifest.ts`) refuses to load samples that:
1. Are missing any required provenance field (`source`, `author`, `license`, `commercialUse`, `dateAcquired`, `usageRestrictions`).
2. Have `commercialUse: false` (logged + skipped).
3. Have `verification` ∈ `{UNKNOWN, QUARANTINED}` (logged + skipped).

No competitor enforces this. Tone.js takes URLs. SMPLR takes URLs or SFZ JSON. Kontakt takes NKI files. Ableton takes anything you drag in. Tracktion takes WAVs. **PSY Sampler is the only one where you cannot accidentally ship a sample you don't have the rights to.** This is a feature for anyone building a commercial product on top of the sampler — the legal risk of "an engineer dropped a downloaded sample into the manifest and we shipped it" is structurally eliminated.

### 4.4 Built-in sidechain ducking as a first-class bus operation

PSY Sampler's `AudioGraph.triggerSidechain(at)` is wired into `SamplerDevice.handleNoteEvent` — when a kick fires, music and atmos buses get an 8ms attack / 150ms release gain dip on their `duckGain` node. The drum bus is excluded (the kick needs to cut through).

Tone.js, SMPLR, and Tracktion Engine do NOT have this — you must wire it yourself via a Compressor with sidechain input. Kontakt and Ableton have sidechain as a Compressor feature (not as a bus operation). PSY Sampler is the only Web Audio sampler where the ducking is a structural part of the bus graph, not an effect the user has to wire.

### 4.5 Zero-dependency Web Audio footprint

PSY Sampler's `psy-sampler` package + `psy-foundation-shim` is ~91 KB of raw TypeScript with zero `npm` dependencies for the sampler itself. Minified+gzipped it should land around 25-30 KB — comparable to SMPLR (22 KB) and significantly smaller than Tone.js (78 KB). For a Web Audio sampler that includes voice pooling, deterministic selection, 3-bus routing, delay+reverb sends, sidechain ducking, and provenance validation, this is competitive.

---

## 5. Where PSY Sampler Loses (Brutal)

### 5.1 No choke groups — a *drum* sampler without choke groups is a real gap

SMPLR has them (`offBy` / exclusive groups). Kontakt has them (voice groups). Ableton Drum Rack has them (16 per Rack). Tone.js doesn't (but Tone.js isn't pitched as a drum sampler). Tracktion Engine doesn't (and its SamplerPlugin is basic).

**PSY Sampler is a drum-capable sampler (9 roles including `hat-closed`, `hat-open`, `clap`, `perc`) that cannot choke an open hi-hat when a closed hi-hat fires.** This is a basic psytrance / techno / house production requirement. The current `voicePool.panic()` strategy on steal will cut *a voice on the same pool slot*, not *all voices tagged with a choke group*. The architecture supports adding choke groups cleanly (the `SampleRole` enum and `roleToBus` are already in place; you'd add a `chokeGroup: 'hats' | 'claps' | null` field to `SampleRole` and have `handleNoteEvent` call `voicePool.stopGroup(chokeGroup)` before triggering), but it doesn't exist today. This is the single highest-impact missing feature for the stated use case (psytrance production).

### 5.2 Pitch shifting has no anti-aliasing — high notes alias audibly

PSY Sampler uses native Web Audio `AudioBufferSourceNode.playbackRate` — the browser's default linear interpolation. When a bass sample pitched up an octave or a lead sample pitched up a fifth hits the Nyquist frequency, it aliases. Kontakt's HQI Perfect mode uses sinc interpolation. Ableton's Complex Pro uses a proprietary algorithm. Tracktion's LagrangeInterpolator is a 4-tap polynomial — better than linear. SMPLR, Tone.js, and soundfont-player have the same problem as PSY Sampler.

**For unpitched roles (kick, hat, clap, perc, texture, fx) this doesn't matter** — they play at native pitch. **For pitched roles (bass, lead) it does.** The PSY Sampler audit (GAP-1, audio quality gap #5) already flagged this: *"Bass/lead pitched up will alias."* The fix is to wrap pitched voices in a `BiquadFilterNode` lowpass whose cutoff scales with `playbackRate` (cutoff = `min(nyquist, sampleNyquist / playbackRate)`). It is a small change but it is not done.

### 5.3 No offline render — export is 8-second real-time `MediaRecorder` capture

SMPLR has `renderOffline(callback, opts) → RenderResult` using `OfflineAudioContext` — render a 10-minute track in seconds, get a WAV blob. Kontakt bounces to disk in the host. Ableton bounces in the host. Tracktion has background-thread rendering of Edits.

PSY Sampler's `wav-export.ts` (`renderAndDownloadWavLive`) uses **real-time `MediaRecorder` capture for 8 seconds** — you have to play the loop in real time, you can't export a full arrangement, and the duration is hardcoded. The audit (GAP-1, robustness gap #7) confirms this is the only export path. There is no `OfflineAudioContext`-based renderer.

**This is a serious limitation for any user who wants to actually produce music with the sampler.** Offline render is also the foundation for deterministic render-comparison testing (which would close the loop on the determinism claim in 4.2). Without it, "same seed → same audio" is asserted but not testable end-to-end.

### 5.4 FX breadth is minimal — one delay, one reverb, one master compressor

Tone.js ships ~20 FX classes. Kontakt has ~50+ insert effects. Ableton has ~50 audio effects. SMPLR has the Dattorro reverb (and you can plug in any Web Audio node).

PSY Sampler's `AudioGraph` has: 1 delay (with feedback), 1 convolver reverb (with a non-deterministic `Math.random()` IR — gap #7 from GAP-1), 1 master `DynamicsCompressorNode` configured as a glue compressor (threshold -8, ratio 6:1, attack 3ms — not a true limiter). There is no EQ, no saturation, no filter, no chorus, no phaser, no flanger, no distortion, no bitcrusher. **The bus sends (`* 4` magic multiplier) are also not exposed to the UI as user-controllable per-bus send knobs** (STRATEGY-1 finding).

For a sampler aimed at psytrance production (the stated niche), the absence of a lowpass filter on the drum bus alone is a significant gap — psytrance kicks and basses are routinely lowpassed for energy management.

### 5.5 No instrument library — 0 bundled instruments vs. SMPLR's 11

PSY Sampler ships with 19 WAV files in `/public/samples/` (3 kicks, 2 bass, 1 lead, 2 hat-closed, 3 hat-open, 3 claps, 4 perc, 1 texture, 1 fx). SMPLR ships 11 instrument factories backed by hosted sample sets (SplendidGrandPiano with 4 velocity layers, 8 drum machines, ~210 DrumAbuse machines, Mellotron archive, Versilian orchestral, etc.). Kontakt ships a 53 GB factory library. Ableton Live Suite ships 70+ GB.

**The "manifest-driven, user-supplied" model is architecturally clean but commercially weak.** A new user opening PSY Sampler gets 19 samples and no path to add more beyond editing `manifest.json`. There is no "browse and add a marimba" button, no integration with sample hosting services, no SFZ/SF2 import (which SMPLR has via `Soundfont2`). The user has to curate their own sample collection — which is the opposite of the "no setup required" promise that SMPLR markets on its README.

### 5.6 Voice steal produces clicks (mitigated but not eliminated) and can cascade

The PSY Sampler voice steal (`SampleVoice.trigger`) does a 5ms exponential fade-out on the per-source gain before `source.stop(now + 0.008)`. This is better than the original `source.stop()` with no fade (BUG-3 in AUDIT-1 was exactly this). But:
1. **5ms is fast** — audible on sustained textures. Kontakt uses configurable release times.
2. **Steal always happens on the next-in-round-robin slot, not the oldest-by-time.** A long texture could be cut to make room for a 50ms hi-hat. PSY Sampler has no "steal the voice with the shortest remaining tail" logic — Kontakt has 5 stealing modes including "Lowest" (steal the lowest-amplitude voice).
3. **BUG-3 in AUDIT-1** flagged a cascading steal bug: after a steal, `_active` flips to false prematurely because the *stolen source's* `onended` callback unconditionally sets `_active = false`. The current `if (this.currentSource === source)` guard mitigates this for the disconnect path but the audit said the flag is still vulnerable. Whether this is fully fixed in the current `voice.ts` is unclear — re-audit recommended.

### 5.7 No velocity layers / round-robin in the manifest schema

The manifest schema (`SampleManifestEntry`) has `character.character[]`, `character.genreFit[]`, `character.bpmRange`, `character.rootNote`, but **no `velocityRange`** and **no `roundRobinGroup`**. So:
- You cannot have "soft kick" + "hard kick" velocity layers selected by `event.velocity`.
- You cannot have 4 round-robin kick variants explicitly authored (only the deterministic-seeded variant selection, which rotates by phrase — not per-hit).

Kontakt, Ableton Sampler, SMPLR (via SFZ `lovel`/`hivel` and `seq_position`) all support velocity layers and explicit round-robin. PSY Sampler's deterministic selection is a *substitute* for round-robin, but it rotates by phrase (every 8 bars), not by hit — so within a single phrase, every kick hit uses the same sample. For psytrance, where 16th-note kicks need timbral variation to avoid machine-gunning, this is a real limitation.

### 5.8 Reverb IR is non-deterministic — breaks the determinism promise

`AudioGraph.makeImpulse()` uses `Math.random()` to generate the impulse response. **Every page load produces a different reverb.** This breaks the determinism claim from 4.2: same seed + same library + same events ≠ same audio across page loads, because the reverb tail differs.

The fix is a seeded IR generator (use the existing `Rng` class with a fixed seed). This was flagged in GAP-1 (audio quality gap #7) but is not yet fixed.

### 5.9 No MIDI input, no MIDI CC, no MPE

Tone.js doesn't natively do MIDI (you bring WebMIDI). soundfont-player has `listenToMidi(input)`. SMPLR has `setCC(cc, value)` / `getCC(cc)`. Kontakt has full MIDI CC + MPE. Ableton has full MIDI + MPE. Tracktion has full MIDI + MPE + MTC.

PSY Sampler has zero MIDI handling. The host publishes `MusicalEvent`s, but the host has to do the MIDI parsing. This is consistent with the "HOW" only contract, but it means PSY Sampler cannot be wired to a MIDI keyboard directly — you need a host (like the `DemoDirector` in `src/lib/`) to convert MIDI → MusicalEvent. For the demo app this is fine; for a real instrument product this is a limitation.

### 5.10 License is undefined

There is no `LICENSE` file in the PSY Sampler repo. The manifest has `licensePolicy: "NEVER assume..."` text but the project itself has no declared license. For an open-source-claiming project, this is a blocker — under default copyright law, no license means "all rights reserved" and nobody can legally use, fork, or redistribute the code. **This must be fixed before any external publication.** Recommend MIT (matches Tone.js / SMPLR / soundfont-player) or Apache-2.0 (patent grant).

---

## 6. Strategic Positioning — The Niche PSY Sampler Should Own

PSY Sampler cannot out-Kontakt Kontakt (no GUI, no KSP, no library, no proprietary pitch engines). It cannot out-SMPLR SMPLR (no 11 bundled instruments, no SFZ/SF2 support, no Dattorro reverb worklet). It cannot out-Tone.js Tone.js (no synth voices, no Transport, no 20 FX classes, no community reach). Trying to compete on breadth is a losing game — those projects have years of head start and orders of magnitude more contributors.

**The defensible niche is the intersection that no competitor occupies:**

> **PSY Sampler is the canonical reference implementation of a deterministic, provenance-safe, contract-driven Web Audio sampler device for host-driven music systems.**

Three words do the work here:

1. **Canonical.** It implements the `PsyDevice` contract verbatim (via the shim — eventually `@psy-foundation/protocol`). It is the reference for *how a sampler device talks to a PSY host*. Other devices (synth devices, MIDI-out devices, audio analyser devices) follow the same contract. The PSY Sampler is the proof-of-existence that the contract is implementable and produces music.

2. **Deterministic + provenance-safe.** Same seed → same audio (once the reverb IR is fixed). Same manifest → same legal exposure (none, because non-commercial samples are refused at load). These two guarantees are *jointly* unique to PSY Sampler. They are not features users will pay for individually — they are features that make PSY Sampler safe to embed in commercial products, safe to use in scored / competitive music contexts, and safe to test for audio regressions.

3. **Host-driven.** It owns nothing musically. The host owns the transport, the composition, the arrangement, the BPM. PSY Sampler only realizes `MusicalEvent`s at the AudioContext time the host chose. This makes it composable with any PSY-compatible host — including future generative hosts, AI composition hosts, networked collaborative hosts. Kontakt, Ableton Drum Rack, and Tone.js are all *instruments* — they want to be the whole instrument. PSY Sampler wants to be the *realization layer* underneath whatever instrument the host is building.

### 6.1 What this means for the roadmap

**Lean in (double down on the niche):**
- **Fix the reverb IR determinism** (5.8) — non-negotiable. The determinism promise is the moat.
- **Add `renderOffline()`** based on `OfflineAudioContext` (5.3) — turns the determinism claim into a testable invariant. Also unlocks audio-regression CI.
- **Add choke groups** (5.1) — required for the drum-sampler use case. Architecture already supports it cleanly.
- **Declare a license** (5.10) — MIT or Apache-2.0. Without this the project is legally unusable.
- **Add per-bus send knobs + a lowpass filter per bus** (5.4) — minimum viable FX for psytrance.
- **Add velocity layers + per-hit round-robin to the manifest schema** (5.7) — extends the deterministic selection from "phrase-locked rotation" to "per-event selection driven by (seed, role, phraseIndex, velocity, hitIndex)".

**Lean out (do NOT try to match competitors):**
- Do NOT build a synth engine. PSY Sampler plays samples. If you want synths, build a separate `PSY Synth` device that implements the same `PsyDevice` contract.
- Do NOT bundle instruments. Curate a high-quality reference sample manifest (CC0 / public-domain sources) and document how users add their own. Compete on curation, not volume.
- Do NOT build a GUI instrument. The demo UI is for development; the product is the device contract + the audio engine. Hosts (including third-party hosts) provide the UI.
- Do NOT add a Transport. The host owns transport. Adding one would violate the contract and destroy the moat.
- Do NOT implement KSP-like scripting. The deterministic selection policy IS the script. If users need custom selection, they extend `SelectionPolicy` — they don't write scripts inside the device.

### 6.2 The one-sentence pitch

> *"PSY Sampler is the deterministic, provenance-safe sampler device for PSY hosts — same seed and library always produce the same audio, and no sample without cleared commercial-use rights ever reaches the audio graph."*

Nobody else can say that. That is the niche.

---

## Appendix A: Source URL Inventory

| Competitor | Primary Source | Fetched Artifacts |
|---|---|---|
| Tone.js | https://tonejs.github.io | docs/15.1.22/classes/Sampler.html, docs/15.1.22/classes/PolySynth.html, github.com/Tonejs/Tone.js README, raw PolySynth.ts source |
| SMPLR | https://github.com/danigb/smplr | README (1140 lines), src/index.ts, src/smplr/index.ts, src/smplr/instrument.ts (258 lines), src/smplr/smplr.ts (493 lines), src/smplr/voice-manager.ts (81 lines) |
| soundfont-player | https://github.com/danigb/soundfont-player | README (262 lines) — archived |
| Kontakt | https://www.native-instruments.com | KSP manual (engine-parameters page), Kontakt manual (modulation page), product page, sweetwater.com/insync/voice-stealing-mode-kontakt-3, ask.video Kontakt 5 bus architecture |
| Ableton Drum Rack / Sampler / Simpler | https://www.ableton.com/en/manual/ | instrument-drum-and-effect-racks (full Rack manual), live-instrument-reference, blog.faderpro.com Simpler modes, audeobox.com Sampler guide |
| Tracktion Engine | https://github.com/Tracktion/tracktion_engine | README (106 lines), FEATURES.md (99 lines), tracktion_engine.h, plugins/effects/tracktion_SamplerPlugin.h (121 lines), plugins/effects/tracktion_SamplerPlugin.cpp (726 lines) |
| Bundle sizes | https://bundlephobia.com/api/size | tone (15.1.22: 333KB/78KB gzip), smplr (1.0.0: 65KB/22KB gzip), soundfont-player (0.12.0: 15KB/5.7KB gzip) |

## Appendix B: PSY Sampler Internal Source Files Read

For accurate PSY Sampler column entries, the following files were read end-to-end during this research:

- `/home/z/my-project/src/psy-sampler/device.ts` (207 lines) — `SamplerDevice` class, `onEvent` contract, sidechain trigger on kick
- `/home/z/my-project/src/psy-sampler/selector.ts` (218 lines) — `SelectionPolicy`, `deriveVariant`, `hashSeed3`, `pitchRatio`
- `/home/z/my-project/src/psy-sampler/audio-graph.ts` (252 lines) — 3-bus routing, delay/reverb sends, `triggerSidechain`, `makeImpulse` (Math.random IR — the determinism break)
- `/home/z/my-project/src/psy-sampler/voice.ts` (158 lines) — `SampleVoice`, 5ms steal fade, per-source gain
- `/home/z/my-project/src/psy-sampler/library.ts` (134 lines) — `SampleLibrary`, parallel loading (concurrency 6)
- `/home/z/my-project/src/psy-sampler/manifest.ts` (152 lines) — `validateManifest`, `LOADABLE_VERIFICATIONS` policy
- `/home/z/my-project/src/psy-sampler/provenance.ts` (62 lines) — `validateProvenance`, `isCommerciallyUsable`
- `/home/z/my-project/src/psy-sampler/types.ts` (255 lines) — `SampleManifestEntry` schema, `parseChannel`, `roleToBus`
- `/home/z/my-project/src/psy-sampler/realization-scheduler.ts` (128 lines) — 100ms horizon, 25ms tick, stale-event drop at 50ms
- `/home/z/my-project/src/psy-sampler/factory.ts` (112 lines) — `createSamplerDevice`, voice count default 32
- `/home/z/my-project/src/psy-foundation-shim/voice-pool.ts` (133 lines) — `VoicePool.allocate` round-robin + steal-oldest, `Rng` mulberry32

## Appendix C: Honest Confidence Notes

- **Kontakt claims** are based on the KSP engine-parameters reference page + secondary sources (Sweetwater, ask.video, vi-control). The full Kontakt 7 PDF manual (253 pages) was identified but not read in full due to size. Specific claims about HQI modes, voice stealing modes, and bus architecture are high-confidence; claims about exact voice limits per instrument are medium-confidence.
- **Ableton Drum Rack choke-group count (16)** and **return chain count (6)** are direct from the Ableton Reference Manual v12 — high confidence.
- **Tracktion Engine `maximumSimultaneousNotes = 32` hardcoded** is direct from the source code (`tracktion_SamplerPlugin.cpp:15`) — high confidence.
- **Tone.js PolySynth "no stealing, just drops"** is direct from `PolySynth.ts:226` (`warn("Max polyphony exceeded. Note dropped.")`) — high confidence.
- **SMPLR exclusive groups (`offBy`)** is direct from `smplr.ts:414-418` — high confidence.
- **PSY Sampler bundle size estimate (~25-30 KB gzip)** is an estimate from raw source byte count (91 KB TS), not a measured build output. Actual size depends on tree-shaking and whether the foundation shim is included. Medium confidence.
- **PSY Sampler license "TBD"** reflects the absence of a `LICENSE` file in the repo — verified by LS during this research.

---

*End of document.*
