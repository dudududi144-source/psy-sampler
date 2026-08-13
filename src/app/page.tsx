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
  PATTERN_PRESETS,
  type PatternPreset,
} from '@/lib/pattern-persistence'
import { renderAndDownloadWavLive } from '@/lib/wav-export'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { ErrorBoundary } from '@/components/error-boundary'
import { useKeyboardShortcuts } from '@/lib/use-keyboard-shortcuts'

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

interface EventLogEntry {
  id: number
  channel: string
  note: number
  velocity: number
  at: number
  sampleId?: string
  triggered: boolean
  receivedAt: number // Date.now()
}

interface LoadProgress {
  loaded: number
  total: number
}

interface BusMixerState {
  gain: number
  muted: boolean
  solo: boolean
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

const ROLES: SampleRole[] = ['kick', 'bass', 'lead', 'hat-closed', 'hat-open', 'clap', 'perc', 'texture', 'fx']
const STEPS = 16
const ROLE_COLORS: Record<SampleRole, string> = {
  kick: '#00ffc8',
  bass: '#ff2e88',
  lead: '#b967ff',
  'hat-closed': '#fbbf24',
  'hat-open': '#fb923c',
  clap: '#a3e635',
  perc: '#22d3ee',
  texture: '#f472b6',
  fx: '#e879f9',
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
  fx: 'FX ',
}
const BUS_NAMES: BusName[] = ['drum', 'music', 'atmos']
const BUS_COLORS: Record<BusName, string> = {
  drum: '#00ffc8',
  music: '#ff2e88',
  atmos: '#b967ff',
}
const BUS_ROLES: Record<BusName, SampleRole[]> = {
  drum: ['kick', 'hat-closed', 'hat-open', 'clap', 'perc'],
  music: ['bass', 'lead'],
  atmos: ['texture', 'fx'],
}
const SECTIONS = ['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER']
const EVENT_LOG_MAX = 50
const NOW_PLAYING_MS = 220

// ─── Init Overlay (with loading progress + error) ────────────────────────────

function InitOverlay({
  onInit,
  loadProgress,
  error,
  initializing,
}: {
  onInit: () => void
  loadProgress: LoadProgress | null
  error: string | null
  initializing: boolean
}) {
  const pct = loadProgress ? Math.round((loadProgress.loaded / Math.max(1, loadProgress.total)) * 100) : 0
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden style={{
        background:
          'radial-gradient(60% 50% at 20% 20%, rgba(255,46,136,0.12), transparent 60%), radial-gradient(55% 45% at 80% 30%, rgba(185,103,255,0.12), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(0,255,200,0.08), transparent 60%)',
      }} />
      <div className="relative flex max-w-md flex-col items-center gap-6 px-6 text-center">
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

        {/* Loading progress bar */}
        {loadProgress && (
          <div className="w-full max-w-sm">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-zinc-400">
              <span className="uppercase tracking-wider text-emerald-300">loading samples…</span>
              <span className="tabular-nums">{loadProgress.loaded}/{loadProgress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #00ffc8, #b967ff)',
                  boxShadow: '0 0 12px rgba(0,255,200,0.6)',
                }}
              />
            </div>
            <div className="mt-1 text-right font-mono text-[9px] tabular-nums text-zinc-500">{pct}%</div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="w-full max-w-sm rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-left">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-red-300">⚠</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-300">initialization failed</span>
            </div>
            <p className="break-words font-mono text-[10px] leading-relaxed text-zinc-300">{error}</p>
          </div>
        )}

        <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
          creates AudioContext, InMemoryChannel, DeviceHost. registers SamplerDevice + StubDevice.
          drives a 16-step pattern via DemoDirector. all events are visible in the debug panel.
        </p>

        {!loadProgress && (
          <Button
            onClick={onInit}
            disabled={initializing}
            className="h-12 min-w-[220px] gap-2 border border-emerald-400/50 bg-zinc-900 font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:opacity-50"
            style={{ boxShadow: '0 0 28px rgba(0,255,200,0.5)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
            </svg>
            {initializing ? 'initializing…' : 'click to initialize audio'}
          </Button>
        )}

        {/* Retry button on error */}
        {error && (
          <Button
            onClick={onInit}
            disabled={initializing}
            className="h-10 gap-2 border border-fuchsia-400/50 bg-zinc-900 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300 hover:bg-fuchsia-500/10"
          >
            retry initialization
          </Button>
        )}

        {/* Keyboard hint */}
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">
          shortcuts: <span className="text-zinc-400">[space]</span> play/stop · <span className="text-zinc-400">[esc]</span> stop
        </div>
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

// ─── Debug Panel ─────────────────────────────────────────────────────────────

function DebugPanel({ stats, eventLog }: { stats: DeviceStats; eventLog: EventLogEntry[] }) {
  const lastEv = stats.lastEvent
  const caps = stats.capabilities
  const transport = stats.lastTransport
  const context = stats.lastContext

  const logRef = React.useRef<HTMLDivElement>(null)
  // Auto-scroll to newest event.
  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0
  }, [eventLog])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="size-2 animate-pulse rounded-full bg-emerald-400" style={{ boxShadow: '0 0 8px rgba(0,255,200,0.8)' }} />
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
          <div className="space-y-0.5 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-zinc-500">channel</span>
              <span className="text-emerald-300">{lastEv.channel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">note</span>
              <span className="tabular-nums text-fuchsia-300">{lastEv.note}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">velocity</span>
              <span className="tabular-nums text-violet-300">{lastEv.velocity.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">at</span>
              <span className="tabular-nums text-amber-300">{lastEv.at.toFixed(3)}s</span>
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
            <div className="space-y-0.5 font-mono text-[10px] text-zinc-400">
              <div>bpm: <span className="tabular-nums text-emerald-300">{transport.bpm}</span></div>
              <div>bar: <span className="tabular-nums text-fuchsia-300">{transport.bar}</span></div>
              <div>rev: <span className="tabular-nums text-violet-300">{transport.revision}</span></div>
              <div>locked: <span className={transport.locked ? 'text-emerald-300' : 'text-amber-300'}>{transport.locked ? 'YES' : 'NO'}</span></div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-zinc-600">—</div>
          )}
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">CONTEXT</div>
          {context ? (
            <div className="space-y-0.5 font-mono text-[10px] text-zinc-400">
              <div>section: <span className="text-emerald-300">{context.section}</span></div>
              <div>energy: <span className="tabular-nums text-fuchsia-300">{context.energy.toFixed(2)}</span></div>
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

      {/* Scrollable event log */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="font-mono text-[8px] uppercase tracking-[0.2em] text-zinc-500">EVENT LOG · last {EVENT_LOG_MAX}</div>
          <span className="font-mono text-[8px] tabular-nums text-zinc-600">{eventLog.length}</span>
        </div>
        <div
          ref={logRef}
          className="max-h-44 space-y-0.5 overflow-y-auto pr-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {eventLog.length === 0 ? (
            <div className="font-mono text-[10px] text-zinc-600">no events yet</div>
          ) : (
            eventLog.map((e) => {
              const role = parseChannel(e.channel).role
              const color = ROLE_COLORS[role] ?? '#a1a1aa'
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded px-1 py-0.5 font-mono text-[9px] hover:bg-zinc-800/40"
                >
                  <span className="w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }} />
                  <span className="w-12 shrink-0 tabular-nums text-zinc-600">{(e.receivedAt / 1000 % 1000).toFixed(2)}s</span>
                  <span className="w-16 shrink-0 truncate" style={{ color }}>{e.channel}</span>
                  <span className="w-8 shrink-0 tabular-nums text-fuchsia-300">{e.note}</span>
                  <span className="w-10 shrink-0 tabular-nums text-violet-300">v{e.velocity.toFixed(2)}</span>
                  <span className="flex-1 truncate text-emerald-300">{e.sampleId ?? '—'}</span>
                  <span className={e.triggered ? 'text-emerald-400' : 'text-amber-400'}>
                    {e.triggered ? '✓' : '✗'}
                  </span>
                </div>
              )
            })
          )}
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
  nowPlayingRole,
  nowPlayingAt,
}: {
  pattern: Pattern
  currentStep: number
  onToggle: (role: SampleRole, step: number) => void
  nowPlayingRole: SampleRole | null
  nowPlayingAt: number
}) {
  const now = Date.now()
  const fresh = nowPlayingRole !== null && (now - nowPlayingAt) < NOW_PLAYING_MS

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
              color: i === currentStep ? '#00ffc8' : i % 4 === 0 ? '#71717a' : '#3f3f46',
              textShadow: i === currentStep ? '0 0 8px rgba(0,255,200,0.8)' : 'none',
            }}
          >
            {(i + 1).toString().padStart(2, '0')}
          </div>
        ))}
      </div>

      {/* Role rows */}
      <div className="space-y-1">
        {ROLES.map((role) => {
          const isNowPlaying = fresh && nowPlayingRole === role
          const color = ROLE_COLORS[role]
          return (
            <div
              key={role}
              className="flex items-center gap-1 rounded-sm transition-all"
              style={{
                backgroundColor: isNowPlaying ? `${color}10` : 'transparent',
                boxShadow: isNowPlaying ? `inset 0 0 12px ${color}30` : 'none',
              }}
            >
              <div
                className="w-11 font-mono text-[9px] font-bold uppercase tracking-wider"
                style={{
                  color,
                  textShadow: isNowPlaying ? `0 0 8px ${color}80` : 'none',
                }}
              >
                {ROLE_LABEL[role]}
              </div>
              <div className="flex flex-1 gap-1">
                {pattern[role]?.map((on, step) => {
                  const isActive = on
                  const isCurrent = step === currentStep
                  const isBeat = step % 4 === 0
                  return (
                    <button
                      key={step}
                      onClick={() => onToggle(role, step)}
                      aria-label={`${role} step ${step + 1} ${on ? 'on' : 'off'}`}
                      className="aspect-square flex-1 rounded-sm border transition-all hover:brightness-125"
                      style={{
                        backgroundColor: isActive ? color : isBeat ? 'rgba(39,39,42,0.9)' : 'rgba(24,24,27,0.8)',
                        borderColor: isCurrent ? '#00ffc8' : isActive ? color : isBeat ? '#3f3f46' : '#27272a',
                        boxShadow: isActive
                          ? `0 0 8px ${color}80`
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
          )
        })}
      </div>
    </div>
  )
}

// ─── Waveform Thumbnail (mini canvas from monoData) ──────────────────────────

function WaveformThumbnail({ data, color, width = 48, height = 18 }: { data: Float32Array; color: string; width?: number; height?: number }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // Clear.
    ctx.fillStyle = 'rgba(9,9,11,0.6)'
    ctx.fillRect(0, 0, width, height)

    // Compute peaks (downsample to width buckets, max abs value).
    const buckets = width
    const peaks: number[] = new Array(buckets).fill(0)
    const step = Math.max(1, Math.floor(data.length / buckets))
    for (let b = 0; b < buckets; b++) {
      let peak = 0
      const start = b * step
      const end = Math.min(data.length, start + step)
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i] ?? 0)
        if (v > peak) peak = v
      }
      peaks[b] = peak
    }

    // Draw bars.
    ctx.fillStyle = color
    const mid = height / 2
    for (let b = 0; b < buckets; b++) {
      const h = Math.max(1, peaks[b] * height * 0.9)
      ctx.fillRect(b, mid - h / 2, 1, h)
    }
  }, [data, color, width, height])

  return <canvas ref={canvasRef} style={{ width, height }} className="rounded-sm" />
}

// ─── Sample Library Browser ──────────────────────────────────────────────────

function SampleLibrary({
  samples,
  onAudition,
  nowPlayingSampleId,
  nowPlayingAt,
}: {
  samples: SampleAsset[]
  onAudition: (asset: SampleAsset) => void
  nowPlayingSampleId: string | null
  nowPlayingAt: number
}) {
  const now = Date.now()
  const fresh = nowPlayingSampleId !== null && (now - nowPlayingAt) < NOW_PLAYING_MS

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
          LIBRARY · {samples.length} samples
        </h2>
        <span className="font-mono text-[10px] text-zinc-500">click to audition</span>
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {samples.length === 0 ? (
          <div className="font-mono text-[10px] text-zinc-600">loading…</div>
        ) : (
          samples.map((s) => {
            const cat = s.metadata.category as SampleRole
            const color = ROLE_COLORS[cat] ?? '#71717a'
            const isPlaying = fresh && nowPlayingSampleId === s.metadata.id
            return (
              <button
                key={s.metadata.id}
                onClick={() => onAudition(s)}
                className="flex w-full items-center gap-2 rounded border bg-zinc-900/40 px-2 py-1 text-left transition-all hover:bg-zinc-800/60"
                style={{
                  borderColor: isPlaying ? color : '#27272a',
                  boxShadow: isPlaying ? `0 0 12px ${color}60, inset 0 0 8px ${color}20` : 'none',
                  backgroundColor: isPlaying ? `${color}10` : undefined,
                }}
              >
                <span
                  className="w-10 shrink-0 font-mono text-[9px] font-bold uppercase"
                  style={{ color, textShadow: isPlaying ? `0 0 6px ${color}80` : 'none' }}
                >
                  {s.metadata.category}
                </span>
                <WaveformThumbnail data={s.monoData} color={isPlaying ? '#ffffff' : color} width={48} height={18} />
                <span className="flex-1 truncate font-mono text-[10px] text-zinc-300">{s.metadata.id}</span>
                <span className="font-mono text-[9px] tabular-nums text-zinc-500">
                  {s.features.duration.toFixed(2)}s
                </span>
                {s.metadata.provenance.commercialUse ? (
                  <Badge className="border border-emerald-400/30 bg-emerald-500/10 px-1 py-0 font-mono text-[7px] uppercase text-emerald-300">
                    COMMERCIAL
                  </Badge>
                ) : (
                  <Badge className="border border-amber-400/30 bg-amber-500/10 px-1 py-0 font-mono text-[7px] uppercase text-amber-300">
                    NON-COMM
                  </Badge>
                )}
                <span className="font-mono text-[9px] text-zinc-600">▶</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Mixer Panel ─────────────────────────────────────────────────────────────

function Mixer({
  busState,
  onGain,
  onMute,
  onSolo,
}: {
  busState: Record<BusName, BusMixerState>
  onGain: (name: BusName, value: number) => void
  onMute: (name: BusName) => void
  onSolo: (name: BusName) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">MIXER · 3 buses</h2>
        <span className="font-mono text-[10px] text-zinc-500">drum · music · atmos</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {BUS_NAMES.map((name) => {
          const state = busState[name]
          const color = BUS_COLORS[name]
          const roles = BUS_ROLES[name]
          return (
            <div
              key={name}
              className="rounded border border-zinc-800 bg-zinc-900/40 p-2"
              style={state.muted ? { opacity: 0.4 } : undefined}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
                  {name}
                </span>
                <span className="font-mono text-[8px] text-zinc-600">{roles.length} roles</span>
              </div>
              {/* Vertical-ish gain slider (horizontal for compactness) */}
              <div className="flex items-center gap-1">
                <span className="font-mono text-[8px] text-zinc-600">G</span>
                <Slider
                  value={[state.gain]}
                  onValueChange={(v) => onGain(name, v[0]!)}
                  min={0}
                  max={1.2}
                  step={0.01}
                  className="flex-1"
                />
                <span className="w-7 font-mono text-[9px] tabular-nums" style={{ color }}>
                  {state.gain.toFixed(2)}
                </span>
              </div>
              {/* Mute + Solo buttons */}
              <div className="mt-2 flex gap-1">
                <button
                  onClick={() => onMute(name)}
                  className="flex-1 rounded border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-all"
                  style={{
                    borderColor: state.muted ? '#fbbf24' : '#3f3f46',
                    color: state.muted ? '#fbbf24' : '#71717a',
                    backgroundColor: state.muted ? 'rgba(251,191,36,0.1)' : 'transparent',
                  }}
                >
                  M
                </button>
                <button
                  onClick={() => onSolo(name)}
                  className="flex-1 rounded border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-all"
                  style={{
                    borderColor: state.solo ? '#00ffc8' : '#3f3f46',
                    color: state.solo ? '#00ffc8' : '#71717a',
                    backgroundColor: state.solo ? 'rgba(0,255,200,0.1)' : 'transparent',
                  }}
                >
                  S
                </button>
              </div>
              {/* Roles indicator */}
              <div className="mt-1.5 flex flex-wrap gap-0.5">
                {roles.map((r) => (
                  <span key={r} className="font-mono text-[7px] uppercase tracking-wider" style={{ color: ROLE_COLORS[r] }}>
                    {ROLE_LABEL[r].trim()}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Presets Panel ───────────────────────────────────────────────────────────

function PresetsPanel({ onLoad }: { onLoad: (preset: PatternPreset) => void }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">PRESETS · genre</h2>
        <span className="font-mono text-[10px] text-zinc-500">load pattern + bpm</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PATTERN_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onLoad(preset)}
            className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300 transition-all hover:border-emerald-400/50 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <div>{preset.name}</div>
            <div className="mt-0.5 text-[8px] font-normal text-zinc-500">{preset.bpm} BPM</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Pattern Slots ───────────────────────────────────────────────────────────

function PatternSlots({
  slotNames,
  onSave,
  onLoad,
  onClear,
}: {
  slotNames: string[]
  onSave: (slot: number) => void
  onLoad: (slot: number) => void
  onClear: (slot: number) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">SLOTS · save/load</h2>
        <span className="font-mono text-[10px] text-zinc-500">localStorage · 4 slots</span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {slotNames.map((name, i) => (
          <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">SLOT {i + 1}</span>
              {name ? (
                <span className="rounded bg-emerald-500/10 px-1 font-mono text-[7px] uppercase text-emerald-300">SAVED</span>
              ) : (
                <span className="rounded bg-zinc-800 px-1 font-mono text-[7px] uppercase text-zinc-600">EMPTY</span>
              )}
            </div>
            <div className="mb-1.5 truncate font-mono text-[10px] text-zinc-300" title={name}>
              {name || '—'}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => onSave(i)}
                className="flex-1 rounded border border-emerald-400/30 bg-emerald-500/10 px-1 py-0.5 font-mono text-[8px] uppercase text-emerald-300 hover:bg-emerald-500/20"
              >
                SAVE
              </button>
              <button
                onClick={() => onLoad(i)}
                disabled={!name}
                className="flex-1 rounded border border-fuchsia-400/30 bg-fuchsia-500/10 px-1 py-0.5 font-mono text-[8px] uppercase text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-30"
              >
                LOAD
              </button>
              <button
                onClick={() => onClear(i)}
                disabled={!name}
                className="rounded border border-amber-400/30 bg-amber-500/10 px-1 py-0.5 font-mono text-[8px] uppercase text-amber-300 hover:bg-amber-500/20 disabled:opacity-30"
              >
                CLR
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Visualizer (DPR-aware canvas) ───────────────────────────────────────────

function Visualizer({ analyser, isPlaying }: { analyser: AnalyserNode | null; isPlaying: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rafRef = React.useRef<number>(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    // DPR-aware sizing.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = 120
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.height = `${h}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }
    resize()

    // Observe container resize.
    const ro = new ResizeObserver(resize)
    if (containerRef.current) ro.observe(containerRef.current)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)

      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = 120

      // Trail-style clear.
      ctx.fillStyle = 'rgba(9,9,11,0.45)'
      ctx.fillRect(0, 0, w, h)

      const barCount = 64
      const barWidth = w / barCount
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * bufferLength * 0.7)
        const v = (dataArray[idx] ?? 0) / 255
        const barH = v * h * 0.95
        // Color zones: emerald → fuchsia → violet.
        const hue = i < barCount / 3 ? 160 : i < (barCount * 2) / 3 ? 325 : 280
        ctx.fillStyle = `hsla(${hue}, 100%, ${50 + v * 25}%, ${0.35 + v * 0.65})`
        ctx.fillRect(i * barWidth + 1, h - barH, Math.max(1, barWidth - 2), barH)

        // Reflection.
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${v * 0.2})`
        ctx.fillRect(i * barWidth + 1, h, Math.max(1, barWidth - 2), 2)
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [analyser, isPlaying])

  return (
    <div ref={containerRef} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">ANALYSER</h2>
        <span className="font-mono text-[9px] text-zinc-600">
          {isPlaying ? '● LIVE' : '○ IDLE'} · DPR-aware
        </span>
      </div>
      <canvas ref={canvasRef} className="w-full" style={{ height: 120 }} />
    </div>
  )
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
    if (!director) return
    exportStartedRef.current = false
    if (director.isRunning) {
      director.stop()
      // FIX Bug 1: actually stop audio — stop scheduler + panic voices.
      bundle?.scheduler.stop()
      bundle?.voicePool.panic()
      setIsPlaying(false)
    } else {
      director.start()
      // FIX Bug 1: restart scheduler for new playback.
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
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-fuchsia-300"
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
              className="h-10 gap-2 border border-violet-400/50 bg-zinc-900 font-mono text-xs font-bold uppercase tracking-[0.15em] text-violet-300 hover:bg-violet-500/10 disabled:opacity-50"
              style={{ boxShadow: exporting ? '0 0 16px rgba(185,103,255,0.6)' : '0 0 8px rgba(185,103,255,0.2)' }}
            >
              {exporting ? '● EXPORTING…' : '⬇ EXPORT WAV'}
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
