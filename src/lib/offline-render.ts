// PSY Sampler — Offline WAV renderer.
//
// Renders a sequence of NoteEvents to a WAV file using OfflineAudioContext.
// This is DETERMINISTIC and FASTER THAN REAL-TIME: a 30-second arrangement
// renders in ~1 second. Two renders with the same inputs produce byte-identical
// output (the reverb IR is seeded, selection is seeded, no Math.random anywhere
// in the audio path).
//
// This replaces the old 8-second real-time MediaRecorder capture, which:
//   - was capped at 8 seconds (couldn't export a full arrangement)
//   - recorded in real time (30s track = 30s wait)
//   - captured whatever happened to play through the speakers (not deterministic)
//   - blocked the determinism claim end-to-end (you couldn't prove byte-identity)
//
// The offline renderer builds a PARALLEL audio graph on a fresh
// OfflineAudioContext, reuses the LIVE library's decoded sample buffers (AudioBuffers
// are context-independent per the Web Audio spec), runs the SAME selection +
// realization logic as the live device (choke groups, sidechain, bus routing),
// and renders. The live device is untouched.
//
// Browser support: OfflineAudioContext is supported in all evergreen browsers.
// In Safari, decodeAudioData works on OfflineAudioContext. AudioBuffers decoded
// by a live AudioContext can be played in an OfflineAudioContext (spec-compliant).

import {
  AudioGraph,
  SampleVoice,
  SelectionPolicy,
  SampleLibrary,
  realizeScheduledEvent,
  parseChannel,
  roleToBus,
  type SampleRole,
  type ScheduledSampleEvent,
} from '@/psy-sampler'
import { VoicePool } from '@/psy-foundation-shim'
import type { NoteEvent, MusicalTransport } from '@/psy-foundation-shim'
import { audioBufferToWavBlob, triggerDownload } from './wav-export'

export interface OfflineRenderOptions {
  /** The live sample library (its decoded AudioBuffers are reused — no re-decode). */
  library: SampleLibrary
  /** The live selection policy (deterministic — same inputs → same output). */
  selectionPolicy: SelectionPolicy
  /** NoteEvents to render, with .at times in seconds from render start. */
  events: NoteEvent[]
  /** Transport (provides revision=seed and bar=phraseIndex source). */
  transport: MusicalTransport
  /** Total render duration in seconds. Must exceed the last event.at + its decay. */
  durationSec: number
  /** Sample rate (default 44100). */
  sampleRate?: number
  /** Master gain (default 0.85). */
  masterGain?: number
  /** Number of voices in the offline pool (default 32). */
  voiceCount?: number
  /** Sidechain config (mirrors live audio graph). */
  sidechain?: { enabled: boolean; depth?: number }
  /** Bus gains 0..1.5 per bus (mirrors live mixer state). */
  busGains?: { drum?: number; music?: number; atmos?: number }
  /** Per-bus 3-band EQ in dB (-24..+24). Mirrors live mixer state. */
  busEQ?: {
    drum?: { low?: number; mid?: number; high?: number }
    music?: { low?: number; mid?: number; high?: number }
    atmos?: { low?: number; mid?: number; high?: number }
  }
  /** Per-bus saturation drive (0..10). Mirrors live mixer state. */
  busSaturation?: { drum?: number; music?: number; atmos?: number }
  /** Master filter config (mirrors live state). Absent = bypass (allpass). */
  masterFilter?: { type: BiquadFilterType; freq: number; Q: number }
  /** Master filter envelope (auto-wah on kick). Absent = disabled. */
  filterEnvelope?: { enabled: boolean; depth?: number; time?: number }
  /** Filename for the download (if triggerDownload=true). */
  filename?: string
  /** If true, auto-trigger a browser download of the WAV. Default true. */
  download?: boolean
}

export interface OfflineRenderResult {
  /** The WAV file as a Blob (16-bit PCM). */
  blob: Blob
  /** The rendered AudioBuffer (for inspection / re-encoding). */
  buffer: AudioBuffer
  /** Render time in milliseconds (excludes encoding). */
  renderMs: number
  /** Number of events actually realized (skips excluded). */
  eventsRealized: number
  /** Number of events skipped (no sample / unknown role). */
  eventsSkipped: number
}

/**
 * Render a sequence of NoteEvents to a WAV Blob via OfflineAudioContext.
 *
 * Determinism contract: given the same (library, selectionPolicy, events,
 * transport, durationSec, sampleRate, masterGain, voiceCount, sidechain,
 * busGains), the output Blob is BYTE-IDENTICAL across calls, tabs, and
 * machines. This is the end-to-end proof of the project's determinism claim
 * — not just "same sample selected" but "same audio bytes produced".
 *
 * @throws if OfflineAudioContext is unavailable (very old browsers).
 */
export async function renderOffline(opts: OfflineRenderOptions): Promise<OfflineRenderResult> {
  const {
    library,
    selectionPolicy,
    events,
    transport,
    durationSec,
    sampleRate = 44100,
    masterGain = 0.85,
    voiceCount = 32,
    sidechain,
    busGains,
    busEQ,
    busSaturation,
    masterFilter,
    filterEnvelope,
    filename = 'psy-sampler-render.wav',
    download = true,
  } = opts

  // OfflineAudioContext is a browser global. Guard for non-browser envs.
  const Ctor: typeof OfflineAudioContext | undefined =
    (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
  if (!Ctor) {
    throw new Error('OfflineAudioContext is not available in this environment.')
  }

  const length = Math.ceil(sampleRate * durationSec)
  const offlineCtx = new Ctor(2, length, sampleRate)
  // AudioGraph + SampleVoice only use BaseAudioContext methods (createGain,
  // createBufferSource, etc.) which OfflineAudioContext provides. We cast once
  // at the boundary so the rest of the audio chain is type-clean.
  const ctxAsLive = offlineCtx as unknown as AudioContext

  // ── Build a parallel audio graph on the offline context ─────────────────
  // No analyser offline (it's for live visualization only).
  const audioGraph = new AudioGraph(ctxAsLive, {
    masterGain,
    enableAnalyser: false,
  })

  // Mirror the live mixer state so the render matches what the user hears.
  if (busGains) {
    if (busGains.drum !== undefined) audioGraph.setBusGain('drum', busGains.drum)
    if (busGains.music !== undefined) audioGraph.setBusGain('music', busGains.music)
    if (busGains.atmos !== undefined) audioGraph.setBusGain('atmos', busGains.atmos)
  }
  if (busEQ) {
    if (busEQ.drum) audioGraph.setBusEQ('drum', busEQ.drum)
    if (busEQ.music) audioGraph.setBusEQ('music', busEQ.music)
    if (busEQ.atmos) audioGraph.setBusEQ('atmos', busEQ.atmos)
  }
  if (busSaturation) {
    if (busSaturation.drum !== undefined) audioGraph.setBusSaturation('drum', busSaturation.drum)
    if (busSaturation.music !== undefined) audioGraph.setBusSaturation('music', busSaturation.music)
    if (busSaturation.atmos !== undefined) audioGraph.setBusSaturation('atmos', busSaturation.atmos)
  }
  if (masterFilter) {
    audioGraph.setMasterFilter(masterFilter)
  }
  if (filterEnvelope) {
    audioGraph.setFilterEnvelopeEnabled(filterEnvelope.enabled)
    if (filterEnvelope.depth !== undefined && filterEnvelope.time !== undefined) {
      audioGraph.setFilterEnvelopeParams(filterEnvelope.depth, filterEnvelope.time)
    }
  }
  if (sidechain?.enabled) {
    audioGraph.setSidechainEnabled(true)
    if (sidechain.depth !== undefined) audioGraph.setSidechainDepth(sidechain.depth)
  }
  // Sync delay to the transport BPM (same as the live device's onTransport).
  audioGraph.syncDelayToBpm(transport.bpm)

  // ── Voice pool on the offline context ───────────────────────────────────
  const defaultBus = audioGraph.getBusInput('drum')
  const voicePool = new VoicePool<SampleVoice>(
    () => new SampleVoice({ audioContext: ctxAsLive, output: defaultBus }),
    voiceCount
  )

  // ── Realize each event (selection + choke + trigger) ────────────────────
  // Events are sorted by .at so voice stealing + chokes happen in musical order.
  // We trigger them all synchronously at construction time; each voice.trigger()
  // schedules its start/stop on the offline timeline via AudioParam ramps, and
  // startRendering() advances the clock to produce the correct output.
  //
  // A per-role hit counter mirrors the live device's hitCounters so the offline
  // render produces the SAME round-robin selection sequence as live playback
  // (same events in same order → same hitIndex → same sampleId → byte-identical
  // audio). This is the end-to-end determinism proof.
  const sorted = [...events].sort((a, b) => a.at - b.at)
  let realized = 0
  let skipped = 0
  const seed = transport.revision ?? 0
  const barsPerPhrase = 8
  const phraseIndex = Math.floor(Math.max(0, transport.bar) / barsPerPhrase)
  const hitCounters = new Map<SampleRole, number>()

  for (const event of sorted) {
    if (event.type !== 'note') continue
    const parsed = parseChannel(event.channel)
    if (parsed.role === null) {
      skipped += 1
      continue
    }
    const role: SampleRole = parsed.role
    const hitIndex = hitCounters.get(role) ?? 0
    const selection = selectionPolicy.selectWithNote(
      { role, bank: parsed.bank, velocity: event.velocity, phraseIndex, seed, hitIndex },
      event.note
    )
    if (selection === null) {
      skipped += 1
      continue
    }
    const asset = library.get(selection.sampleId)
    if (!asset) {
      skipped += 1
      continue
    }
    hitCounters.set(role, hitIndex + 1)
    const bus = roleToBus(role)
    const decay = selectionPolicy.decayFor(role)
    if (role === 'kick' && sidechain?.enabled) {
      audioGraph.triggerSidechain(event.at)
    }
    const scheduled: ScheduledSampleEvent = {
      at: event.at,
      sampleId: selection.sampleId,
      buffer: asset.audioBuffer,
      bus,
      role,
      opts: {
        at: event.at,
        playbackRate: selection.playbackRate,
        gain: selection.gain,
        pan: selection.pan,
        decay,
      },
    }
    realizeScheduledEvent(scheduled, voicePool, audioGraph)
    realized += 1
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const t0 = performance.now()
  const rendered = await offlineCtx.startRendering()
  const renderMs = performance.now() - t0

  // ── Encode + download ───────────────────────────────────────────────────
  const blob = audioBufferToWavBlob(rendered)
  if (download) triggerDownload(blob, filename)

  // ── Cleanup (release offline graph nodes) ───────────────────────────────
  voicePool.panic()
  audioGraph.dispose()

  return { blob, buffer: rendered, renderMs, eventsRealized: realized, eventsSkipped: skipped }
}
