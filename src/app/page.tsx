'use client'

// PSY Sampler — debug-first UI (new, built on renewed code).
//
// This UI is a CONTROL SURFACE + DEBUGGER, not a source of truth.
// The DemoDirector owns the pattern; the UI projects device state.
//
// Key design: every panel shows REAL state from the device —
// eventsReceived, notesTriggered, notesSkipped, lastEvent, activeVoices.
// This makes the event flow VISIBLE.
//
// Built on renewed code:
// - lastEvent tracking (device.ts)
// - outputNode option (audio-graph.ts)
// - fixed roles matching SampleRole enum
// - deleted DeviceRegistry (no factory indirection)
// - O(1) deriveVariant

import * as React from 'react'
import {
  createSamplerDevice,
  type SamplerBundle,
  type SampleAsset,
  type SampleRole,
} from '@/psy-sampler'
import {
  DeviceHost,
  InMemoryChannel,
  type PsyDevice,
  type MusicalContext,
  type DeviceCapabilities,
  type MusicalEvent,
  type MusicalTransport,
} from '@/psy-foundation-shim'
import { DemoTransport } from '@/lib/demo-transport'
import { DemoDirector, DEFAULT_PATTERN, type Pattern } from '@/lib/demo-director'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeviceStats {
  eventsReceived: number
  notesTriggered: number
  notesSkipped: number
  activeVoices: number
  pendingEvents: number
  librarySize: number
  isStarted: boolean
  lastEvent: {
    channel: string
    note: number
    velocity: number
    at: number
    sampleId?: string
    triggered: boolean
  } | null
  lastTransport: MusicalTransport | null
  lastContext: MusicalContext | null
  capabilities: DeviceCapabilities
}

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

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLES: SampleRole[] = ['kick', 'bass', 'lead', 'hat-closed', 'clap', 'perc']
const STEPS = 16
const ROLE_COLORS: Record<SampleRole, string> = {
  kick: '#00ffc8',
  bass: '#ff2e88',
  lead: '#b967ff',
  'hat-closed': '#fbbf24',
  'hat-open': '#fbbf24',
  clap: '#a3e635',
  perc: '#22d3ee',
  texture: '#818cf8',
  fx: '#818cf8',
}
const ROLE_LABEL: Record<SampleRole, string> = {
  kick: 'KCK',
  bass: 'BAS',
  lead: 'LID',
  'hat-closed': 'HAT',
  'hat-open': 'HOT',
  clap: 'CLP',
  perc: 'PRC',
  texture: 'TXT',
  fx: 'FX',
}

// ─── Init Overlay ────────────────────────────────────────────────────────────

function InitOverlay({ onInit }: { onInit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950">
      <div className="flex max-w-md flex-col items-center gap-6 px-6 text-center">
        <div className="grid size-20 place-items-center rounded-2xl border border-emerald-400/40 bg-zinc-900 shadow-[0_0_40px_rgba(0,255,200,0.45)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-10 text-emerald-300">
            <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          </svg>
        </div>
        <div>
          <h1 className="font-mono text-3xl font-bold tracking-[0.15em]">
            <span className="bg-gradient-to-r from-emerald-300 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">PSY SAMPLER</span>
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">debug-first · realization device</p>
        </div>
        <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
          creates AudioContext, InMemoryChannel, DeviceHost. registers SamplerDevice + StubDevice.
          drives a 16-step pattern via DemoDirector. all events are visible in the debug panel.
        </p>
        <Button
          onClick={onInit}
          className="h-12 min-w-[220px] gap-2 border border-emerald-400/50 bg-zinc-900 font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200"
          style={{ boxShadow: '0 0 28px rgba(0,255,200,0.5)' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
          </svg>
          click to initialize audio
        </Button>
      </div>
    </div>
  )
}

// ─── Stat Badge ───────────────────────────────────────────────────────────────

function Stat({ label, value, color = 'emerald' }: { label: string; value: string | number; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-300 border-emerald-400/30',
    fuchsia: 'text-fuchsia-300 border-fuchsia-400/30',
    violet: 'text-violet-300 border-violet-400/30',
    amber: 'text-amber-300 border-amber-400/30',
    zinc: 'text-zinc-300 border-zinc-400/30',
  }
  return (
    <div className={`flex flex-col gap-0.5 rounded border ${colorMap[color] ?? colorMap.emerald} bg-zinc-900/60 px-2.5 py-1.5`}>
      <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-zinc-500">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{value}</span>
    </div>
  )
}

// ─── Debug Panel (the key new component) ─────────────────────────────────────

function DebugPanel({ stats }: { stats: DeviceStats }) {
  const lastEv = stats.lastEvent
  const caps = stats.capabilities
  const transport = stats.lastTransport
  const context = stats.lastContext

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="size-2 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: '0 0 8px rgba(0,255,200,0.8)' }} />
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">DEBUG · event flow</h2>
      </div>

      {/* Device stats grid */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="EVENTS" value={stats.eventsReceived} color="emerald" />
        <Stat label="TRIGGERED" value={stats.notesTriggered} color="emerald" />
        <Stat label="SKIPPED" value={stats.notesSkipped} color={stats.notesSkipped > 0 ? 'amber' : 'zinc'} />
        <Stat label="VOICES" value={`${stats.activeVoices}/32`} color="fuchsia" />
        <Stat label="PENDING" value={stats.pendingEvents} color="violet" />
      </div>

      {/* Last event — the key debug info */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-1.5 font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">LAST EVENT</div>
        {lastEv ? (
          <div className="font-mono text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">channel</span>
              <span className="text-emerald-300">{lastEv.channel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">note</span>
              <span className="text-fuchsia-300 tabular-nums">{lastEv.note}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">velocity</span>
              <span className="text-violet-300 tabular-nums">{lastEv.velocity.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">at</span>
              <span className="text-amber-300 tabular-nums">{lastEv.at.toFixed(3)}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">sample</span>
              <span className="text-emerald-300">{lastEv.sampleId ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">triggered</span>
              <span className={lastEv.triggered ? 'text-emerald-300' : 'text-amber-300'}>
                {lastEv.triggered ? '✓ YES' : '✗ SKIPPED'}
              </span>
            </div>
          </div>
        ) : (
          <div className="font-mono text-[11px] text-zinc-600">no events yet — press PLAY</div>
        )}
      </div>

      {/* Transport + Context */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">TRANSPORT</div>
          {transport ? (
            <div className="font-mono text-[10px] space-y-0.5 text-zinc-400">
              <div>bpm: <span className="text-emerald-300 tabular-nums">{transport.bpm}</span></div>
              <div>bar: <span className="text-fuchsia-300 tabular-nums">{transport.bar}</span></div>
              <div>rev: <span className="text-violet-300 tabular-nums">{transport.revision}</span></div>
              <div>locked: <span className={transport.locked ? 'text-emerald-300' : 'text-amber-300'}>{transport.locked ? 'YES' : 'NO'}</span></div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-zinc-600">—</div>
          )}
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">CONTEXT</div>
          {context ? (
            <div className="font-mono text-[10px] space-y-0.5 text-zinc-400">
              <div>section: <span className="text-emerald-300">{context.section}</span></div>
              <div>energy: <span className="text-fuchsia-300 tabular-nums">{context.energy.toFixed(2)}</span></div>
              <div>style: <span className="text-violet-300">{context.style}</span></div>
              <div>key: <span className="text-amber-300">{context.key}</span></div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-zinc-600">—</div>
          )}
        </div>
      </div>

      {/* Capabilities */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="mb-1.5 font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">CAPABILITIES · roles</div>
        <div className="flex flex-wrap gap-1">
          {caps.roles.map((r) => (
            <span key={r} className="rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[9px] text-zinc-300">
              {r}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Pattern Editor ──────────────────────────────────────────────────────────

function PatternEditor({
  pattern,
  currentStep,
  onToggle,
}: {
  pattern: Pattern
  currentStep: number
  onToggle: (role: SampleRole, step: number) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">PATTERN · 16 steps</h2>
        <span className="font-mono text-[10px] text-zinc-500">click to toggle</span>
      </div>

      {/* Step indicator */}
      <div className="mb-2 flex gap-1 pl-12">
        {Array.from({ length: STEPS }).map((_, i) => (
          <div
            key={i}
            className="flex-1 text-center font-mono text-[8px] tabular-nums"
            style={{
              color: i === currentStep ? '#00ffc8' : '#52525b',
              textShadow: i === currentStep ? '0 0 8px rgba(0,255,200,0.8)' : 'none',
            }}
          >
            {(i + 1).toString().padStart(2, '0')}
          </div>
        ))}
      </div>

      {/* Role rows */}
      <div className="space-y-1">
        {ROLES.map((role) => (
          <div key={role} className="flex items-center gap-1">
            <div
              className="w-11 font-mono text-[9px] font-bold uppercase tracking-wider"
              style={{ color: ROLE_COLORS[role] }}
            >
              {ROLE_LABEL[role]}
            </div>
            <div className="flex flex-1 gap-1">
              {pattern[role]?.map((on, step) => {
                const isActive = on
                const isCurrent = step === currentStep
                return (
                  <button
                    key={step}
                    onClick={() => onToggle(role, step)}
                    className="aspect-square flex-1 rounded-sm border transition-all"
                    style={{
                      backgroundColor: isActive ? ROLE_COLORS[role] : 'rgba(24,24,27,0.8)',
                      borderColor: isCurrent ? '#00ffc8' : isActive ? ROLE_COLORS[role] : '#27272a',
                      boxShadow: isActive
                        ? `0 0 8px ${ROLE_COLORS[role]}80`
                        : isCurrent
                          ? '0 0 8px rgba(0,255,200,0.5)'
                          : 'none',
                      opacity: isActive ? 0.9 : 1,
                    }}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sample Library Browser ──────────────────────────────────────────────────

function SampleLibrary({ samples }: { samples: SampleAsset[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <h2 className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
        LIBRARY · {samples.length} samples
      </h2>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {samples.length === 0 ? (
          <div className="font-mono text-[10px] text-zinc-600">loading…</div>
        ) : (
          samples.map((s) => (
            <div
              key={s.metadata.id}
              className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1"
            >
              <span
                className="font-mono text-[9px] font-bold uppercase"
                style={{ color: ROLE_COLORS[s.metadata.category as SampleRole] ?? '#71717a' }}
              >
                {s.metadata.category}
              </span>
              <span className="flex-1 truncate font-mono text-[10px] text-zinc-300">{s.metadata.id}</span>
              <span className="font-mono text-[9px] tabular-nums text-zinc-500">
                {s.features.duration.toFixed(2)}s
              </span>
              <Badge className="border border-emerald-400/30 bg-emerald-500/10 px-1 py-0 font-mono text-[7px] uppercase text-emerald-300">
                {s.metadata.provenance.commercialUse ? 'COMMERCIAL' : 'NON-COMM'}
              </Badge>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Visualizer ──────────────────────────────────────────────────────────────

function Visualizer({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rafRef = React.useRef<number>(0)

  React.useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)

      const w = canvas.width
      const h = canvas.height
      ctx.fillStyle = 'rgba(9,9,11,0.4)'
      ctx.fillRect(0, 0, w, h)

      const barCount = 48
      const barWidth = w / barCount
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * bufferLength * 0.7)
        const v = dataArray[idx]! / 255
        const barH = v * h * 0.9
        const hue = i < 16 ? 160 : i < 32 ? 320 : 280
        ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${0.4 + v * 0.6})`
        ctx.fillRect(i * barWidth + 1, h - barH, barWidth - 2, barH)
      }
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <h2 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">ANALYSER</h2>
      <canvas
        ref={canvasRef}
        width={600}
        height={120}
        className="w-full"
        style={{ height: 120 }}
      />
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Home() {
  const [initialized, setInitialized] = React.useState(false)
  const [isPlaying, setIsPlaying] = React.useState(false)
  const [bpm, setBpm] = React.useState(145)
  const [section, setSection] = React.useState('DROP')
  const [energy, setEnergy] = React.useState(0.7)
  const [currentStep, setCurrentStep] = React.useState(0)
  const [pattern, setPattern] = React.useState<Pattern>(structuredClone(DEFAULT_PATTERN))
  const [samples, setSamples] = React.useState<SampleAsset[]>([])
  const [stats, setStats] = React.useState<DeviceStats | null>(null)
  const [loadResult, setLoadResult] = React.useState<{ loaded: number; skipped: number; total: number } | null>(null)
  const [analyser, setAnalyser] = React.useState<AnalyserNode | null>(null)
  const [deviceCount, setDeviceCount] = React.useState(0)

  const ctxRef = React.useRef<AudioContext | null>(null)
  const bundleRef = React.useRef<SamplerBundle | null>(null)
  const hostRef = React.useRef<DeviceHost | null>(null)
  const directorRef = React.useRef<DemoDirector | null>(null)
  const transportRef = React.useRef<DemoTransport | null>(null)
  const stubRef = React.useRef<StubDevice | null>(null)
  const statsIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // ─── Initialize audio (on user gesture) ────────────────────────────────────

  const initializeAudio = React.useCallback(async () => {
    if (initialized) return

    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    await ctx.resume()
    ctxRef.current = ctx

    // Channel + Host
    const channel = new InMemoryChannel('psy-sampler-debug')
    const host = new DeviceHost(channel)
    hostRef.current = host

    // Transport
    const transport = new DemoTransport({ initialBpm: bpm, audioContext: ctx })
    transportRef.current = transport

    // Sampler device (standalone — outputNode null → connects to ctx.destination)
    const bundle = createSamplerDevice({
      audioContext: ctx,
      manifestUrl: '/samples/manifest.json',
      onLoaded: (result) => setLoadResult(result),
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

    // Director
    const director = new DemoDirector(
      {
        host,
        transport,
        audioContext: ctx,
        bpm,
        initialPattern: pattern,
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

    // Load samples
    await bundle.load()
    setSamples(bundle.library.list())

    // Start polling device stats (for debug panel)
    statsIntervalRef.current = setInterval(() => {
      const dev = bundle.device
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

    setInitialized(true)
  }, [initialized, bpm, energy, section, pattern])

  // ─── Transport controls ────────────────────────────────────────────────────

  const togglePlay = React.useCallback(() => {
    const director = directorRef.current
    if (!director) return
    if (isPlaying) {
      director.stop()
      setIsPlaying(false)
    } else {
      director.start()
      setIsPlaying(true)
    }
  }, [isPlaying])

  const onBpmChange = React.useCallback((value: number) => {
    setBpm(value)
    directorRef.current?.setBpm(value)
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
    directorRef.current?.toggleStep(role, step)
    setPattern({ ...directorRef.current!.getPattern() })
  }, [])

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current)
      directorRef.current?.stop()
      hostRef.current?.dispose()
      ctxRef.current?.close()
    }
  }, [])

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!initialized) {
    return <InitOverlay onInit={initializeAudio} />
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Ambient gradient */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 20%, rgba(255,46,136,0.12), transparent 60%), radial-gradient(55% 45% at 80% 30%, rgba(185,103,255,0.12), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(0,255,200,0.08), transparent 60%)',
        }}
      />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
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
            className="h-10 gap-2 border font-mono text-xs font-bold uppercase tracking-[0.15em]"
            variant={isPlaying ? 'destructive' : 'default'}
            style={
              isPlaying
                ? { borderColor: 'rgba(255,46,136,0.5)', boxShadow: '0 0 16px rgba(255,46,136,0.4)' }
                : { borderColor: 'rgba(0,255,200,0.5)', boxShadow: '0 0 16px rgba(0,255,200,0.4)' }
            }
          >
            {isPlaying ? '■ STOP' : '▶ PLAY'}
          </Button>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">BPM</span>
            <Slider value={[bpm]} onValueChange={(v) => onBpmChange(v[0]!)} min={100} max={180} step={1} className="w-28" />
            <span className="w-8 font-mono text-xs tabular-nums text-emerald-300">{bpm}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">SECTION</span>
            <select
              value={section}
              onChange={(e) => onSectionChange(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-fuchsia-300"
            >
              {['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">ENERGY</span>
            <Slider value={[energy]} onValueChange={(v) => onEnergyChange(v[0]!)} min={0} max={1} step={0.05} className="w-24" />
            <span className="w-8 font-mono text-xs tabular-nums text-violet-300">{energy.toFixed(2)}</span>
          </div>
        </div>

        {/* ─── Main grid: pattern + debug ─── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <PatternEditor pattern={pattern} currentStep={currentStep} onToggle={onToggleStep} />
          {stats && <DebugPanel stats={stats} />}
        </div>

        {/* ─── Library + Visualizer ─── */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <SampleLibrary samples={samples} />
          <Visualizer analyser={analyser} />
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
  )
}
