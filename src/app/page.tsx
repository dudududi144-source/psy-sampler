'use client'

// PSY Sampler — FULL UI (control surface + mixer + recorder).
//
// This UI is a CONTROL SURFACE, not a source of truth.
// The DemoDirector owns the pattern; the UI projects device state.
//
// All 13 P0+P1 features:
//  1.  InitOverlay with loading progress + error message
//  2.  ErrorBoundary wrapping everything
//  3.  Keyboard shortcuts (Space=play/stop, Escape=stop)
//  4.  Transport bar (PLAY/STOP, BPM, Swing, Master Vol, Section, Energy)
//  5.  Pattern editor (9×16 with current step + now-playing row highlight)
//  6.  Sample library (audition, waveform thumbnail, COMMERCIAL badge, highlight)
//  7.  Performance pads (live one-shot triggering)
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
  type VoiceFXOptions,
  parseChannel,
  roleToBus,
} from '@/psy-sampler'
import {
  DeviceHost,
  InMemoryChannel,
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
import { safeDisconnect } from '@/lib/safe-disconnect'
import { createProject, downloadProject, readProjectFile, type ProjectState } from '@/lib/project-persistence'
import { LiveRecorder } from '@/lib/live-recorder'
import { AutomationBank, type AutomationTarget } from '@/lib/automation'
import { renderOffline } from '@/lib/offline-render'
import { exportStems } from '@/lib/stem-export'
import { downloadMidiFile } from '@/lib/midi-export'
import { readMidiFile } from '@/lib/midi-import'
import { Button } from '@/components/ui/button'
import { PsyKnob } from '@/components/psy-knob'
import { PsyCycleButton } from '@/components/psy-cycle-button'
import { PsyOled } from '@/components/psy-oled'
import { ErrorBoundary } from '@/components/error-boundary'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'
import { useUndoRedo } from '@/lib/use-undo-redo'
import { useMidiInput, roleForNote } from '@/lib/use-midi-input'
import { MIXER_PRESETS, type MixerPreset } from '@/lib/mixer-presets'
import { Metronome } from '@/lib/metronome'
import { generateChordPattern, NOTE_NAMES, SCALE_LABELS, ARPEGGIO_LABELS, BASS_LABELS, type ArpeggioPattern, type BassPattern } from '@/lib/chord-progression'
import { humanizePattern, quantizePattern, rampPattern, scalePattern } from '@/lib/humanize'
import { TimelineView } from '@/components/timeline-view'
import { AutomationEditor } from '@/components/automation-editor'
import { HelpOverlay } from '@/components/help-overlay'
import { toast } from '@/hooks/use-toast'
import { usePatternOps } from '@/hooks/use-pattern-ops'
import { useMixerOps } from '@/hooks/use-mixer-ops'
import { InitOverlay } from '@/components/init-overlay'
import { PatternEditor } from '@/components/pattern-editor'
import { SampleLibrary } from '@/components/sample-library'
import { SampleImporter } from '@/components/sample-importer'
import { RoleFxPanel } from '@/components/role-fx-panel'
import { SongEditor } from '@/components/song-editor'
import { Visualizer } from '@/components/visualizer'
import { Mixer } from '@/components/mixer'
import { PresetsPanel, PatternSlots } from '@/components/presets-panel'
import { PerformancePads } from '@/components/performance-pads'
import { Chassis } from '@/components/chassis'
import {
  ROLES,
  BUS_NAMES,
  SECTIONS,
  type LoadProgress,
  type BusMixerState,
} from '@/components/types'

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
  // Arpeggio pattern for the chord progression lead. Default 'up' (rootto3rdto5thtooctave).
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
  // NOTE: pattern, noteMap, lastProgression + all pattern-op callbacks live in
  // usePatternOps() below (declared after directorRef so the hook can use it).
  const [samples, setSamples] = React.useState<SampleAsset[]>([])
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)
  const [audioCtx, setAudioCtx] = React.useState<AudioContext | null>(null)
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
  // filterMode moved into useMixerOps() below
  // ─── Pattern length (8/16/32 steps) ─────────────────────────────────────────
  // stepCount moved into usePatternOps() below
  // ─── Help overlay ───────────────────────────────────────────────────────────
  const [helpOpen, setHelpOpen] = React.useState(false)
  // ─── Metronome ──────────────────────────────────────────────────────────────
  const [metronomeEnabled, setMetronomeEnabled] = React.useState(false)
  const metronomeRef = React.useRef<Metronome | null>(null)
  // probabilities moved into usePatternOps() below

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
  // busState + filterMode + all mixer callbacks live in useMixerOps() below.

  const ctxRef = React.useRef<AudioContext | null>(null)
  const bundleRef = React.useRef<SamplerBundle | null>(null)
  const hostRef = React.useRef<DeviceHost | null>(null)
  const directorRef = React.useRef<DemoDirector | null>(null)
  const transportRef = React.useRef<DemoTransport | null>(null)
  const statsIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const lastEventAtRef = React.useRef<number>(-1) // tracks dev.lastEvent.at to dedup
  const initializingRef = React.useRef(false)

  // ─── Pattern ops hook (owns pattern + stepCount + probabilities + noteMap +
  // lastProgression + mutedRoles + soloedRoles + 24 callbacks). Declared AFTER
  // directorRef so the hook can use it; declared AFTER the chord params so the
  // hook can use them. ────────────────────────────────────────────────────────
  const {
    pattern,
    stepCount,
    probabilities,
    noteMap,
    lastProgression,
    mutedRoles,
    soloedRoles,
    canUndo,
    canRedo,
    setNoteMap,
    setLastProgression,
    setPatternWithHistory,
    resetPatternHistory,
    setStepCount,
    setProbabilities,
    onStepCountChange,
    onSetProbability,
    onToggleStep,
    onPaintStep,
    onClearPattern,
    onRandomizePattern,
    onFillRole,
    onGenerateChords,
    onHumanize,
    onQuantize,
    onRampUp,
    onRampDown,
    onScaleUp,
    onScaleDown,
    onDoublePattern,
    onHalfPattern,
    onCopyRole,
    onPasteRole,
    onToggleMute,
    onToggleSolo,
    onUndo,
    onRedo,
    loadPattern: loadPatternIntoDirector,
  } = usePatternOps({
    directorRef,
    arpeggio,
    bassPattern,
    density,
    melodyOctave,
    bassOctave,
  })

  // Refresh slot names from localStorage.
  const refreshSlots = React.useCallback(() => {
    try {
      setSlotNames(getSlotNames())
    } catch (err) {
      console.warn('[psy-sampler] Failed to read slot names:', err)
    }
  }, [])

  // ─── Mixer ops hook (owns busState + filterMode + 6 bus callbacks +
  // loadMixerPreset + resetMixer). Declared AFTER bundleRef so the hook can
  // access the audioGraph. ───────────────────────────────────────────────────
  const {
    busState,
    busStateRef,
    filterMode,
    setBusState,
    setFilterMode,
    onBusGain,
    onBusEQ,
    onBusSaturation,
    onBusMute,
    onBusSolo,
    loadMixerPreset,
    resetMixer,
  } = useMixerOps({ bundleRef })

  // ─── Per-role FX state (Phase 1.6.2) ─────────────────────────────────────
  // Mirror of device.perRoleFx — kept in React state so the RoleFxPanel
  // re-renders when the user changes a slider. The device is the source of
  // truth for audio; this state is the UI mirror.
  const [roleFxState, setRoleFxState] = React.useState<Partial<Record<SampleRole, VoiceFXOptions>>>({})

  const onRoleFxChange = React.useCallback((role: SampleRole, fx: VoiceFXOptions | null) => {
    const device = bundleRef.current?.device
    if (device) {
      device.setRoleFx(role, fx)
    }
    setRoleFxState((prev) => {
      const next = { ...prev }
      if (fx === null) {
        delete next[role]
      } else {
        next[role] = fx
      }
      return next
    })
  }, [bundleRef])

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

      // Sampler device (standalone — outputNode null to connects to ctx.destination)
      bundle = createSamplerDevice({
        audioContext: ctx,
        manifestUrl: 'samples/manifest.json',
        onLoaded: (result) => setLoadResult(result),
        onProgress: (loaded, total) => setLoadProgress({ loaded, total }),
      })
      bundleRef.current = bundle
      setAnalyser(bundle.audioGraph.analyser)

      // Register the sampler device on the host.
      host.register(bundle.device)

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

      // Poll the device's last event to drive "now playing" highlights in the UI.
      statsIntervalRef.current = setInterval(() => {
        const dev = bundle!.device
        const lastEv = dev.lastEvent
        // Dedup by eventsReceived counter (not .at — multiple roles share the same .at).
        if (lastEv && dev.eventsReceived !== lastEventAtRef.current) {
          lastEventAtRef.current = dev.eventsReceived
          const role = parseChannel(lastEv.channel).role
          setNowPlaying({ role, sampleId: lastEv.sampleId ?? null, at: Date.now() })
        }
      }, 100)

      // Refresh slot names from localStorage.
      refreshSlots()

      setInitialized(true)
    } catch (err) {
      console.error('[psy-sampler] initializeAudio failed:', err)
      const message = err instanceof Error ? err.message : String(err)
      setInitError('Could not start the audio engine. Please refresh and try again.')
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
  // last few taps and compute the average interval to BPM. Requires at least 2
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
    // Slider is 0..70 (%) to director takes 0..0.7.
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

  /** Change the scale (e.g. phrygianDominant to minor). Updates the director's
   * context so the next CHORDS generation uses the new scale's diatonic chords. */
  const onScaleChange = React.useCallback((scale: string) => {
    setScaleName(scale)
    directorRef.current?.setContext({ scale })
  }, [])

  // ─── Pattern operations moved to usePatternOps() hook ──────────────────────
  // (onToggleStep, onPaintStep, onClearPattern, onRandomizePattern, onFillRole,
  //  onGenerateChords, onHumanize, onQuantize, onRampUp, onRampDown, onScaleUp,
  //  onScaleDown, onDoublePattern, onHalfPattern, onUndo, onRedo)
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
        safeDisconnect(gain)
      }
      setNowPlaying({ role: cat, sampleId: asset.metadata.id, at: Date.now() })
    } catch (err) {
      // FIX Bug 9: disconnect nodes on failure to prevent leak.
      safeDisconnect(gain)
      safeDisconnect(source)
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
      velocity: velocity / 127, // normalize 0..127 to 0..1 for the device
      duration: 0.4,
      channel: role,
      at: ctx.currentTime + 0.005, // 5ms lookahead for scheduling
    }
    host.publish(event)
    setNowPlaying({ role, sampleId: null, at: Date.now() })
  }, [])

  // Keyboard-shortcut entry: pad index 0-8 to role.
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

  /** Reconstruct a pattern from sliced loop timing. Called by SampleSlicer
   *  when the user clicks RECONSTRUCT PATTERN. Maps each slice to a step
   *  index based on its onset time + detected BPM, then writes the new
   *  pattern into the director + history + autosave. */
  const onReconstructPattern = React.useCallback((reconstruction: {
    bpm: number
    placements: Record<string, Array<{ step: number; sliceIdx: number }>>
  }) => {
    const director = directorRef.current
    if (!director) return
    // Build a new empty pattern (current step count).
    const stepCount = director.stepCount
    const emptyRow = () => new Array(stepCount).fill(0)
    const newPattern: Pattern = {
      kick: emptyRow(),
      bass: emptyRow(),
      lead: emptyRow(),
      'hat-closed': emptyRow(),
      'hat-open': emptyRow(),
      clap: emptyRow(),
      perc: emptyRow(),
      texture: emptyRow(),
      fx: emptyRow(),
    }
    // Apply each placement: set velocity to 100 (default).
    for (const [role, placements] of Object.entries(reconstruction.placements)) {
      const row = newPattern[role as SampleRole]
      if (!row) continue
      for (const { step } of placements) {
        if (step >= 0 && step < stepCount) row[step] = 100
      }
    }
    director.setPattern(newPattern)
    director.clearNoteMap()
    setNoteMap({})
    setLastProgression(null)
    setPatternWithHistory(structuredClone(newPattern))
    autosavePattern(newPattern)
    // Apply detected BPM if it's reasonable.
    if (reconstruction.bpm > 60 && reconstruction.bpm < 200) {
      const bpmInt = Math.round(reconstruction.bpm)
      director.setBpm(bpmInt)
      setBpm(bpmInt)
      toast({
        title: `Reconstructed · ${bpmInt} BPM`,
        description: `${Object.keys(reconstruction.placements).length} roles placed in pattern`,
      })
    } else {
      toast({
        title: 'Pattern reconstructed',
        description: `${Object.keys(reconstruction.placements).length} roles placed (BPM unknown)`,
      })
    }
  }, [directorRef, setNoteMap, setLastProgression, setPatternWithHistory])

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

  // loadMixerPreset moved to useMixerOps() hook

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
  }, [pattern, directorRef])

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
        description: `${bars} bars @ ${bpm} BPM · ${durationSec.toFixed(1)}s`,
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
      // Map CC 1 (mod wheel) to master filter cutoff.
      // Map CC 7 (volume) to master gain.
      // This is a starting point — a real product would have MIDI learn.
      const graph = bundleRef.current?.audioGraph
      if (!graph) return
      if (controller === 1) {
        // Mod wheel to filter cutoff (200Hz..20000Hz, exponential).
        const freq = 200 * Math.pow(100, value / 127)
        graph.setMasterFilter({ type: value > 0 ? 'lowpass' : 'allpass', freq, Q: 2 })
        setFilterMode(value > 0 ? 'lp' : 'off')
      } else if (controller === 7) {
        // Volume CC to master gain (0..1.2).
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
      <Chassis>
        <div className="relative z-10 flex w-full flex-1 flex-col">
          {/* ─── Transport Bar (topbar) ─── */}

          {/* Help overlay */}
          <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />

          {/* ─── Transport bar (3 rows: playback / FX / sliders) ─── */}
          <div className="topbar" style={{ marginBottom: '18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Row 1: Playback + Export + Record + Project */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button
              onClick={togglePlay}
              className="tbtn power h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
              variant={isPlaying ? 'destructive' : 'default'}
              style={
                isPlaying
                  ? { borderColor: 'rgba(255,46,136,0.5)', boxShadow: '0 0 16px rgba(255,46,136,0.4)' }
                  : { borderColor: 'rgba(0,255,200,0.5)', boxShadow: '0 0 16px rgba(0,255,200,0.4)' }
              }
            >
              {isPlaying ? 'STOP' : 'PLAY'}
            </Button>

            {/* OLED display — real-time audio waveform + harmonic info */}
            <PsyOled
              analyser={analyser}
              active={isPlaying}
              name={`${bpm} BPM · ${NOTE_NAMES[musicalKey]} ${SCALE_LABELS[scaleName]}`}
              meta={lastProgression ? lastProgression.label : `${stepCount} steps`}
              style={{ flex: 1, minWidth: '300px', marginBottom: '4px' }}
            />

            {/* Grouped File/Export buttons */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {/* WAV export */}
              <Button
                onClick={handleExportWav}
                disabled={exporting}
                className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em] disabled:opacity-50"
                style={{ boxShadow: exporting ? '0 0 16px rgba(185,103,255,0.6)' : '0 0 8px rgba(185,103,255,0.2)' }}
              >
                {exporting ? 'EXPORTING…' : 'EXPORT WAV'}
              </Button>

              {/* Stem export — each bus as separate WAV */}
              <Button
                onClick={handleExportStems}
                disabled={stemExporting}
                className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em] disabled:opacity-50"
                style={{ boxShadow: stemExporting ? '0 0 16px rgba(251,191,36,0.6)' : 'none' }}
                title="Export stems — drum/music/atmos as separate WAVs"
              >
                {stemExporting ? 'STEMS…' : 'STEMS'}
              </Button>

              {/* MIDI export — .mid file for DAWs */}
              <Button
                onClick={handleExportMidi}
                className="tbtn midi h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
                title="Export pattern as Standard MIDI File (.mid) for your DAW"
              >
                MIDI OUT
              </Button>

              {/* MIDI import — load .mid file */}
              <Button
                onClick={() => midiFileInputRef.current?.click()}
                disabled={midiImporting}
                className="tbtn midi h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em] disabled:opacity-50"
                title="Import .mid file — extract pattern from a DAW"
              >
                {midiImporting ? 'LOADING…' : 'MIDI IN'}
              </Button>
              <input
                ref={midiFileInputRef}
                type="file"
                accept=".mid,.midi,audio/midi"
                onChange={handleImportMidi}
                className="hidden"
              />

              {/* Project save/load */}
              <Button
                onClick={onSaveProject}
                className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
                title="Save project (.psy.json)"
              >
                SAVE
              </Button>
              <Button
                onClick={() => projectFileInputRef.current?.click()}
                className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
                title="Load project (.psy.json)"
              >
                LOAD
              </Button>
              <input ref={projectFileInputRef} type="file" accept=".json,.psy.json,application/json" onChange={onLoadProject} className="hidden" />
            </div>

            {/* Metronome + Panic */}
            <Button
              onClick={() => {
                const next = !metronomeEnabled
                setMetronomeEnabled(next)
                metronomeRef.current?.setEnabled(next)
              }}
              className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: metronomeEnabled ? 'rgba(251,191,36,0.6)' : 'rgba(63,63,70,0.8)',
                color: metronomeEnabled ? '#fbbf24' : '#71717a',
                backgroundColor: metronomeEnabled ? 'rgba(251,191,36,0.1)' : 'rgba(24,24,27,0.8)',
                boxShadow: metronomeEnabled ? '0 0 12px rgba(251,191,36,0.4)' : 'none',
              }}
              title="Metronome (N key) — click on every beat"
            >
              MET
            </Button>
            <Button
              onClick={() => {
                bundleRef.current?.voicePool.panic()
                bundleRef.current?.scheduler.stop()
                toast({ title: 'PANIC', description: 'All voices stopped' })
              }}
              className="tbtn panic h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
              title="Panic — kill all audio immediately"
            >
              PANIC
            </Button>

            {/* Live recording */}
            <Button
              onClick={toggleRecord}
              className="tbtn rec h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
              style={{
                borderColor: recording ? 'rgba(239,68,68,0.8)' : 'rgba(63,63,70,0.8)',
                color: recording ? '#ef4444' : '#71717a',
                background: recording ? 'rgba(239,68,68,0.15)' : 'rgba(24,24,27,0.8)',
                boxShadow: recording ? '0 0 16px rgba(239,68,68,0.6)' : 'none',
              }}
              title="Record live audio — captures whatever you play"
            >
              {recording ? `REC ${(recElapsed / 1000).toFixed(1)}s` : 'REC'}
            </Button>

            {/* Row 3: Sliders (BPM + Swing + Master + Section + Energy) */}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 border-t pt-2" style={{ borderColor: '#232932' }}>
            {/* BPM knob */}
            <PsyKnob
              value={bpm}
              min={60}
              max={200}
              def={145}
              step={1}
              color="#fbbf24"
              label="BPM"
              fmt={v => `${Math.round(v)}`}
              onChange={onBpmChange}
            />

            {/* Swing knob */}
            <PsyKnob
              value={swing}
              min={0}
              max={100}
              def={0}
              step={1}
              color="#b8e05a"
              label="SWING"
              fmt={v => `${Math.round(v)}%`}
              onChange={onSwingChange}
            />

            {/* Master volume */}
            <PsyKnob
              value={masterVolume}
              min={0}
              max={1}
              def={0.85}
              step={0.01}
              color="#4dd6e8"
              label="MASTER"
              fmt={v => v.toFixed(2)}
              onChange={onMasterVolumeChange}
            />

            {/* Row 2: Edit + Tap + MIDI + Help */}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 border-t pt-2" style={{ borderColor: '#232932' }}>
            {/* Undo / Redo */}
            <Button
              onClick={onUndo}
              disabled={!canUndo}
              className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em] disabled:opacity-30"
              title="Undo (Ctrl+Z)"
            >
              UNDO
            </Button>
            <Button
              onClick={onRedo}
              disabled={!canRedo}
              className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em] disabled:opacity-30"
              title="Redo (Ctrl+Shift+Z)"
            >
              REDO
            </Button>

            {/* Tap tempo */}
            <Button
              onClick={onTapTempo}
              className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
              title="Tap tempo (T key) — tap repeatedly to detect BPM"
            >
              TAP
            </Button>

            {/* Help button — visible so features are discoverable */}
            <Button
              onClick={() => setHelpOpen(true)}
              className="tbtn h-11 gap-2 font-mono text-xs font-bold uppercase tracking-[0.15em]"
              title="Help & keyboard shortcuts (Shift+/)"
              style={{ marginLeft: 'auto', color: '#86f7ff' }}
            >
              HELP
            </Button>

            {/* MIDI input selector */}
            {midi.supported ? (
              <select
                value={midi.selectedInputId ?? ''}
                onChange={(e) => midi.selectInput(e.target.value || null)}
                disabled={!midi.accessGranted}
                className="h-11 min-w-[140px] rounded border px-2 font-mono text-xs disabled:opacity-50"
                style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
                title={midi.error || 'Select MIDI input device'}
              >
                <option value="">{midi.accessGranted ? 'MIDI: NONE' : 'MIDI…'}</option>
                {midi.inputs.map((input) => (
                  <option key={input.id} value={input.id}>
                    {input.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-mono text-[10px]" style={{ color: '#5b6470' }} title={midi.error || 'Web MIDI not supported'}>
                no MIDI
              </span>
            )}
            {midi.lastNote !== null && (
              <span className="font-mono text-[10px]" style={{ color: '#86f7ff' }} title={`Last MIDI note: ${midi.lastNote} (vel ${(midi.lastVelocity ?? 0).toFixed(2)})`}>
                {midi.lastNote}
              </span>
            )}
            </div>{/* end Row 2 */}
          </div>

          {/* ─── Harmonic status bar — shows the current harmonic structure ─── */}
          <div className="oled flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: '#5b6470' }}>
              HARMONY
            </span>
            <span className="font-mono text-xs font-bold" style={{ color: '#86f7ff' }}>
              {NOTE_NAMES[musicalKey]} {SCALE_LABELS[scaleName]}
            </span>
            <span style={{ color: '#5b6470' }}>·</span>
            <span className="font-mono text-xs" style={{ color: '#fbbf24' }}>
              {ARPEGGIO_LABELS[arpeggio]}
            </span>
            <span style={{ color: '#5b6470' }}>·</span>
            <span className="font-mono text-xs" style={{ color: '#f85149' }}>
              {BASS_LABELS[bassPattern]}
            </span>
            {lastProgression && (
              <>
                <span style={{ color: '#5b6470' }}>·</span>
                <span className="font-mono text-xs font-bold" style={{ color: '#c084fc' }} title="Current chord progression">
                  {lastProgression.label}
                </span>
                <span className="font-mono text-[10px]" style={{ color: '#5b6470' }} title="Roman numeral analysis">
                  ({lastProgression.roman})
                </span>
              </>
            )}
          </div>

          {/* ─── Harmony Section ─── */}
          <div className="section" style={{ '--c': '#b967ff' } as React.CSSProperties}>
            <h2 className="stitle" style={{ '--c': '#b967ff' } as React.CSSProperties}>HARMONY</h2>
            <div className="krow" style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            {/* Section dropdown */}
            <PsyCycleButton
              value={section}
              options={SECTIONS}
              display={v => v}
              color="#f472b6"
              label="SECTION"
              onChange={onSectionChange}
            />

            {/* Key selector — root pitch class (0-11 = C-B). Changes the
                director's context so CHORDS uses the new key. */}
            <PsyCycleButton
              value={String(musicalKey)}
              options={NOTE_NAMES.map((_, i) => String(i))}
              display={v => NOTE_NAMES[parseInt(v)]!}
              color="#00ffc8"
              label="KEY"
              onChange={v => onKeyChange(parseInt(v))}
            />

            {/* Scale selector — determines the diatonic chords CHORDS uses. */}
            <PsyCycleButton
              value={scaleName}
              options={Object.keys(SCALE_LABELS)}
              display={v => SCALE_LABELS[v]!}
              color="#b967ff"
              label="SCALE"
              onChange={onScaleChange}
            />

            {/* Arpeggio pattern selector — controls the lead's melodic shape. */}
            <PsyCycleButton
              value={arpeggio}
              options={Object.keys(ARPEGGIO_LABELS) as ArpeggioPattern[]}
              display={v => ARPEGGIO_LABELS[v]}
              color="#fbbf24"
              label="ARP"
              onChange={setArpeggio}
            />

            {/* Bass pattern selector — controls the bassline character. */}
            <PsyCycleButton
              value={bassPattern}
              options={Object.keys(BASS_LABELS) as BassPattern[]}
              display={v => BASS_LABELS[v]}
              color="#ff2e88"
              label="BASS"
              onChange={setBassPattern}
            />

            {/* Lead density knob — controls how busy the melody is.
                0.2 = sparse (few notes), 0.6 = default, 1.0 = every 8th note. */}
            <PsyKnob
              value={density}
              min={0.2}
              max={1}
              def={0.6}
              step={0.1}
              color="#22d3ee"
              label="DENS"
              fmt={v => v.toFixed(1)}
              onChange={setDensity}
            />

            {/* Melody octave selector — shifts the lead register by whole octaves.
                -2 to +2. Lets the user match the melody to their sample's optimal register. */}
            <PsyCycleButton
              value={String(melodyOctave)}
              options={['-2', '-1', '0', '1', '2']}
              display={v => (parseInt(v) > 0 ? `+${v}` : v)}
              color="#b8e05a"
              label="OCT"
              onChange={v => setMelodyOctave(parseInt(v))}
            />

            {/* Bass octave selector — shifts the bass register independently.
                -2 to +2. Lets the user match the bass to their sample's optimal register. */}
            <PsyCycleButton
              value={String(bassOctave)}
              options={['-2', '-1', '0', '1', '2']}
              display={v => (parseInt(v) > 0 ? `+${v}` : v)}
              color="#fb923c"
              label="B.OCT"
              onChange={v => setBassOctave(parseInt(v))}
            />

            {/* Energy knob */}
            <PsyKnob
              value={energy}
              min={0}
              max={1}
              def={0.7}
              step={0.05}
              color="#ffb454"
              label="ENERGY"
              fmt={v => v.toFixed(2)}
              onChange={onEnergyChange}
            />
            </div>
          </div>

          {/* ─── Pattern Editor + Performance Pads (side by side) ─── */}
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ErrorBoundary name="PatternEditor">
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
                mutedRoles={mutedRoles}
                soloedRoles={soloedRoles}
                onToggleMute={onToggleMute}
                onToggleSolo={onToggleSolo}
              />
              </ErrorBoundary>
            </div>
            <ErrorBoundary name="PerformancePads">
            <PerformancePads
              onTrigger={triggerPad}
              nowPlayingRole={nowPlaying.role}
              nowPlayingAt={nowPlaying.at}
              disabled={!initialized}
            />
            </ErrorBoundary>
          </div>

          {/* ─── Mixer + Presets + Slots ─── */}
          <div className="section mt-3 grid gap-3 lg:grid-cols-3">
            <div>
              {/* FX toggles — audio effects, grouped with the mixer */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                {/* PUMP (sidechain) toggle */}
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
                  PUMP
                </Button>

                {/* EVOLVE toggle */}
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
                  EVOLVE
                </Button>

                {/* FLT (master filter) toggle */}
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
                  FLT
                </Button>
              </div>
              <ErrorBoundary name="Mixer">
              <Mixer busState={busState} onGain={onBusGain} onEQ={onBusEQ} onSaturation={onBusSaturation} onMute={onBusMute} onSolo={onBusSolo} />
              </ErrorBoundary>
            </div>
            <ErrorBoundary name="PresetsPanel">
            <PresetsPanel onLoad={loadPreset} onLoadMixer={loadMixerPreset} />
            </ErrorBoundary>
            <PatternSlots
              slotNames={slotNames}
              onSave={saveToSlotN}
              onLoad={loadFromSlotN}
              onClear={clearSlotN}
            />
          </div>

          {/* ─── Per-role FX panel (Phase 1.6.2) ───────────────────────────── */}
          <div className="section mt-3">
            <ErrorBoundary name="RoleFxPanel">
              <RoleFxPanel
                fxState={roleFxState}
                onChange={onRoleFxChange}
                disabled={!initialized}
              />
            </ErrorBoundary>
          </div>

          {/* ─── Timeline + Song + Automation (2-col grid) ─── */}
          <div className="section mt-3 grid gap-3 lg:grid-cols-2">
            <ErrorBoundary name="TimelineView">
            <TimelineView
              song={song}
              songMode={songMode}
              currentSegment={songSegment}
              currentBar={songBar}
              bpm={bpm}
            />
            </ErrorBoundary>
            <ErrorBoundary name="SongEditor">
            <SongEditor
              song={song}
              slotNames={slotNames}
              songMode={songMode}
              currentSegment={songSegment}
              currentBar={songBar}
              onChange={onSongChange}
              onToggleSongMode={onToggleSongMode}
            />
            </ErrorBoundary>
            <ErrorBoundary name="AutomationEditor">
            <AutomationEditor
              bank={automationBank}
              dirty={automationDirty}
              enabled={automationEnabled}
              onToggle={onToggleAutomation}
              onAddPoint={onAddAutomationPoint}
              onClearTrack={onClearAutomationTrack}
            />
            </ErrorBoundary>
          </div>

          {/* ─── Library + Importer + Visualizer ─── */}
          <div className="section mt-3 grid gap-3 lg:grid-cols-2">
            <div className="space-y-4">
              <ErrorBoundary name="SampleLibrary">
              <SampleLibrary
                samples={samples}
                onAudition={auditionSample}
                onRemove={onRemoveSample}
                nowPlayingSampleId={nowPlaying.sampleId}
                nowPlayingAt={nowPlaying.at}
              />
              </ErrorBoundary>
              <ErrorBoundary name="SampleImporter">
              <SampleImporter
                audioContext={audioCtx}
                onImport={onImportSample}
                onReconstruct={onReconstructPattern}
              />
              </ErrorBoundary>
            </div>
            <ErrorBoundary name="Visualizer">
            <Visualizer analyser={analyser} isPlaying={isPlaying} />
            </ErrorBoundary>
          </div>

          {/* ─── Footer ─── */}
          <footer style={{ marginTop: 'auto', paddingTop: '14px', borderTop: '1px solid #232932', fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#5b6470', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '8px' }}>
            <span>Copyright 2026 PSY Family</span>
            <span>{loadResult ? `${loadResult.loaded} samples loaded` : 'loading…'}</span>
          </footer>
        </div>
      </Chassis>
    </ErrorBoundary>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a human-friendly slot name from current BPM + active steps. */
function presetNameFor(bpm: number, pattern: Pattern): string {
  const activeSteps = Object.values(pattern).reduce((acc, row) => acc + row.filter(Boolean).length, 0)
  return `${bpm}bpm · ${activeSteps} steps`
}
