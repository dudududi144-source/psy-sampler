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
import { DemoDirector, DEFAULT_PATTERN, type Pattern } from '@/lib/demo-director'
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
import { renderAndDownloadWavLive } from '@/lib/wav-export'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ErrorBoundary } from '@/components/error-boundary'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'
import { toast } from '@/hooks/use-toast'
import { InitOverlay } from '@/components/init-overlay'
import { Stat } from '@/components/stat-badge'
import { DebugPanel } from '@/components/debug-panel'
import { PatternEditor } from '@/components/pattern-editor'
import { SampleLibrary } from '@/components/sample-library'
import { Visualizer } from '@/components/visualizer'
import { Mixer } from '@/components/mixer'
import { PresetsPanel, PatternSlots } from '@/components/presets-panel'
import {
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
  const [currentStep, setCurrentStep] = React.useState(0)
  const [pattern, setPattern] = React.useState<Pattern>(structuredClone(DEFAULT_PATTERN))
  const [samples, setSamples] = React.useState<SampleAsset[]>([])
  const [stats, setStats] = React.useState<DeviceStats | null>(null)
  const [eventLog, setEventLog] = React.useState<EventLogEntry[]>([])
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)
  const [deviceCount, setDeviceCount] = React.useState(0)
  const [loadResult, setLoadResult] = React.useState<{ loaded: number; skipped: number; total: number } | null>(null)
  const [slotNames, setSlotNames] = React.useState<string[]>(['', '', '', ''])
  const [nowPlaying, setNowPlaying] = React.useState<{ role: SampleRole | null; sampleId: string | null; at: number }>({
    role: null,
    sampleId: null,
    at: 0,
  })
  const [exporting, setExporting] = React.useState(false)
  const [pumpEnabled, setPumpEnabled] = React.useState(false)
  const [evolveEnabled, setEvolveEnabled] = React.useState(false)
  const [busState, setBusState] = React.useState<Record<BusName, BusMixerState>>({
    drum: { gain: 0.9, muted: false, solo: false },
    music: { gain: 0.85, muted: false, solo: false },
    atmos: { gain: 0.7, muted: false, solo: false },
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
        manifestUrl: '/samples/manifest.json',
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
          setPattern(structuredClone(autosave))
        }
      } catch {
        // ignore — fall back to current pattern state
      }

      // Director
      const director = new DemoDirector(
        {
          host,
          transport,
          audioContext: ctx,
          initialPattern,
        },
        (step) => setCurrentStep(step)
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

      // Start polling device stats (for debug panel).
      statsIntervalRef.current = setInterval(() => {
        const dev = bundle!.device
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
      setInitError(`Failed to initialize audio: ${message}. Check that /samples/manifest.json is reachable and the AudioContext can start.`)
      // Clean up partial state on failure.
      if (bundle) bundle.dispose()
      if (host) host.dispose()
      if (ctx) await ctx.close().catch(() => {})
      ctxRef.current = null
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

  const onToggleStep = React.useCallback((role: SampleRole, step: number) => {
    const director = directorRef.current
    if (!director) return
    director.toggleStep(role, step)
    const newPattern = structuredClone(director.getPattern())
    setPattern(newPattern)
    // Autosave on every toggle (best-effort).
    try {
      autosavePattern(newPattern)
    } catch {
      // ignore — localStorage unavailable
    }
  }, [])

  const onClearPattern = React.useCallback(() => {
    const empty = structuredClone(DEFAULT_PATTERN)
    directorRef.current?.setPattern(empty)
    setPattern(empty)
    // Autosave the cleared pattern (best-effort).
    try {
      autosavePattern(empty)
    } catch {
      // ignore — localStorage unavailable
    }
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

  // ─── Mixer controls (FIX Bug 14: side effects OUT of state updater) ────────

  const busStateRef = React.useRef(busState)
  React.useEffect(() => { busStateRef.current = busState }, [busState])

  const onBusGain = React.useCallback((name: BusName, value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusGain(name, value)
      const soloed = BUS_NAMES.filter((n) => busStateRef.current[n].solo)
      if (soloed.length > 0) graph.applySolo(soloed)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], gain: value } }))
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
    setPattern(structuredClone(cloned))
    try {
      autosavePattern(cloned)
    } catch {
      // ignore
    }
    toast({ title: `Loaded ${preset.name} · ${preset.bpm} BPM` })
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
      setPattern(structuredClone(data.pattern))
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


  const handleExportWav = React.useCallback(async () => {
    const ctx = ctxRef.current
    const bundle = bundleRef.current
    if (!ctx || !bundle) return
    setExporting(true)
    // Auto-start playback if not playing, so we capture something.
    const wasPlaying = directorRef.current?.isRunning ?? false
    exportStartedRef.current = false
    if (!wasPlaying) {
      directorRef.current?.start()
      setIsPlaying(true)
      exportStartedRef.current = true
    }
    try {
      const durationSec = 8 // ~2 bars at 145 BPM
      const filename = `psy-sampler-${Date.now()}.wav`
      // FIX Bug 3: use renderAndDownloadWavLive (browser-portable, mimeType fallback).
      await renderAndDownloadWavLive(ctx, bundle.audioGraph.master, durationSec, filename)
    } catch (err) {
      console.error('[psy-sampler] WAV export failed:', err)
      alert(`WAV export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      // Only stop if WE started it AND the user didn't take over during export.
      if (exportStartedRef.current) {
        directorRef.current?.stop()
        setIsPlaying(false)
        exportStartedRef.current = false
      }
      setExporting(false)
    }
  }, [])

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useKeyboardShortcuts({
    onTogglePlay: togglePlay,
    onStop: stopPlayback,
    enabled: initialized,
  })

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  // P1: Autosave session state (BPM, swing, master, section, energy, busState).
  React.useEffect(() => {
    const state: SessionState = { bpm, swing, masterVolume, section, energy, busState }
    saveSessionState(state)
  }, [bpm, swing, masterVolume, section, energy, busState])

  React.useEffect(() => {
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
      directorRef.current?.stop()
      bundleRef.current?.dispose()
      hostRef.current?.dispose()
      ctxRef.current?.close().catch(() => {})
    }
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
            <div className="flex flex-wrap gap-2">
              <Stat label="DEVICES" value={deviceCount} color="emerald" />
              <Stat label="SAMPLES" value={loadResult ? `${loadResult.loaded}/${loadResult.total}` : '—'} color="violet" />
              <Stat label="BPM" value={bpm} color="fuchsia" />
              <Stat label="VOICES" value={stats ? `${stats.activeVoices}/32` : '0/32'} color="amber" />
            </div>
          </header>

          {/* ─── Transport bar ─── */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
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
          </div>

          {/* ─── Main grid: pattern editor (left) + debug (right) ─── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <PatternEditor
              pattern={pattern}
              currentStep={currentStep}
              onToggle={onToggleStep}
              nowPlayingRole={nowPlaying.role}
              nowPlayingAt={nowPlaying.at}
              onClearPattern={onClearPattern}
            />
            {stats && <DebugPanel stats={stats} eventLog={eventLog} />}
          </div>

          {/* ─── Mixer + Presets + Slots ─── */}
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Mixer busState={busState} onGain={onBusGain} onMute={onBusMute} onSolo={onBusSolo} />
            <PresetsPanel onLoad={loadPreset} />
            <PatternSlots
              slotNames={slotNames}
              onSave={saveToSlotN}
              onLoad={loadFromSlotN}
              onClear={clearSlotN}
            />
          </div>

          {/* ─── Library + Visualizer ─── */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <SampleLibrary
              samples={samples}
              onAudition={auditionSample}
              nowPlayingSampleId={nowPlaying.sampleId}
              nowPlayingAt={nowPlaying.at}
            />
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
