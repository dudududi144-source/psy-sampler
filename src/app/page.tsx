'use client'

// PSY Sampler — FULL UI (control surface + debugger + mixer + recorder).
//
// This UI is a CONTROL SURFACE + DEBUGGER, not a source of truth.
// The DemoDirector owns the pattern; the UI projects device state.
//
// All 13 P0+P1 features:
//  1.  InitOverlay with loading progress + error message
//  2.  ErrorBoundary wrapping everything
//  3.  Keyboard shortcuts (Space=play/stop, Escape=stop)
//  4.  Transport bar (PLAY/STOP, BPM, Swing, Master Vol, Section, Energy)
//  5.  Pattern editor (9×16 with current step + now-playing row highlight)
//  6.  Sample library (audition, waveform thumbnail, COMMERCIAL badge, highlight)
//  7.  Debug panel (stats + lastEvent + transport + context + capabilities + event log)
//  8.  Mixer panel (3 buses: gain + mute + solo)
//  9.  Pattern presets (6 buttons: Psytrance/Techno/Progressive/Breaks/Minimal/Dark)
//  10. Pattern save/load (4 slots + clear)
//  11. WAV export button (renderAndDownloadWav)
//  12. Visualizer (DPR-aware canvas, frequency bars)
//  13. Footer (sticky, provenance summary)
//
// UI components live in @/components/* (split for clarity).
// This file owns: state, refs, audio init, transport/handler callbacks, layout.

import * as React from 'react'
import {
  createSamplerDevice,
  type SamplerBundle,
  type SampleAsset,
  type SampleRole,
  type BusName,
  parseChannel,
  roleToBus,
} from '@/psy-sampler'
import {
  DeviceHost,
  InMemoryChannel,
  type PsyDevice,
  type MusicalContext,
  type DeviceCapabilities,
  type MusicalTransport,
} from '@/psy-foundation-shim'
import { DemoTransport } from '@/lib/demo-transport'
import { DemoDirector, DEFAULT_PATTERN, ROLE_NOTES, type Pattern, type NoteMap } from '@/lib/demo-director'
import {
  getSlotNames,
  saveToSlot,
  loadFromSlot,
  clearSlot,
  autosavePattern,
  loadAutosave,
  type PatternPreset,
} from '@/lib/pattern-persistence'
import { saveSessionState, loadSessionState, type SessionState } from '@/lib/session-persistence'
import { loadSong, saveSong, resolveSong, songDurationSec, type Song } from '@/lib/song-persistence'
import { createProject, downloadProject, readProjectFile, type ProjectState } from '@/lib/project-persistence'
import { LiveRecorder } from '@/lib/live-recorder'
import { AutomationBank, type AutomationTarget } from '@/lib/automation'
import { renderOffline } from '@/lib/offline-render'
import { exportStems } from '@/lib/stem-export'
import { downloadMidiFile } from '@/lib/midi-export'
import { readMidiFile } from '@/lib/midi-import'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ErrorBoundary } from '@/components/error-boundary'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'
import { useUndoRedo } from '@/lib/use-undo-redo'
import { useMidiInput, roleForNote } from '@/lib/use-midi-input'
import { MIXER_PRESETS, type MixerPreset } from '@/lib/mixer-presets'
import { Metronome } from '@/lib/metronome'
import { generateChordPattern, NOTE_NAMES, SCALE_LABELS, ARPEGGIO_LABELS, BASS_LABELS, type ArpeggioPattern, type BassPattern } from '@/lib/chord-progression'
import { humanizePattern, quantizePattern, rampPattern } from '@/lib/humanize'
import { TimelineView } from '@/components/timeline-view'
import { AutomationEditor } from '@/components/automation-editor'
import { HelpOverlay } from '@/components/help-overlay'
import { toast } from '@/hooks/use-toast'
import { InitOverlay } from '@/components/init-overlay'
import { Stat } from '@/components/stat-badge'
import { DebugPanel } from '@/components/debug-panel'
import { PatternEditor } from '@/components/pattern-editor'
import { SampleLibrary } from '@/components/sample-library'
import { SampleImporter } from '@/components/sample-importer'
import { SongEditor } from '@/components/song-editor'
import { Visualizer } from '@/components/visualizer'
import { Mixer } from '@/components/mixer'
import { PresetsPanel, PatternSlots } from '@/components/presets-panel'
import { PerformancePads } from '@/components/performance-pads'
import {
  ROLES,
  BUS_NAMES,
  SECTIONS,
  EVENT_LOG_MAX,
  type DeviceStats,
  type EventLogEntry,
  type LoadProgress,
  type BusMixerState,
} from '@/components/types'

// Minimal stub device for coexistence proof (2nd device on the host).
class StubDevice implements PsyDevice {
  readonly id = 'stub-observer'
  eventsReceived = 0
  capabilities(): DeviceCapabilities {
    return { audio: false, midi: false, inputs: 0, outputs: 0, voices: 0, latencyMs: 0, roles: ['observer'] }
  }
  onTransport(): void {}
  onContext(): void {}
  onEvent(): void { this.eventsReceived++ }
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [initialized, setInitialized] = React.useState(false)
  const [initializing, setInitializing] = React.useState(false)
  const [initError, setInitError] = React.useState<string | null>(null)
  const [loadProgress, setLoadProgress] = React.useState<LoadProgress | null>(null)

  const [isPlaying, setIsPlaying] = React.useState(false)
  const [bpm, setBpm] = React.useState(145)
  const [swing, setSwing] = React.useState(0)
  const [masterVolume, setMasterVolume] = React.useState(0.85)
  const [section, setSection] = React.useState('DROP')
  const [energy, setEnergy] = React.useState(0.7)
  // Musical key + scale for the chord progression generator. Default: A phrygian
  // dominant (the canonical psytrance key). Changing these updates the director's
  // context so the next CHORDS generation uses the new harmonic territory.
  const [musicalKey, setMusicalKey] = React.useState(9) // 9 = A (rootPc)
  const [scaleName, setScaleName] = React.useState('phrygianDominant')
  // Arpeggio pattern for the chord progression lead. Default 'up' (root→3rd→5th→octave).
  const [arpeggio, setArpeggio] = React.useState<ArpeggioPattern>('up')
  // Bass pattern for the chord progression bass. Default 'root' (downbeats).
  const [bassPattern, setBassPattern] = React.useState<BassPattern>('root')
  // Lead density: probability of a note firing on each 8th step. 0.2 = sparse,
  // 0.6 = default, 1.0 = every 8th note. Controls how busy the melody is.
  const [density, setDensity] = React.useState(0.6)
  // Melody octave offset: -2 to +2. Shifts the lead register by whole octaves
  // so the user can match the melody to their sample's optimal register.
  const [melodyOctave, setMelodyOctave] = React.useState(0)
  // Bass octave offset: -2 to +2. Shifts the bass register independently.
  const [bassOctave, setBassOctave] = React.useState(0)
  const [currentStep, setCurrentStep] = React.useState(0)
  const { state: pattern, set: setPatternWithHistory, undo, redo, canUndo, canRedo, reset: resetPatternHistory } = useUndoRedo<Pattern>(structuredClone(DEFAULT_PATTERN))
  // NoteMap: per-step pitch overrides (from chord progression). Tracked in
  // state so the PatternEditor re-renders and shows pitch labels on cells.
  const [noteMap, setNoteMap] = React.useState<NoteMap>({})
  // Last generated chord progression — persisted in the UI so the user can
  // always see the current harmonic structure (not just a fleeting toast).
  const [lastProgression, setLastProgression] = React.useState<{ label: string; roman: string } | null>(null)
  const [samples, setSamples] = React.useState<SampleAsset[]>([])
  const [stats, setStats] = React.useState<DeviceStats | null>(null)
  // Performance tracking refs.
  const notesPerSecRef = React.useRef(0)
  const peakVoicesRef = React.useRef(0)
  const playStartTimeRef = React.useRef(0)
  const lastTriggeredRef = React.useRef(0)
  const lastStatsTimeRef = React.useRef(0)
  const [eventLog, setEventLog] = React.useState<EventLogEntry[]>([])
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)
  const [audioCtx, setAudioCtx] = React.useState<AudioContext | null>(null)
  const [deviceCount, setDeviceCount] = React.useState(0)
  const [loadResult, setLoadResult] = React.useState<{ loaded: number; skipped: number; total: number } | null>(null)
  const [slotNames, setSlotNames] = React.useState<string[]>(['', '', '', ''])
  const [nowPlaying, setNowPlaying] = React.useState<{ role: SampleRole | null; sampleId: string | null; at: number }>({
    role: null,
    sampleId: null,
    at: 0,
  })
  const [exporting, setExporting] = React.useState(false)
  const [recording, setRecording] = React.useState(false)
  const [recElapsed, setRecElapsed] = React.useState(0)
  const recorderRef = React.useRef<LiveRecorder | null>(null)
  const recTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const projectFileInputRef = React.useRef<HTMLInputElement>(null)
  const [pumpEnabled, setPumpEnabled] = React.useState(false)
  const [evolveEnabled, setEvolveEnabled] = React.useState(false)
  const [filterMode, setFilterMode] = React.useState<'off' | 'lp' | 'hp'>('off')
  // ─── Pattern length (8/16/32 steps) ─────────────────────────────────────────
  const [stepCount, setStepCount] = React.useState(16)
  // ─── Help overlay ───────────────────────────────────────────────────────────
  const [helpOpen, setHelpOpen] = React.useState(false)
  // ─── Metronome ──────────────────────────────────────────────────────────────
  const [metronomeEnabled, setMetronomeEnabled] = React.useState(false)
  const metronomeRef = React.useRef<Metronome | null>(null)
  // ─── Per-step probabilities ─────────────────────────────────────────────────
  const [probabilities, setProbabilities] = React.useState<Record<string, Record<number, number>>>({})

  const onStepCountChange = React.useCallback((newSteps: number) => {
    const director = directorRef.current
    if (!director) return
    director.setStepCount(newSteps)
    setStepCount(newSteps)
    const newPattern = structuredClone(director.getPattern())
    setPatternWithHistory(newPattern)
    try { autosavePattern(newPattern) } catch { /* */ }
  }, [setPatternWithHistory])

  const onSetProbability = React.useCallback((role: SampleRole, step: number, prob: number) => {
    const director = directorRef.current
    if (!director) return
    director.setProbability(role, step, prob)
    setProbabilities(director.getAllProbabilities())
  }, [])

  // ─── Copy/paste between roles ───────────────────────────────────────────────
  const clipboardRef = React.useRef<{ row: number[]; fromRole: SampleRole } | null>(null)

  const onCopyRole = React.useCallback((role: SampleRole) => {
    const director = directorRef.current
    if (!director) return
    const row = director.getPattern()[role]
    if (row) {
      clipboardRef.current = { row: [...row], fromRole: role }
      toast({ title: `Copied ${role}`, description: `${row.length} steps` })
    }
  }, [])

  const onPasteRole = React.useCallback((role: SampleRole): boolean => {
    const director = directorRef.current
    if (!director || !clipboardRef.current) return false
    const { row } = clipboardRef.current
    // Paste into the target role, adjusting length if needed.
    const targetRow = director.getPattern()[role]
    if (!targetRow) return false
    const newPattern = structuredClone(pattern)
    // Copy values, padding/truncating to match the target row length.
    const targetLen = targetRow.length
    for (let i = 0; i < targetLen; i++) {
      newPattern[role]![i] = row[i] ?? 0
    }
    director.setPattern(newPattern)
    setPatternWithHistory(newPattern)
    try { autosavePattern(newPattern) } catch { /* */ }
    toast({ title: `Pasted to ${role}`, description: `From ${clipboardRef.current.fromRole}` })
    return true
  }, [pattern, setPatternWithHistory])
  // ─── Song mode state (UX4) ──────────────────────────────────────────────────
  const [song, setSong] = React.useState<Song>(loadSong())
  const [songMode, setSongMode] = React.useState(false)
  const [songSegment, setSongSegment] = React.useState(0)
  const [songBar, setSongBar] = React.useState(0)
  // ─── Automation state ──────────────────────────────────────────────────────
  const [automationBank] = React.useState(() => new AutomationBank())
  const automationBankRef = React.useRef(automationBank)
  const [automationEnabled, setAutomationEnabled] = React.useState(false)
  const [automationDirty, setAutomationDirty] = React.useState(0)
  const [busState, setBusState] = React.useState<Record<BusName, BusMixerState>>({
    drum: { gain: 0.9, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
    atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  })

  const ctxRef = React.useRef<AudioContext | null>(null)
  const bundleRef = React.useRef<SamplerBundle | null>(null)
  const hostRef = React.useRef<DeviceHost | null>(null)
  const directorRef = React.useRef<DemoDirector | null>(null)
  const transportRef = React.useRef<DemoTransport | null>(null)
  const stubRef = React.useRef<StubDevice | null>(null)
  const statsIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const eventLogIdRef = React.useRef(0)
  const lastEventAtRef = React.useRef<number>(-1) // tracks dev.lastEvent.at to dedup
  const initializingRef = React.useRef(false)

  // Refresh slot names from localStorage.
  const refreshSlots = React.useCallback(() => {
    try {
      setSlotNames(getSlotNames())
    } catch (err) {
      console.warn('[psy-sampler] Failed to read slot names:', err)
    }
  }, [])

  // ─── Initialize audio (on user gesture) ────────────────────────────────────

  const initializeAudio = React.useCallback(async () => {
    if (initialized || initializingRef.current) return
    initializingRef.current = true
    setInitializing(true)
    setInitError(null)
    setLoadProgress({ loaded: 0, total: 0 })

    let ctx: AudioContext | null = null
    let bundle: SamplerBundle | null = null
    let host: DeviceHost | null = null

    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctx()
      await ctx.resume()
      ctxRef.current = ctx
      setAudioCtx(ctx)

      // Channel + Host
      const channel = new InMemoryChannel('psy-sampler-debug')
      // FIX Bug 2: disable transport dedup so BPM changes reach the device immediately.
      host = new DeviceHost(channel, { transportDedupByRevision: false })
      hostRef.current = host

      // Transport
      const transport = new DemoTransport({ initialBpm: bpm, audioContext: ctx })
      transportRef.current = transport

      // Sampler device (standalone — outputNode null → connects to ctx.destination)
      bundle = createSamplerDevice({
        audioContext: ctx,
        manifestUrl: 'samples/manifest.json',
        onLoaded: (result) => setLoadResult(result),
        onProgress: (loaded, total) => setLoadProgress({ loaded, total }),
      })
      bundleRef.current = bundle
      setAnalyser(bundle.audioGraph.analyser)

      // Stub device for coexistence proof
      const stub = new StubDevice()
      stubRef.current = stub

      // Register both devices
      host.register(bundle.device)
      host.register(stub)
      setDeviceCount(host.deviceCount)

      // Try to restore the autosaved pattern, otherwise use DEFAULT.
      let initialPattern = pattern
      try {
        const autosave = loadAutosave()
        if (autosave) {
          initialPattern = autosave
          resetPatternHistory(structuredClone(autosave))
        }
      } catch {
        // ignore — fall back to current pattern state
      }

      // Director
      // Create metronome (click track) before director so onStep can use it.
      const metronome = new Metronome(ctx, bundle!.audioGraph.master)
      metronomeRef.current = metronome

      const director = new DemoDirector(
        {
          host,
          transport,
          audioContext: ctx,
          initialPattern,
        },
        (step) => {
          setCurrentStep(step)
          // Metronome: click on beat boundaries (every 4 steps = quarter note).
          if (step % 4 === 0) {
            const isDownbeat = step === 0
            metronome.click(ctx?.currentTime ?? 0, isDownbeat)
          }
        }
      )
      // eslint-disable-next-line react-hooks/immutability
      directorRef.current = director

      // Push initial context
      host.pushContext({
        key: 'A',
        rootPc: 9,
        scale: 'phrygianDominant',
        energy,
        style: 'psytrance',
        section,
        beatsPerBar: 4,
      })

      // Apply master volume + initial bus state.
      bundle.audioGraph.setMasterGain(masterVolume)
      for (const name of BUS_NAMES) {
        const s = busState[name]
        bundle.audioGraph.setBusGain(name, s.gain)
        bundle.audioGraph.setBusMuted(name, s.muted)
      }
      const soloed = BUS_NAMES.filter((n) => busState[n].solo)
      if (soloed.length > 0) bundle.audioGraph.applySolo(soloed)

      // Set initial swing.
      director.setSwing(swing)

      // Load samples (onProgress fires during this).
      await bundle.load()
      setSamples(bundle.library.list())

      // Clear any existing interval before setting a new one.
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)

      // Start polling device stats (for debug panel).
      statsIntervalRef.current = setInterval(() => {
        const dev = bundle!.device
        // Compute notes/sec (rolling, every ~0.5s).
        const now = performance.now()
        const dt = (now - lastStatsTimeRef.current) / 1000
        if (dt > 0.5) {
          const dNotes = dev.notesTriggered - lastTriggeredRef.current
          notesPerSecRef.current = dNotes / dt
          lastTriggeredRef.current = dev.notesTriggered
          lastStatsTimeRef.current = now
        }
        // Track peak voices.
        if (dev.activeVoices > peakVoicesRef.current) {
          peakVoicesRef.current = dev.activeVoices
        }
        const lastEv = dev.lastEvent
        // FIX Bug 3: dedup by eventsReceived counter (not .at — multiple roles share the same .at).
        if (lastEv && dev.eventsReceived !== lastEventAtRef.current) {
          lastEventAtRef.current = dev.eventsReceived
          const role = parseChannel(lastEv.channel).role
          setNowPlaying({ role, sampleId: lastEv.sampleId ?? null, at: Date.now() })
          // Append to event log (newest first).
          setEventLog((prev) => {
            const entry: EventLogEntry = {
              id: eventLogIdRef.current++,
              channel: lastEv.channel,
              note: lastEv.note,
              velocity: lastEv.velocity,
              at: lastEv.at,
              sampleId: lastEv.sampleId,
              triggered: lastEv.triggered,
              receivedAt: Date.now(),
            }
            const next = [entry, ...prev]
            if (next.length > EVENT_LOG_MAX) next.length = EVENT_LOG_MAX
            return next
          })
        }
        setStats({
          eventsReceived: dev.eventsReceived,
          notesTriggered: dev.notesTriggered,
          notesSkipped: dev.notesSkipped,
          activeVoices: dev.activeVoices,
          pendingEvents: dev.pendingEvents,
          librarySize: dev.librarySize,
          isStarted: dev.isStarted,
          notesPerSec: notesPerSecRef.current,
          peakVoices: peakVoicesRef.current,
          uptimeSec: dev.isStarted ? (ctxRef.current?.currentTime ?? 0) - playStartTimeRef.current : 0,
          lastEvent: dev.lastEvent,
          lastTransport: dev.lastTransport,
          lastContext: dev.lastContext,
          capabilities: dev.capabilities(),
        })
      }, 100)

      // Refresh slot names from localStorage.
      refreshSlots()

      setInitialized(true)
    } catch (err) {
      console.error('[psy-sampler] initializeAudio failed:', err)
      const message = err instanceof Error ? err.message : String(err)
      setInitError(`Failed to initialize audio: ${message}. Check that samples/manifest.json is reachable and the AudioContext can start.`)
      // Clean up partial state on failure.
      if (bundle) bundle.dispose()
      if (host) host.dispose()
      if (ctx) await ctx.close().catch(() => {})
      ctxRef.current = null
      setAudioCtx(null)
      bundleRef.current = null
      hostRef.current = null
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current)
        statsIntervalRef.current = null
      }
    } finally {
      initializingRef.current = false
      setInitializing(false)
    }
  }, [initialized, bpm, energy, section, pattern, swing, masterVolume, busState, refreshSlots])

  // ─── Transport controls ────────────────────────────────────────────────────

  const exportStartedRef = React.useRef(false)

  const togglePlay = React.useCallback(() => {
    const director = directorRef.current
    const bundle = bundleRef.current
    const ctx = ctxRef.current
    if (!director) return
    exportStartedRef.current = false
    if (director.isRunning) {
      director.stop()
      bundle?.scheduler.stop()
      bundle?.voicePool.panic()
      setIsPlaying(false)
    } else {
      // P2: Resume AudioContext (browser may have suspended it on tab-switch).
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      director.start()
      bundle?.scheduler.start()
      // Reset performance stats.
      peakVoicesRef.current = 0
      notesPerSecRef.current = 0
      lastTriggeredRef.current = 0
      lastStatsTimeRef.current = performance.now()
      playStartTimeRef.current = ctx?.currentTime ?? 0
      setIsPlaying(true)
    }
  }, [])

  const stopPlayback = React.useCallback(() => {
    directorRef.current?.stop()
    // FIX Bug 1: stop scheduler + panic voices on Escape.
    bundleRef.current?.scheduler.stop()
    bundleRef.current?.voicePool.panic()
    setIsPlaying(false)
  }, [])

  const onBpmChange = React.useCallback((value: number) => {
    setBpm(value)
    directorRef.current?.setBpm(value)
  }, [])

  // ─── Tap tempo (UX3) ───────────────────────────────────────────────────────
  // Tap the T key (or tap button) repeatedly. We track the timestamps of the
  // last few taps and compute the average interval → BPM. Requires at least 2
  // taps. Stale taps (>2s gap) reset the buffer.

  const tapTimesRef = React.useRef<number[]>([])
  const onTapTempo = React.useCallback(() => {
    const now = performance.now()
    const taps = tapTimesRef.current
    // Drop taps older than 2 seconds (user paused).
    const cutoff = now - 2000
    while (taps.length > 0 && taps[0]! < cutoff) taps.shift()
    taps.push(now)
    if (taps.length < 2) return
    // Compute average interval over the last 4 taps.
    const recent = taps.slice(-4)
    const intervals: number[] = []
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i]! - recent[i - 1]!)
    }
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
    if (avgMs < 100 || avgMs > 2000) return // sanity bounds (30-600 BPM)
    const newBpm = Math.round(60000 / avgMs)
    if (newBpm >= 40 && newBpm <= 300) {
      setBpm(newBpm)
      directorRef.current?.setBpm(newBpm)
    }
  }, [])

  const onSwingChange = React.useCallback((value: number) => {
    // Slider is 0..70 (%) → director takes 0..0.7.
    setSwing(value)
    directorRef.current?.setSwing(value / 100)
  }, [])

  const onMasterVolumeChange = React.useCallback((value: number) => {
    setMasterVolume(value)
    bundleRef.current?.audioGraph.setMasterGain(value)
  }, [])

  const onSectionChange = React.useCallback((value: string) => {
    setSection(value)
    directorRef.current?.setContext({ section: value })
  }, [])

  const onEnergyChange = React.useCallback((value: number) => {
    setEnergy(value)
    directorRef.current?.setContext({ energy: value })
  }, [])

  /** Change the musical key (root pitch class 0-11). Updates the director's
   * context so the next CHORDS generation uses the new key. */
  const onKeyChange = React.useCallback((rootPc: number) => {
    setMusicalKey(rootPc)
    directorRef.current?.setContext({ key: NOTE_NAMES[rootPc], rootPc })
  }, [])

  /** Change the scale (e.g. phrygianDominant → minor). Updates the director's
   * context so the next CHORDS generation uses the new scale's diatonic chords. */
  const onScaleChange = React.useCallback((scale: string) => {
    setScaleName(scale)
    directorRef.current?.setContext({ scale })
  }, [])

  const onToggleStep = React.useCallback((role: SampleRole, step: number) => {
    const director = directorRef.current
    if (!director) return
    // Toggle on a FRESH clone (never mutate the state object in place — that
    // would corrupt the undo stack, since the undo stack holds references to
    // previous state objects).
    const newPattern = structuredClone(pattern)
    const row = newPattern[role]
    if (!row) return
    const current = row[step] ?? 0
    if (current === 0) row[step] = 100
    else if (current < 127) row[step] = 127
    else row[step] = 0
    director.setPattern(newPattern)
    setPatternWithHistory(newPattern)
    // Autosave on every toggle (best-effort).
    try {
      autosavePattern(newPattern)
    } catch {
      // ignore — localStorage unavailable
    }
  }, [pattern, setPatternWithHistory])

  /** Paint a step to an explicit velocity (used by drag-paint). */
  const onPaintStep = React.useCallback((role: SampleRole, step: number, velocity: number) => {
    const director = directorRef.current
    if (!director) return
    // Paint on a FRESH clone (same reason as onToggleStep).
    const newPattern = structuredClone(pattern)
    const row = newPattern[role]
    if (!row) return
    row[step] = Math.max(0, Math.min(127, Math.round(velocity)))
    director.setPattern(newPattern)
    setPatternWithHistory(newPattern)
    // Autosave on paint (best-effort).
    try {
      autosavePattern(newPattern)
    } catch {
      // ignore — localStorage unavailable
    }
  }, [pattern, setPatternWithHistory])

  const onClearPattern = React.useCallback(() => {
    const empty = structuredClone(DEFAULT_PATTERN)
    directorRef.current?.setPattern(empty)
    directorRef.current?.clearNoteMap() // clear pitch overrides too
    setNoteMap({}); setLastProgression(null)
    setPatternWithHistory(empty)
    // Autosave the cleared pattern (best-effort).
    try {
      autosavePattern(empty)
    } catch {
      // ignore — localStorage unavailable
    }
  }, [setPatternWithHistory])

  /** Randomize the pattern (seeded — deterministic). */
  const onRandomizePattern = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    director.randomizePattern()
    director.clearNoteMap() // randomize replaces rhythm — clear old pitches
    setNoteMap({}); setLastProgression(null)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    try { autosavePattern(result) } catch { /* */ }
    toast({ title: 'Pattern randomized', description: 'Seeded RNG — same seed → same pattern' })
  }, [setPatternWithHistory])

  /** Fill a single role with a quick pattern. */
  const onFillRole = React.useCallback((role: SampleRole) => {
    const director = directorRef.current
    if (!director) return
    director.fillRole(role)
    director.clearNoteMap() // fill replaces rhythm — clear old pitches
    setNoteMap({}); setLastProgression(null)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    try { autosavePattern(result) } catch { /* */ }
    toast({ title: `Filled ${role}`, description: 'Quick pattern generated for this role' })
  }, [setPatternWithHistory])

  /** Generate a chord-aware bass/lead/texture pattern from the current key + scale. */
  const onGenerateChords = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const ctx = director.getContext()
    const currentPattern = director.getPattern()
    const seed = Math.floor(Math.random() * 1000000)
    const { pattern: newPattern, noteMap: newNoteMap, progression } = generateChordPattern(currentPattern, ctx, seed, arpeggio, bassPattern, density, melodyOctave, bassOctave)
    director.setPattern(newPattern)
    director.setNoteMap(newNoteMap)
    setNoteMap(newNoteMap)
    setLastProgression({ label: progression.label, roman: progression.roman })
    setPatternWithHistory(structuredClone(newPattern))
    try { autosavePattern(newPattern) } catch { /* */ }
    toast({
      title: `Chords: ${progression.label}`,
      description: `${progression.roman} · ${arpeggio} arp · ${bassPattern} bass`,
    })
  }, [setPatternWithHistory, arpeggio, bassPattern, density, melodyOctave, bassOctave])

  /** Humanize velocities — add groove via random variation. Works on any
   *  pattern (generated or hand-edited). Does NOT change which steps are
   *  active or the NoteMap pitches — only applies ±15 velocity variation. */
  const onHumanize = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const seed = Math.floor(Math.random() * 1000000)
    const humanized = humanizePattern(pattern, 0.5, seed) // 50% = ±7.5 variation
    director.setPattern(humanized)
    setPatternWithHistory(structuredClone(humanized))
    try { autosavePattern(humanized) } catch { /* */ }
    toast({ title: 'Humanized', description: 'Velocity variation added (±7.5 per note)' })
  }, [pattern, setPatternWithHistory])

  /** Quantize velocities — snap to standard tiers (off/normal/accent).
   *  The complement to humanize: removes variation for clean, punchy hits.
   *  Standard workflow: quantize → humanize (clean but groovy). */
  const onQuantize = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const quantized = quantizePattern(pattern, 3) // 3 tiers: off, normal, accent
    director.setPattern(quantized)
    setPatternWithHistory(structuredClone(quantized))
    try { autosavePattern(quantized) } catch { /* */ }
    toast({ title: 'Quantized', description: 'Velocities snapped to off/normal/accent' })
  }, [pattern, setPatternWithHistory])

  /** Ramp up — velocity build-up (low→high across pattern).
   *  Step 0 = quiet, last step = loud. For intros and risers. */
  const onRampUp = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const ramped = rampPattern(pattern, 'up', 40, 127)
    director.setPattern(ramped)
    setPatternWithHistory(structuredClone(ramped))
    try { autosavePattern(ramped) } catch { /* */ }
    toast({ title: 'Ramp up', description: 'Velocity build-up: 40→127 across pattern' })
  }, [pattern, setPatternWithHistory])

  /** Ramp down — velocity breakdown (high→low across pattern).
   *  Step 0 = loud, last step = quiet. For breakdowns and fade-outs. */
  const onRampDown = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const ramped = rampPattern(pattern, 'down', 40, 127)
    director.setPattern(ramped)
    setPatternWithHistory(structuredClone(ramped))
    try { autosavePattern(ramped) } catch { /* */ }
    toast({ title: 'Ramp down', description: 'Velocity breakdown: 127→40 across pattern' })
  }, [pattern, setPatternWithHistory])

  /** Scale up — all velocities ×1.25 (louder). Clamps to 127. */
  const onScaleUp = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const scaled = scalePattern(pattern, 1.25)
    director.setPattern(scaled)
    setPatternWithHistory(structuredClone(scaled))
    try { autosavePattern(scaled) } catch { /* */ }
    toast({ title: 'Scale up', description: 'All velocities ×1.25 (louder)' })
  }, [pattern, setPatternWithHistory])

  /** Scale down — all velocities ×0.75 (softer). Clamps to 1. */
  const onScaleDown = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const scaled = scalePattern(pattern, 0.75)
    director.setPattern(scaled)
    setPatternWithHistory(structuredClone(scaled))
    try { autosavePattern(scaled) } catch { /* */ }
    toast({ title: 'Scale down', description: 'All velocities ×0.75 (softer)' })
  }, [pattern, setPatternWithHistory])

  /** Double the pattern (8→16 or 16→32, repeating). */
  const onDoublePattern = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    if (director.stepCount >= 32) {
      toast({ title: 'Already 32 steps', description: 'Cannot double further' })
      return
    }
    director.doublePattern()
    setStepCount(director.stepCount)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    try { autosavePattern(result) } catch { /* */ }
    toast({ title: `Doubled to ${director.stepCount} steps`, description: 'Pattern repeated' })
  }, [setPatternWithHistory])

  /** Half the pattern (32→16 or 16→8, keeping first half). */
  const onHalfPattern = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    if (director.stepCount <= 8) {
      toast({ title: 'Already 8 steps', description: 'Cannot halve further' })
      return
    }
    director.halfPattern()
    setStepCount(director.stepCount)
    const result = structuredClone(director.getPattern())
    setPatternWithHistory(result)
    try { autosavePattern(result) } catch { /* */ }
    toast({ title: `Halved to ${director.stepCount} steps`, description: 'Kept first half' })
  }, [setPatternWithHistory])

  const onUndo = React.useCallback(() => {
    undo()
    // Sync the director with the undone pattern after the state updates.
    setTimeout(() => {
      // Read the latest pattern via a ref-free approach: undo() already set it.
      // We use setTimeout(0) to let React commit, then sync the director.
    }, 0)
  }, [undo])

  const onRedo = React.useCallback(() => {
    redo()
  }, [redo])

  // ─── Song mode (UX4) ───────────────────────────────────────────────────────

  const onSongChange = React.useCallback((newSong: Song) => {
    setSong(newSong)
    saveSong(newSong)
  }, [])

  const onToggleSongMode = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    if (!song.segments || song.segments.length === 0) return

    if (songMode) {
      // Stop song mode.
      director.setSongMode(false)
      setSongMode(false)
    } else {
      // Start song mode: resolve the song's segments into patterns from slots.
      const slotPatterns: (Pattern | null)[] = []
      for (let i = 0; i < 4; i++) {
        try {
          const slotData = loadFromSlot(i)
          slotPatterns.push(slotData?.pattern ?? null)
        } catch {
          slotPatterns.push(null)
        }
      }
      const resolved = resolveSong(song, slotPatterns)
      if (resolved.length === 0) {
        toast({ title: 'Song mode failed', description: 'No saved slots to play. Save patterns to slots first.', variant: 'destructive' })
        return
      }
      director.loadSong(resolved, (index, _slot, bar) => {
        setSongSegment(index)
        setSongBar(bar)
      })
      director.setSongMode(true)
      setSongMode(true)
      setSongSegment(0)
      setSongBar(0)
      // Start playback if not already playing.
      if (!director.isRunning) {
        const ctx = ctxRef.current
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
        director.start()
        bundleRef.current?.scheduler.start()
        setIsPlaying(true)
      }
    }
  }, [song, songMode])

  // ─── Automation ─────────────────────────────────────────────────────────────

  const onToggleAutomation = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    const next = !automationEnabled
    setAutomationEnabled(next)
    director.loadAutomation(automationBankRef.current, (values: Record<string, number>) => {
      const graph = bundleRef.current?.audioGraph
      if (!graph) return
      for (const [target, value] of Object.entries(values) as [string, number][]) {
        switch (target as AutomationTarget) {
          case 'masterFilter.freq': graph.setMasterFilter({ freq: value }); break
          case 'masterFilter.Q': graph.setMasterFilter({ Q: value }); break
          case 'master.gain': graph.setMasterGain(value); break
          case 'bus.drum.gain': graph.setBusGain('drum', value); break
          case 'bus.music.gain': graph.setBusGain('music', value); break
          case 'bus.atmos.gain': graph.setBusGain('atmos', value); break
          case 'bus.drum.saturation': graph.setBusSaturation('drum', value); break
          case 'bus.music.saturation': graph.setBusSaturation('music', value); break
          case 'bus.atmos.saturation': graph.setBusSaturation('atmos', value); break
        }
      }
    })
    director.setAutomationEnabled(next)
  }, [automationEnabled])

  const onAddAutomationPoint = React.useCallback((target: AutomationTarget, time: number, value: number) => {
    automationBankRef.current.addPoint(target, time, value)
    setAutomationDirty((d) => d + 1)
  }, [])

  const onClearAutomationTrack = React.useCallback((target: AutomationTarget) => {
    const bank = automationBankRef.current
    const track = bank.get(target)
    for (const p of track.points) bank.removePoint(target, p.time)
    setAutomationDirty((d) => d + 1)
  }, [])

  // ─── Sample audition ───────────────────────────────────────────────────────

  const auditionSample = React.useCallback((asset: SampleAsset) => {
    const ctx = ctxRef.current
    const graph = bundleRef.current?.audioGraph
    if (!ctx || !graph) return
    let source: AudioBufferSourceNode | null = null
    let gain: GainNode | null = null
    try {
      const cat = asset.metadata.category as SampleRole
      const busInput = graph.getBusInput(roleToBus(cat))
      source = ctx.createBufferSource()
      source.buffer = asset.audioBuffer
      gain = ctx.createGain()
      gain.gain.value = 0.7
      source.connect(gain)
      gain.connect(busInput)
      source.start()
      source.onended = () => {
        try { gain?.disconnect() } catch { /* */ }
      }
      setNowPlaying({ role: cat, sampleId: asset.metadata.id, at: Date.now() })
    } catch (err) {
      // FIX Bug 9: disconnect nodes on failure to prevent leak.
      try { gain?.disconnect() } catch { /* */ }
      try { source?.disconnect() } catch { /* */ }
      console.warn('[psy-sampler] Audition failed:', err)
    }
  }, [])

  // ─── Performance pads (live one-shot triggering) ──────────────────────────
  //
  // Pads publish a NoteEvent to the host — the SAME path the sequencer and
  // MIDI input use. This means pads go through the full realization chain:
  // velocity layers, round-robin, choke groups, per-bus EQ + saturation,
  // master filter, and the limiter. The device is the single source of truth.
  //
  // Velocity: 100 default, 127 accent (Shift), 50 ghost (Alt). These map to
  // the selector's velocity layers so high velocity pulls the harder sample.
  const triggerPad = React.useCallback((role: SampleRole, velocity = 100) => {
    const host = hostRef.current
    const ctx = ctxRef.current
    if (!host || !ctx) return
    const event = {
      type: 'note' as const,
      note: ROLE_NOTES[role] ?? 60,
      velocity: velocity / 127, // normalize 0..127 → 0..1 for the device
      duration: 0.4,
      channel: role,
      at: ctx.currentTime + 0.005, // 5ms lookahead for scheduling
    }
    host.publish(event)
    setNowPlaying({ role, sampleId: null, at: Date.now() })
  }, [])

  // Keyboard-shortcut entry: pad index 0-8 → role.
  const onPadTrigger = React.useCallback((index: number) => {
    const role = ROLES[index]
    if (role) triggerPad(role, 100)
  }, [triggerPad])

  // ─── Sample import (C2) ────────────────────────────────────────────────────

  const onImportSample = React.useCallback((asset: SampleAsset) => {
    const bundle = bundleRef.current
    if (!bundle) return
    // addFromBuffer enforces provenance — refuses if commercialUse=false or
    // license/source are empty. Double enforcement: UI already checks, but
    // the library is the final authority (defense in depth).
    const added = bundle.library.addFromBuffer(
      asset.metadata.id,
      asset.audioBuffer,
      {
        category: asset.metadata.category,
        subcategory: asset.metadata.subcategory,
        provenance: asset.metadata.provenance,
        rootNote: asset.metadata.character.rootNote,
        velocityRange: asset.metadata.velocityRange,
      }
    )
    if (added) {
      // Refresh the samples list so the imported sample appears in the UI.
      setSamples(bundle.library.list())
      toast({
        title: `Imported: ${asset.metadata.id}`,
        description: `${asset.metadata.category} · ${asset.metadata.provenance.license} · ${asset.audioBuffer.duration.toFixed(2)}s`,
      })
    } else {
      toast({
        title: 'Import refused',
        description: 'Provenance validation failed (missing license or non-commercial)',
        variant: 'destructive',
      })
    }
  }, [])

  /** Remove a sample from the library (user-initiated delete). */
  const onRemoveSample = React.useCallback((sampleId: string) => {
    const bundle = bundleRef.current
    if (!bundle) return
    const removed = bundle.library.remove(sampleId)
    if (removed) {
      setSamples(bundle.library.list())
      toast({ title: `Removed ${sampleId}`, description: 'Sample deleted from library' })
    }
  }, [])

  const busStateRef = React.useRef(busState)
  React.useEffect(() => { busStateRef.current = busState }, [busState])

  // Sync the director's pattern when undo/redo changes the pattern state.
  // This is needed because undo/redo bypass the director (they restore a
  // previous React state directly), so the director's internal pattern would
  // be stale. We detect this by comparing the director's pattern to the React
  // state and re-syncing when they differ.
  React.useEffect(() => {
    const director = directorRef.current
    if (!director) return
    const directorPattern = JSON.stringify(director.getPattern())
    const statePattern = JSON.stringify(pattern)
    if (directorPattern !== statePattern) {
      director.setPattern(structuredClone(pattern))
    }
  }, [pattern])

  const onBusGain = React.useCallback((name: BusName, value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusGain(name, value)
      const soloed = BUS_NAMES.filter((n) => busStateRef.current[n].solo)
      if (soloed.length > 0) graph.applySolo(soloed)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], gain: value } }))
  }, [])

  const onBusEQ = React.useCallback((name: BusName, band: 'low' | 'mid' | 'high', value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusEQ(name, { [band]: value })
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], [`eq${band.charAt(0).toUpperCase() + band.slice(1)}`]: value } }))
  }, [])

  const onBusSaturation = React.useCallback((name: BusName, value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusSaturation(name, value)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], saturation: value } }))
  }, [])

  const onBusMute = React.useCallback((name: BusName) => {
    const newMuted = !busStateRef.current[name].muted
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusMuted(name, newMuted)
      const soloed = BUS_NAMES.filter((n) => busStateRef.current[n].solo)
      if (soloed.length > 0) graph.applySolo(soloed)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], muted: newMuted } }))
  }, [])

  const onBusSolo = React.useCallback((name: BusName) => {
    const newSolo = !busStateRef.current[name].solo
    const next = { ...busStateRef.current, [name]: { ...busStateRef.current[name], solo: newSolo } }
    const soloed = BUS_NAMES.filter((n) => next[n].solo)
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      if (soloed.length > 0) {
        graph.applySolo(soloed)
      } else {
        BUS_NAMES.forEach((n) => graph.setBusGain(n, next[n].gain))
      }
    }
    setBusState(next)
  }, [])

  // ─── Pattern presets ───────────────────────────────────────────────────────

  const loadPreset = React.useCallback((preset: PatternPreset) => {
    const director = directorRef.current
    if (!director) return
    director.setBpm(preset.bpm)
    setBpm(preset.bpm)
    const cloned = structuredClone(preset.pattern)
    director.setPattern(cloned)
    director.clearNoteMap() // preset has its own rhythm — clear chord pitches
    setNoteMap({}); setLastProgression(null)
    resetPatternHistory(structuredClone(cloned))
    try {
      autosavePattern(cloned)
    } catch {
      // ignore
    }
    toast({ title: `Loaded ${preset.name} · ${preset.bpm} BPM` })
  }, [])

  /** Load a mixer preset (EQ + saturation + filter per genre). */
  const loadMixerPreset = React.useCallback((preset: MixerPreset) => {
    const graph = bundleRef.current?.audioGraph
    setBusState(preset.busState)
    setFilterMode(preset.filterMode)
    if (graph) {
      for (const busName of ['drum', 'music', 'atmos'] as const) {
        const bs = preset.busState[busName]
        graph.setBusGain(busName, bs.gain)
        graph.setBusMuted(busName, bs.muted)
        graph.setBusEQ(busName, { low: bs.eqLow, mid: bs.eqMid, high: bs.eqHigh })
        graph.setBusSaturation(busName, bs.saturation)
      }
      if (preset.filterMode === 'off') {
        graph.setMasterFilter({ type: 'allpass', freq: 20000, Q: 1 })
        graph.setFilterEnvelopeEnabled(false)
      } else if (preset.filterMode === 'lp') {
        graph.setMasterFilter({ type: 'lowpass', freq: 8000, Q: 2 })
        graph.setFilterEnvelopeEnabled(true)
        graph.setFilterEnvelopeParams(0.6, 0.25)
      } else {
        graph.setMasterFilter({ type: 'highpass', freq: 200, Q: 1.5 })
        graph.setFilterEnvelopeEnabled(false)
      }
    }
    toast({ title: `Mixer: ${preset.name}`, description: 'EQ + saturation + filter applied' })
  }, [])

  // ─── Pattern slots ─────────────────────────────────────────────────────────

  const saveToSlotN = React.useCallback((slot: number) => {
    const director = directorRef.current
    if (!director) return
    const name = `${presetNameFor(bpm, pattern)} · ${new Date().toLocaleTimeString()}`
    try {
      saveToSlot(slot, name, director.getPattern())
      refreshSlots()
    } catch (err) {
      console.warn('[psy-sampler] Save failed:', err)
    }
  }, [bpm, pattern, refreshSlots])

  const loadFromSlotN = React.useCallback((slot: number) => {
    const director = directorRef.current
    if (!director) return
    try {
      const data = loadFromSlot(slot)
      if (!data) return
      director.setPattern(data.pattern)
      resetPatternHistory(structuredClone(data.pattern))
      // Don't override BPM — let user keep their tempo, or use saved? Use saved for fidelity.
      // Actually: keep current BPM — preset loads BPM, slots don't.
    } catch (err) {
      console.warn('[psy-sampler] Load failed:', err)
    }
  }, [])

  const clearSlotN = React.useCallback((slot: number) => {
    try {
      clearSlot(slot)
      refreshSlots()
    } catch (err) {
      console.warn('[psy-sampler] Clear failed:', err)
    }
  }, [refreshSlots])

  // ─── WAV export (FIX Bug 7: don't kill user-started playback) ──────────────

  // ─── Live recording (capture live performance to WAV) ──────────────────────
  const toggleRecord = React.useCallback(async () => {
    const ctx = ctxRef.current
    const bundle = bundleRef.current
    if (!ctx || !bundle) return
    if (recording) {
      const recorder = recorderRef.current
      if (recorder) {
        try {
          const filename = `psy-sampler-live-${new Date().toISOString().replace(/[:.]/g, '-')}`
          await recorder.stop(filename)
          toast({ title: 'Recording saved', description: `${filename}.wav` })
        } catch (err) {
          toast({ title: 'Recording failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
        }
      }
      if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null }
      setRecording(false)
      setRecElapsed(0)
    } else {
      try {
        const recorder = new LiveRecorder({ ctx, sourceNode: bundle.audioGraph.master })
        recorder.start()
        recorderRef.current = recorder
        setRecording(true)
        setRecElapsed(0)
        recTimerRef.current = setInterval(() => { setRecElapsed(recorder.elapsedMs) }, 100)
        toast({ title: 'Recording started', description: 'Capturing live audio — stop to save' })
      } catch (err) {
        toast({ title: 'Recording failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
      }
    }
  }, [recording])

  // ─── Project save/load ─────────────────────────────────────────────────────
  const onSaveProject = React.useCallback(() => {
    const project = createProject(`psy-sampler-${new Date().toISOString().slice(0, 10)}`, {
      bpm, swing, masterVolume, section, energy, pattern, noteMap, musicalKey, scaleName, arpeggio, bassPattern, density, melodyOctave, bassOctave, busState,
      filterMode, pumpEnabled, evolveEnabled, song,
    })
    downloadProject(project)
    toast({ title: 'Project saved', description: `${project.name}.psy.json` })
  }, [bpm, swing, masterVolume, section, energy, pattern, noteMap, musicalKey, scaleName, arpeggio, bassPattern, density, melodyOctave, bassOctave, busState, filterMode, pumpEnabled, evolveEnabled, song])

  const onLoadProject = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const project = await readProjectFile(file)
      if (!project) { toast({ title: 'Load failed', description: 'Invalid project file', variant: 'destructive' }); return }
      setBpm(project.bpm); directorRef.current?.setBpm(project.bpm)
      setSwing(project.swing); directorRef.current?.setSwing(project.swing / 100)
      setMasterVolume(project.masterVolume); bundleRef.current?.audioGraph.setMasterGain(project.masterVolume)
      setSection(project.section); setEnergy(project.energy)
      // Restore musical key + scale (for chord progression).
      setMusicalKey(project.musicalKey ?? 9)
      setScaleName(project.scaleName ?? 'phrygianDominant')
      setArpeggio((project.arpeggio ?? 'up') as ArpeggioPattern)
      setBassPattern((project.bassPattern ?? 'root') as BassPattern)
      setDensity(project.density ?? 0.6)
      setMelodyOctave(project.melodyOctave ?? 0)
      setBassOctave(project.bassOctave ?? 0)
      directorRef.current?.setContext({
        key: NOTE_NAMES[project.musicalKey ?? 9],
        rootPc: project.musicalKey ?? 9,
        scale: project.scaleName ?? 'phrygianDominant',
      })
      resetPatternHistory(structuredClone(project.pattern))
      directorRef.current?.setPattern(structuredClone(project.pattern))
      // Restore pitch overrides (chord progression melody).
      const loadedNoteMap = project.noteMap ?? {}
      directorRef.current?.setNoteMap(loadedNoteMap)
      setNoteMap(loadedNoteMap); setLastProgression(null)
      setBusState(project.busState)
      const graph = bundleRef.current?.audioGraph
      if (graph) {
        for (const busName of ['drum', 'music', 'atmos'] as const) {
          const bs = project.busState[busName]
          graph.setBusGain(busName, bs.gain); graph.setBusMuted(busName, bs.muted)
          graph.setBusEQ(busName, { low: bs.eqLow, mid: bs.eqMid, high: bs.eqHigh })
          graph.setBusSaturation(busName, bs.saturation)
        }
      }
      setFilterMode(project.filterMode)
      setPumpEnabled(project.pumpEnabled); graph?.setSidechainEnabled(project.pumpEnabled)
      setEvolveEnabled(project.evolveEnabled); directorRef.current?.setEvolveEnabled(project.evolveEnabled)
      setSong(project.song); saveSong(project.song)
      toast({ title: `Loaded: ${project.name}`, description: `${project.bpm} BPM` })
    } catch (err) {
      toast({ title: 'Load failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
    }
  }, [resetPatternHistory])


  // ─── Stem export (each bus as separate WAV) ─────────────────────────────────
  const [stemExporting, setStemExporting] = React.useState(false)

  /** Export the current pattern as a Standard MIDI File (.mid). */
  const handleExportMidi = React.useCallback(() => {
    try {
      downloadMidiFile(pattern, bpm, stepCount, noteMap)
      toast({ title: 'MIDI exported', description: `${stepCount} steps · ${bpm} BPM · 9 channels · pitch-aware` })
    } catch (err) {
      toast({ title: 'MIDI export failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
    }
  }, [pattern, bpm, stepCount, noteMap])

  /** Import a .mid file into the pattern. */
  const midiFileInputRef = React.useRef<HTMLInputElement>(null)
  const [midiImporting, setMidiImporting] = React.useState(false)

  const handleImportMidi = React.useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setMidiImporting(true)
    try {
      const result = await readMidiFile(file)
      if (!result) {
        toast({ title: 'MIDI import failed', description: 'Invalid .mid file', variant: 'destructive' })
        return
      }
      // Apply the imported pattern + BPM + step count.
      directorRef.current?.setStepCount(result.stepCount)
      setStepCount(result.stepCount)
      directorRef.current?.setPattern(structuredClone(result.pattern))
      resetPatternHistory(structuredClone(result.pattern))
      // Apply imported pitch overrides (melody from the DAW).
      directorRef.current?.setNoteMap(result.noteMap)
      setNoteMap(result.noteMap); setLastProgression(null)
      setBpm(result.bpm)
      directorRef.current?.setBpm(result.bpm)
      toast({
        title: `Imported ${result.notesImported} notes`,
        description: `${result.stepCount} steps · ${result.bpm} BPM · ${file.name}`,
      })
    } catch (err) {
      toast({ title: 'MIDI import failed', description: err instanceof Error ? err.message : String(err), variant: 'destructive' })
    } finally {
      setMidiImporting(false)
    }
  }, [resetPatternHistory])

  const handleExportStems = React.useCallback(async () => {
    const ctx = ctxRef.current
    const bundle = bundleRef.current
    const director = directorRef.current
    if (!ctx || !bundle || !director) return
    setStemExporting(true)
    try {
      const bars = 4
      const secPerStep = 60 / bpm / 4
      const events: import('@/psy-foundation-shim').NoteEvent[] = []
      const roles = Object.keys(pattern) as SampleRole[]
      for (let bar = 0; bar < bars; bar++) {
        const barStart = bar * secPerStep * 16
        for (let step = 0; step < stepCount; step++) {
          const at = barStart + step * secPerStep
          for (const role of roles) {
            const vel = pattern[role]?.[step] ?? 0
            if (vel <= 0) continue
            events.push({
              type: 'note',
              note: ROLE_NOTES[role] ?? 60,
              velocity: vel / 127,
              duration: secPerStep * 0.9,
              channel: role,
              at,
            })
          }
        }
      }
      const durationSec = bars * secPerStep * stepCount + 1.0
      const transport = transportRef.current?.snapshot(ctx.currentTime)
      if (!transport) return
      const result = await exportStems({
        library: bundle.library,
        selectionPolicy: bundle.selectionPolicy,
        events,
        transport,
        durationSec,
        sampleRate: 44100,
        masterGain: masterVolume,
        voiceCount: 32,
        sidechain: {
          enabled: bundle.audioGraph.isSidechainEnabled,
          depth: bundle.audioGraph.sidechainDepthValue,
        },
        busEQ: {
          drum: { low: busState.drum.eqLow, mid: busState.drum.eqMid, high: busState.drum.eqHigh },
          music: { low: busState.music.eqLow, mid: busState.music.eqMid, high: busState.music.eqHigh },
          atmos: { low: busState.atmos.eqLow, mid: busState.atmos.eqMid, high: busState.atmos.eqHigh },
        },
        busSaturation: {
          drum: busState.drum.saturation,
          music: busState.music.saturation,
          atmos: busState.atmos.saturation,
        },
        baseFilename: `psy-sampler-stems-${bpm}bpm-${Date.now()}`,
      })
      toast({
        title: `Exported ${result.stems.length} stems in ${result.totalMs.toFixed(0)}ms`,
        description: result.stems.map((s) => `${s.bus} (${s.renderMs.toFixed(0)}ms)`).join(' · '),
      })
    } catch (err) {
      console.error('[psy-sampler] Stem export failed:', err)
      toast({
        title: 'Stem export failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setStemExporting(false)
    }
  }, [bpm, pattern, stepCount, masterVolume, busState])

  const handleExportWav = React.useCallback(async () => {
    const ctx = ctxRef.current
    const bundle = bundleRef.current
    const director = directorRef.current
    if (!ctx || !bundle || !director) return
    setExporting(true)
    try {
      // Generate NoteEvents from the current pattern for `bars` bars.
      // This mirrors what the DemoDirector would play live, but we render them
      // OFFLINE (faster than real-time, deterministic, no MediaRecorder).
      const bars = 4 // ~6.6s at 145 BPM — a full 4-bar loop
      const secPerStep = 60 / bpm / 4
      const events: import('@/psy-foundation-shim').NoteEvent[] = []
      const swingFactor = swing / 100 // director takes 0..0.7
      const roles = Object.keys(pattern) as SampleRole[]
      for (let bar = 0; bar < bars; bar++) {
        const barStart = bar * secPerStep * 16
        for (let step = 0; step < 16; step++) {
          const isOffbeat = step % 2 === 1
          const swingOffset = isOffbeat ? swingFactor * secPerStep * 0.5 : 0
          const at = barStart + step * secPerStep + swingOffset
          for (const role of roles) {
            const vel = pattern[role]?.[step] ?? 0
            if (vel <= 0) continue
            events.push({
              type: 'note',
              note: ROLE_NOTES[role] ?? 60,
              // Normalize MIDI velocity (0..127) to 0..1.
              velocity: vel / 127,
              duration: secPerStep * 0.9,
              channel: role,
              at,
            })
          }
        }
      }
      const durationSec = bars * secPerStep * 16 + 1.0 // +1s tail for reverb/decay
      const filename = `psy-sampler-${bpm}bpm-${bars}bar-${Date.now()}.wav`
      // Snapshot the transport (seed for deterministic selection).
      const transport = transportRef.current?.snapshot(ctx.currentTime)
      if (!transport) return
      const result = await renderOffline({
        library: bundle.library,
        selectionPolicy: bundle.selectionPolicy,
        events,
        transport,
        durationSec,
        sampleRate: 44100,
        masterGain: masterVolume,
        voiceCount: 32,
        sidechain: {
          enabled: bundle.audioGraph.isSidechainEnabled,
          depth: bundle.audioGraph.sidechainDepthValue,
        },
        busGains: {
          drum: busStateRef.current.drum.gain,
          music: busStateRef.current.music.gain,
          atmos: busStateRef.current.atmos.gain,
        },
        busEQ: {
          drum: { low: busStateRef.current.drum.eqLow, mid: busStateRef.current.drum.eqMid, high: busStateRef.current.drum.eqHigh },
          music: { low: busStateRef.current.music.eqLow, mid: busStateRef.current.music.eqMid, high: busStateRef.current.music.eqHigh },
          atmos: { low: busStateRef.current.atmos.eqLow, mid: busStateRef.current.atmos.eqMid, high: busStateRef.current.atmos.eqHigh },
        },
        busSaturation: {
          drum: busStateRef.current.drum.saturation,
          music: busStateRef.current.music.saturation,
          atmos: busStateRef.current.atmos.saturation,
        },
        masterFilter: filterMode !== 'off' ? {
          type: filterMode === 'lp' ? 'lowpass' : 'highpass',
          freq: filterMode === 'lp' ? 8000 : 200,
          Q: filterMode === 'lp' ? 2 : 1.5,
        } : undefined,
        filterEnvelope: filterMode === 'lp' ? { enabled: true, depth: 0.6, time: 0.25 } : undefined,
        filename,
        download: true,
      })
      toast({
        title: `Rendered ${result.eventsRealized} events in ${result.renderMs.toFixed(0)}ms`,
        description: `${bars} bars @ ${bpm} BPM · ${durationSec.toFixed(1)}s · deterministic WAV`,
      })
    } catch (err) {
      console.error('[psy-sampler] Offline WAV export failed:', err)
      toast({
        title: 'WAV export failed',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      })
    } finally {
      setExporting(false)
    }
  }, [bpm, swing, pattern, masterVolume, filterMode])

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onStop: stopPlayback,
    onUndo,
    onRedo,
    onTapTempo,
    onToggleHelp: () => setHelpOpen((o) => !o),
    onToggleMute: () => onBusMute('drum'),
    onToggleSolo: () => onBusSolo('drum'),
    onClearPattern,
    onCycleFilter: () => {
      const next = filterMode === 'off' ? 'lp' : filterMode === 'lp' ? 'hp' : 'off'
      setFilterMode(next)
      const graph = bundleRef.current?.audioGraph
      if (!graph) return
      if (next === 'off') { graph.setMasterFilter({ type: 'allpass', freq: 20000, Q: 1 }); graph.setFilterEnvelopeEnabled(false) }
      else if (next === 'lp') { graph.setMasterFilter({ type: 'lowpass', freq: 8000, Q: 2 }); graph.setFilterEnvelopeEnabled(true); graph.setFilterEnvelopeParams(0.6, 0.25) }
      else { graph.setMasterFilter({ type: 'highpass', freq: 200, Q: 1.5 }); graph.setFilterEnvelopeEnabled(false) }
    },
    onTogglePump: () => {
      const newState = !pumpEnabled
      setPumpEnabled(newState)
      bundleRef.current?.audioGraph.setSidechainEnabled(newState)
    },
    onToggleEvolve: () => {
      const newState = !evolveEnabled
      setEvolveEnabled(newState)
      directorRef.current?.setEvolveEnabled(newState)
    },
    onToggleRecord: toggleRecord,
    onPadTrigger,
    onGenerateChords: onGenerateChords,
    onCycleArpeggio: () => {
      const patterns: ArpeggioPattern[] = ['up', 'down', 'upDown', 'downUp', 'random', 'chordal']
      const idx = patterns.indexOf(arpeggio)
      const next = patterns[(idx + 1) % patterns.length]!
      setArpeggio(next)
      toast({ title: `Arpeggio: ${ARPEGGIO_LABELS[next]}`, description: 'A key cycles patterns' })
    },
    onCycleBass: () => {
      const patterns: BassPattern[] = ['root', 'walking', 'octave', 'pedal', 'arp']
      const idx = patterns.indexOf(bassPattern)
      const next = patterns[(idx + 1) % patterns.length]!
      setBassPattern(next)
      toast({ title: `Bass: ${BASS_LABELS[next]}`, description: 'B key cycles patterns' })
    },
    onHumanize: onHumanize,
    onQuantize: onQuantize,
    onRandomize: onRandomizePattern,
    onToggleMetronome: () => {
      const next = !metronomeEnabled
      setMetronomeEnabled(next)
      metronomeRef.current?.setEnabled(next)
    },
    enabled: initialized,
  })

  // ─── MIDI input (the #1 feature for a real production tool) ────────────────
  // When a MIDI note is received, we publish it to the DeviceHost just like
  // the DemoDirector does — but directly, bypassing the pattern grid. This
  // lets a producer play the sampler live from a MIDI keyboard.
  const midi = useMidiInput({
    enabled: initialized,
    onNoteOn: (note, velocity) => {
      const host = hostRef.current
      const ctx = ctxRef.current
      if (!host || !ctx) return
      const { role, pitched } = roleForNote(note)
      const event = {
        type: 'note' as const,
        note: pitched ? note : 60,
        velocity,
        duration: 0.3,
        channel: role,
        at: ctx.currentTime + 0.005, // 5ms lookahead for scheduling
      }
      host.publish(event)
      setNowPlaying({ role, sampleId: null, at: Date.now() })
    },
    onCC: (controller, value) => {
      // Map CC 1 (mod wheel) → master filter cutoff.
      // Map CC 7 (volume) → master gain.
      // This is a starting point — a real product would have MIDI learn.
      const graph = bundleRef.current?.audioGraph
      if (!graph) return
      if (controller === 1) {
        // Mod wheel → filter cutoff (200Hz..20000Hz, exponential).
        const freq = 200 * Math.pow(100, value / 127)
        graph.setMasterFilter({ type: value > 0 ? 'lowpass' : 'allpass', freq, Q: 2 })
        setFilterMode(value > 0 ? 'lp' : 'off')
      } else if (controller === 7) {
        // Volume CC → master gain (0..1.2).
        const gain = (value / 127) * 1.2
        graph.setMasterGain(gain)
        setMasterVolume(gain)
      }
    },
  })

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  // P1: Autosave FULL session state (transport + mixer + filter + toggles + probabilities).
  React.useEffect(() => {
    const state: SessionState = {
      bpm, swing, masterVolume, section, energy, busState,
      filterMode, pumpEnabled, evolveEnabled, stepCount, probabilities,
    }
    saveSessionState(state)
  }, [bpm, swing, masterVolume, section, energy, busState, filterMode, pumpEnabled, evolveEnabled, stepCount, probabilities])

  // Load saved session state on mount (before audio init).
  React.useEffect(() => {
    const saved = loadSessionState()
    if (saved) {
      queueMicrotask(() => {
        setBpm(saved.bpm)
        setSwing(saved.swing)
        setMasterVolume(saved.masterVolume)
        setSection(saved.section)
        setEnergy(saved.energy)
        setBusState(saved.busState as typeof busState)
        setFilterMode(saved.filterMode)
        setPumpEnabled(saved.pumpEnabled)
        setEvolveEnabled(saved.evolveEnabled)
        setStepCount(saved.stepCount)
        setProbabilities(saved.probabilities)
      })
    }
  }, [])

  React.useEffect(() => {
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
      directorRef.current?.stop()
      bundleRef.current?.dispose()
      hostRef.current?.dispose()
      ctxRef.current?.close().catch(() => {})
    }
  }, [])

  // Resume AudioContext when the tab becomes visible again.
  // Browsers suspend AudioContext when the tab is backgrounded — without this,
  // the user returns to the tab and playback is silent until they click PLAY.
  React.useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const ctx = ctxRef.current
        if (ctx && ctx.state === 'suspended') {
          ctx.resume().catch(() => {})
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // ─── Render: Init Overlay ──────────────────────────────────────────────────

  if (!initialized) {
    return (
      <ErrorBoundary>
        <InitOverlay
          onInit={initializeAudio}
          loadProgress={loadProgress}
          error={initError}
          initializing={initializing}
        />
      </ErrorBoundary>
    )
  }

  // ─── Render: Main UI ───────────────────────────────────────────────────────

  return (
    <ErrorBoundary>
      <div className="relative flex min-h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
        {/* Ambient gradient */}
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(60% 50% at 20% 20%, rgba(255,46,136,0.12), transparent 60%), radial-gradient(55% 45% at 80% 30%, rgba(185,103,255,0.12), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(0,255,200,0.08), transparent 60%)',
          }}
        />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6">
          {/* ─── Header ─── */}
          <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="font-mono text-2xl font-bold tracking-[0.15em]">
                  <span className="bg-gradient-to-r from-emerald-300 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                    PSY SAMPLER
                  </span>
                </h1>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  debug-first · realization device
                </p>
              </div>
              {/* Help button */}
              <button
                onClick={() => setHelpOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-600 bg-zinc-900 font-mono text-sm font-bold text-zinc-300 transition-all hover:border-emerald-400 hover:text-emerald-300"
                title="Help & shortcuts (?)"
              >
                ?
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Stat label="DEVICES" value={deviceCount} color="emerald" />
              <Stat label="SAMPLES" value={loadResult ? `${loadResult.loaded}/${loadResult.total}` : '—'} color="violet" />
              <Stat label="BPM" value={bpm} color="fuchsia" />
              <Stat label="VOICES" value={stats ? `${stats.activeVoices}/32` : '0/32'} color="amber" />
            </div>
          </header>

          {/* Help overlay */}
          <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

          {/* ─── Transport bar (3 rows: playback / FX / sliders) ─── */}
          <div className="mb-4 space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            {/* Row 1: Playback + Export + Record + Project */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button
              onClick={togglePlay}
              className="h-11 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
              variant={isPlaying ? 'destructive' : 'default'}
              style={
                isPlaying
                  ? { borderColor: 'rgba(255,46,136,0.5)', boxShadow: '0 0 16px rgba(255,46,136,0.4)' }
                  : { borderColor: 'rgba(0,255,200,0.5)', boxShadow: '0 0 16px rgba(0,255,200,0.4)' }
              }
            >
              {isPlaying ? '■ STOP' : '▶ PLAY'}
            </Button>

            {/* Row 3: Sliders (BPM + Swing + Master + Section + Energy) */}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 border-t border-zinc-800/50 pt-2">
            {/* BPM slider */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">BPM</span>
              <Slider value={[bpm]} onValueChange={(v) => onBpmChange(v[0]!)} min={100} max={180} step={1} className="w-28" />
              <span className="w-8 font-mono text-xs tabular-nums text-emerald-300">{bpm}</span>
            </div>

            {/* Swing slider */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">SWING</span>
              <Slider value={[swing]} onValueChange={(v) => onSwingChange(v[0]!)} min={0} max={70} step={1} className="w-24" />
              <span className="w-8 font-mono text-xs tabular-nums text-fuchsia-300">{swing}%</span>
            </div>

            {/* Master volume */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">MASTER</span>
              <Slider value={[masterVolume]} onValueChange={(v) => onMasterVolumeChange(v[0]!)} min={0} max={1} step={0.01} className="w-24" />
              <span className="w-8 font-mono text-xs tabular-nums text-violet-300">{masterVolume.toFixed(2)}</span>
            </div>

            {/* Section dropdown */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">SECTION</span>
              <select
                value={section}
                onChange={(e) => onSectionChange(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-fuchsia-300"
              >
                {SECTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Key selector — root pitch class (0-11 = C-B). Changes the
                director's context so CHORDS uses the new key. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">KEY</span>
              <select
                value={musicalKey}
                onChange={(e) => onKeyChange(parseInt(e.target.value, 10))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-emerald-300"
                title="Root key for chord progression (D = generate chords)"
              >
                {NOTE_NAMES.map((n, i) => (
                  <option key={n} value={i}>{n}</option>
                ))}
              </select>
            </div>

            {/* Scale selector — determines the diatonic chords CHORDS uses. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">SCALE</span>
              <select
                value={scaleName}
                onChange={(e) => onScaleChange(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-violet-300"
                title="Scale for chord progression (9 diatonic scales)"
              >
                {Object.entries(SCALE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Arpeggio pattern selector — controls the lead's melodic shape. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">ARP</span>
              <select
                value={arpeggio}
                onChange={(e) => setArpeggio(e.target.value as ArpeggioPattern)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-amber-300"
                title="Arpeggio pattern for lead (up/down/up-down/random/chordal)"
              >
                {Object.entries(ARPEGGIO_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Bass pattern selector — controls the bassline character. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">BASS</span>
              <select
                value={bassPattern}
                onChange={(e) => setBassPattern(e.target.value as BassPattern)}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-rose-300"
                title="Bass pattern (root/walking/octave/pedal/arp)"
              >
                {Object.entries(BASS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Lead density slider — controls how busy the melody is.
                0.2 = sparse (few notes), 0.6 = default, 1.0 = every 8th note. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">DENS</span>
              <Slider value={[density]} onValueChange={(v) => setDensity(v[0]!)} min={0.2} max={1} step={0.1} className="w-20" />
              <span className="w-8 font-mono text-xs tabular-nums text-cyan-300">{density.toFixed(1)}</span>
            </div>

            {/* Melody octave selector — shifts the lead register by whole octaves.
                -2 to +2. Lets the user match the melody to their sample's optimal register. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">OCT</span>
              <select
                value={melodyOctave}
                onChange={(e) => setMelodyOctave(parseInt(e.target.value, 10))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-lime-300"
                title="Melody octave offset (-2 to +2, shifts lead register)"
              >
                {[-2, -1, 0, 1, 2].map((oct) => (
                  <option key={oct} value={oct}>{oct > 0 ? `+${oct}` : oct}</option>
                ))}
              </select>
            </div>

            {/* Bass octave selector — shifts the bass register independently.
                -2 to +2. Lets the user match the bass to their sample's optimal register. */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">B.OCT</span>
              <select
                value={bassOctave}
                onChange={(e) => setBassOctave(parseInt(e.target.value, 10))}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-base sm:text-xs text-orange-300"
                title="Bass octave offset (-2 to +2, shifts bass register)"
              >
                {[-2, -1, 0, 1, 2].map((oct) => (
                  <option key={oct} value={oct}>{oct > 0 ? `+${oct}` : oct}</option>
                ))}
              </select>
            </div>

            {/* Energy slider */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">ENERGY</span>
              <Slider value={[energy]} onValueChange={(v) => onEnergyChange(v[0]!)} min={0} max={1} step={0.05} className="w-24" />
              <span className="w-8 font-mono text-xs tabular-nums text-amber-300">{energy.toFixed(2)}</span>
            </div>

            {/* WAV export */}
            <Button
              onClick={handleExportWav}
              disabled={exporting}
              className="h-11 gap-2 border border-violet-400/50 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-violet-300 hover:bg-violet-500/10 disabled:opacity-50"
              style={{ boxShadow: exporting ? '0 0 16px rgba(185,103,255,0.6)' : '0 0 8px rgba(185,103,255,0.2)' }}
            >
              {exporting ? '● EXPORTING…' : '⬇ EXPORT WAV'}
            </Button>

            {/* Stem export — each bus as separate WAV */}
            <Button
              onClick={handleExportStems}
              disabled={stemExporting}
              className="h-11 gap-2 border border-amber-400/50 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-amber-300 hover:bg-amber-500/10 disabled:opacity-50"
              style={{ boxShadow: stemExporting ? '0 0 16px rgba(251,191,36,0.6)' : 'none' }}
              title="Export stems — drum/music/atmos as separate WAVs"
            >
              {stemExporting ? '● STEMS…' : '⬇ STEMS'}
            </Button>

            {/* MIDI export — .mid file for DAWs */}
            <Button
              onClick={handleExportMidi}
              className="h-11 gap-2 border border-cyan-400/50 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-cyan-300 hover:bg-cyan-500/10"
              title="Export pattern as Standard MIDI File (.mid) for your DAW"
            >
              ⬇ MIDI
            </Button>

            {/* MIDI import — load .mid file */}
            <Button
              onClick={() => midiFileInputRef.current?.click()}
              disabled={midiImporting}
              className="h-11 gap-2 border border-cyan-400/50 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50"
              title="Import .mid file — extract pattern from a DAW"
            >
              {midiImporting ? '● LOADING…' : '⬆ MIDI'}
            </Button>
            <input
              ref={midiFileInputRef}
              type="file"
              accept=".mid,.midi,audio/midi"
              onChange={handleImportMidi}
              className="hidden"
            />

            {/* Metronome + Panic */}
            <Button
              onClick={() => {
                const next = !metronomeEnabled
                setMetronomeEnabled(next)
                metronomeRef.current?.setEnabled(next)
              }}
              className="h-11 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: metronomeEnabled ? 'rgba(251,191,36,0.6)' : 'rgba(63,63,70,0.8)',
                color: metronomeEnabled ? '#fbbf24' : '#71717a',
                backgroundColor: metronomeEnabled ? 'rgba(251,191,36,0.1)' : 'rgba(24,24,27,0.8)',
                boxShadow: metronomeEnabled ? '0 0 12px rgba(251,191,36,0.4)' : 'none',
              }}
              title="Metronome (N key) — click on every beat"
            >
              {metronomeEnabled ? '● MET' : '○ MET'}
            </Button>
            <Button
              onClick={() => {
                bundleRef.current?.voicePool.panic()
                bundleRef.current?.scheduler.stop()
                toast({ title: 'PANIC', description: 'All voices stopped' })
              }}
              className="h-11 gap-2 border border-red-500/50 bg-red-500/10 font-mono text-xs font-bold uppercase tracking-[0.15em] text-red-400 hover:bg-red-500/20"
              title="Panic — kill all audio immediately"
            >
              ⛔ PANIC
            </Button>

            {/* Live recording */}
            <Button
              onClick={toggleRecord}
              className="h-11 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: recording ? 'rgba(239,68,68,0.8)' : 'rgba(63,63,70,0.8)',
                color: recording ? '#ef4444' : '#71717a',
                background: recording ? 'rgba(239,68,68,0.15)' : 'rgba(24,24,27,0.8)',
                boxShadow: recording ? '0 0 16px rgba(239,68,68,0.6)' : 'none',
              }}
              title="Record live audio — captures whatever you play"
            >
              {recording ? `● REC ${(recElapsed / 1000).toFixed(1)}s` : '○ REC'}
            </Button>

            {/* Project save/load */}
            <Button
              onClick={onSaveProject}
              className="h-11 gap-2 border border-emerald-500/40 bg-emerald-500/10 font-mono text-xs font-bold uppercase tracking-[0.15em] text-emerald-300 hover:bg-emerald-500/20"
              title="Save project (.psy.json)"
            >
              💾 SAVE
            </Button>
            <Button
              onClick={() => projectFileInputRef.current?.click()}
              className="h-11 gap-2 border border-cyan-500/40 bg-cyan-500/10 font-mono text-xs font-bold uppercase tracking-[0.15em] text-cyan-300 hover:bg-cyan-500/20"
              title="Load project (.psy.json)"
            >
              📂 LOAD
            </Button>
            <input ref={projectFileInputRef} type="file" accept=".json,.psy.json,application/json" onChange={onLoadProject} className="hidden" />

            {/* Row 2: FX + Toggles + Undo/Redo + Tap + MIDI */}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 border-t border-zinc-800/50 pt-2">
            {/* PUMP (sidechain) toggle + EVOLVE toggle */}
            <Button
              onClick={() => {
                const newState = !pumpEnabled
                setPumpEnabled(newState)
                bundleRef.current?.audioGraph.setSidechainEnabled(newState)
              }}
              className="h-11 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: pumpEnabled ? 'rgba(0,255,200,0.6)' : 'rgba(63,63,70,0.8)',
                color: pumpEnabled ? '#00ffc8' : '#71717a',
                background: pumpEnabled ? 'rgba(0,255,200,0.1)' : 'rgba(24,24,27,0.8)',
                boxShadow: pumpEnabled ? '0 0 16px rgba(0,255,200,0.5)' : 'none',
              }}
              title="Sidechain ducking — kick ducks music+atmos"
            >
              {pumpEnabled ? '● PUMP' : '○ PUMP'}
            </Button>

            <Button
              onClick={() => {
                const newState = !evolveEnabled
                setEvolveEnabled(newState)
                directorRef.current?.setEvolveEnabled(newState)
              }}
              className="h-11 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: evolveEnabled ? 'rgba(255,46,136,0.6)' : 'rgba(63,63,70,0.8)',
                color: evolveEnabled ? '#ff2e88' : '#71717a',
                background: evolveEnabled ? 'rgba(255,46,136,0.1)' : 'rgba(24,24,27,0.8)',
                boxShadow: evolveEnabled ? '0 0 16px rgba(255,46,136,0.5)' : 'none',
              }}
              title="Auto-evolve — pattern mutates every 4 bars (deterministic)"
            >
              {evolveEnabled ? '● EVOLVE' : '○ EVOLVE'}
            </Button>

            <Button
              onClick={() => {
                const next = filterMode === 'off' ? 'lp' : filterMode === 'lp' ? 'hp' : 'off'
                setFilterMode(next)
                const graph = bundleRef.current?.audioGraph
                if (!graph) return
                if (next === 'off') {
                  graph.setMasterFilter({ type: 'allpass', freq: 20000, Q: 1 })
                  graph.setFilterEnvelopeEnabled(false)
                } else if (next === 'lp') {
                  graph.setMasterFilter({ type: 'lowpass', freq: 8000, Q: 2 })
                  graph.setFilterEnvelopeEnabled(true) // auto-wah on kick
                  graph.setFilterEnvelopeParams(0.6, 0.25)
                } else {
                  graph.setMasterFilter({ type: 'highpass', freq: 200, Q: 1.5 })
                  graph.setFilterEnvelopeEnabled(false)
                }
              }}
              className="h-11 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: filterMode !== 'off' ? 'rgba(96,165,250,0.6)' : 'rgba(63,63,70,0.8)',
                color: filterMode !== 'off' ? '#60a5fa' : '#71717a',
                background: filterMode !== 'off' ? 'rgba(96,165,250,0.1)' : 'rgba(24,24,27,0.8)',
                boxShadow: filterMode !== 'off' ? '0 0 16px rgba(96,165,250,0.5)' : 'none',
              }}
              title="Master filter — LP=lowpass+auto-wah, HP=highpass, OFF=bypass"
            >
              {filterMode === 'off' ? '○ FLT' : filterMode === 'lp' ? '● LP' : '● HP'}
            </Button>

            {/* Undo / Redo */}
            <Button
              onClick={onUndo}
              disabled={!canUndo}
              className="h-11 gap-2 border border-zinc-700 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-zinc-300 disabled:opacity-30"
              title="Undo (Ctrl+Z)"
            >
              ↶ UNDO
            </Button>
            <Button
              onClick={onRedo}
              disabled={!canRedo}
              className="h-11 gap-2 border border-zinc-700 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-zinc-300 disabled:opacity-30"
              title="Redo (Ctrl+Shift+Z)"
            >
              ↷ REDO
            </Button>

            {/* Tap tempo */}
            <Button
              onClick={onTapTempo}
              className="h-11 gap-2 border border-zinc-700 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-amber-300 hover:bg-amber-500/10"
              title="Tap tempo (T key) — tap repeatedly to detect BPM"
            >
              ⊡ TAP
            </Button>

            {/* MIDI input selector */}
            {midi.supported ? (
              <select
                value={midi.selectedInputId ?? ''}
                onChange={(e) => midi.selectInput(e.target.value || null)}
                disabled={!midi.accessGranted}
                className="h-11 min-w-[140px] rounded border border-zinc-700 bg-zinc-900 px-2 font-mono text-xs text-zinc-300 disabled:opacity-50"
                title={midi.error || 'Select MIDI input device'}
              >
                <option value="">{midi.accessGranted ? '🔇 MIDI: none' : 'MIDI…'}</option>
                {midi.inputs.map((input) => (
                  <option key={input.id} value={input.id}>
                    🎹 {input.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-[10px] text-zinc-600" title={midi.error || 'Web MIDI not supported'}>
                no MIDI
              </span>
            )}
            {midi.lastNote !== null && (
              <span className="font-mono text-[10px] text-emerald-300" title={`Last MIDI note: ${midi.lastNote} (vel ${(midi.lastVelocity ?? 0).toFixed(2)})`}>
                ♪{midi.lastNote}
              </span>
            )}
            </div>{/* end Row 2 */}
          </div>

          {/* ─── Harmonic status bar — shows the current harmonic structure ─── */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              ▌HARMONY
            </span>
            <span className="font-mono text-xs font-bold text-emerald-300">
              {NOTE_NAMES[musicalKey]} {SCALE_LABELS[scaleName]}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-xs text-amber-300">
              {ARPEGGIO_LABELS[arpeggio]}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-xs text-rose-300">
              {BASS_LABELS[bassPattern]}
            </span>
            {lastProgression && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="font-mono text-xs font-bold text-violet-300" title="Current chord progression">
                  {lastProgression.label}
                </span>
                <span className="font-mono text-[10px] text-zinc-500" title="Roman numeral analysis">
                  ({lastProgression.roman})
                </span>
              </>
            )}
          </div>

          {/* ─── Main grid: pattern editor (left) + debug (right) ─── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <PatternEditor
              pattern={pattern}
              currentStep={currentStep}
              stepCount={stepCount}
              probabilities={probabilities}
              onToggle={onToggleStep}
              onPaint={onPaintStep}
              onStepCountChange={onStepCountChange}
              onSetProbability={onSetProbability}
              onCopyRole={onCopyRole}
              onPasteRole={onPasteRole}
              onRandomize={onRandomizePattern}
              onChords={onGenerateChords}
              onHumanize={onHumanize}
              onQuantize={onQuantize}
              onRampUp={onRampUp}
              onRampDown={onRampDown}
              onScaleUp={onScaleUp}
              onScaleDown={onScaleDown}
              noteMap={noteMap}
              onFillRole={onFillRole}
              onDouble={onDoublePattern}
              onHalf={onHalfPattern}
              nowPlayingRole={nowPlaying.role}
              nowPlayingAt={nowPlaying.at}
              onClearPattern={onClearPattern}
            />
            {stats && <DebugPanel stats={stats} eventLog={eventLog} />}
          </div>

          {/* ─── Mixer + Presets + Slots ─── */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Mixer busState={busState} onGain={onBusGain} onEQ={onBusEQ} onSaturation={onBusSaturation} onMute={onBusMute} onSolo={onBusSolo} />
            <PresetsPanel onLoad={loadPreset} onLoadMixer={loadMixerPreset} />
            <PatternSlots
              slotNames={slotNames}
              onSave={saveToSlotN}
              onLoad={loadFromSlotN}
              onClear={clearSlotN}
            />
          </div>

          {/* ─── Performance Pads (live one-shot triggering) ─── */}
          <div className="mt-4">
            <PerformancePads
              onTrigger={triggerPad}
              nowPlayingRole={nowPlaying.role}
              nowPlayingAt={nowPlaying.at}
              disabled={!initialized}
            />
          </div>

          {/* ─── Timeline + Song Editor + Automation ─── */}
          <div className="mt-4 space-y-4">
            <TimelineView
              song={song}
              songMode={songMode}
              currentSegment={songSegment}
              currentBar={songBar}
              bpm={bpm}
            />
            <SongEditor
              song={song}
              slotNames={slotNames}
              songMode={songMode}
              currentSegment={songSegment}
              currentBar={songBar}
              onChange={onSongChange}
              onToggleSongMode={onToggleSongMode}
            />
            <AutomationEditor
              bank={automationBank}
              dirty={automationDirty}
              enabled={automationEnabled}
              onToggle={onToggleAutomation}
              onAddPoint={onAddAutomationPoint}
              onClearTrack={onClearAutomationTrack}
            />
          </div>

          {/* ─── Library + Importer + Visualizer ─── */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <SampleLibrary
                samples={samples}
                onAudition={auditionSample}
                onRemove={onRemoveSample}
                nowPlayingSampleId={nowPlaying.sampleId}
                nowPlayingAt={nowPlaying.at}
              />
              <SampleImporter
                audioContext={audioCtx}
                onImport={onImportSample}
              />
            </div>
            <Visualizer analyser={analyser} isPlaying={isPlaying} />
          </div>

          {/* ─── Footer (sticky) ─── */}
          <footer className="mt-auto border-t border-zinc-800 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-zinc-500">
              <span>PSY Sampler Device — canonical family member · debug-first UI</span>
              <span>
                {loadResult
                  ? `${loadResult.loaded} samples · all PROCEDURAL · all commercially usable`
                  : 'loading…'}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </ErrorBoundary>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a human-friendly slot name from current BPM + active steps. */
function presetNameFor(bpm: number, pattern: Pattern): string {
  const activeSteps = Object.values(pattern).reduce((acc, row) => acc + row.filter(Boolean).length, 0)
  return `${bpm}bpm · ${activeSteps} steps`
}
