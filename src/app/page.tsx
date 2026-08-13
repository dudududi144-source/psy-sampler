'use client'

// PSY Sampler — demo host UI.
//
// The ONLY user-visible route of the sampler demo. Instantiates the full device
// stack on first user gesture (browser policy), drives a 16-step pattern via
// DemoDirector, and visualizes the AudioGraph output. Dark psytrance aesthetic
// — emerald/cyan, fuchsia, violet neon accents on near-black. NO indigo/blue.
//
// All imports are client-safe (no fs, no server-only code).

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
  DemoTransport,
  type PsyDevice,
  type MusicalContext,
  type DeviceCapabilities,
  type MusicalEvent,
  type MusicalTransport,
} from '@/psy-foundation-shim'
import { DemoDirector, DEFAULT_PATTERN, type Pattern } from '@/lib/demo-director'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useToast } from '@/hooks/use-toast'
import {
  Activity,
  AlertTriangle,
  AudioLines,
  Boxes,
  FileText,
  Layers,
  Loader2,
  Play,
  Power,
  Radio,
  Square,
  Waves,
  Zap,
} from 'lucide-react'

// ─── ReferenceDevice stub ───────────────────────────────────────────────────
// A trivial observability counter. Proves multi-device coexistence: both this
// device and the SamplerDevice receive every published NoteEvent through the
// shared InMemoryChannel + DeviceHost fan-out.
class ReferenceDeviceStub implements PsyDevice {
  readonly id = 'psy-reference-counter'
  eventsReceived = 0

  capabilities(): DeviceCapabilities {
    return {
      audio: false,
      midi: false,
      inputs: 0,
      outputs: 0,
      voices: 0,
      latencyMs: 0,
      roles: ['reference'],
    }
  }

  onTransport(_t: MusicalTransport): void {
    /* no-op */
  }

  onContext(_c: MusicalContext): void {
    /* no-op */
  }

  onEvent(_e: MusicalEvent): void {
    this.eventsReceived += 1
  }

  onStart?(): void {
    /* no-op */
  }

  onStop?(): void {
    /* no-op */
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────
const PATTERN_ROLES: SampleRole[] = [
  'kick',
  'bass',
  'lead',
  'hat-closed',
  'clap',
  'perc',
]

const SECTION_OPTIONS = ['INTRO', 'BUILD', 'DROP', 'BREAK', 'RISER'] as const
type SectionName = (typeof SECTION_OPTIONS)[number]

// Neon palette per role — emerald / fuchsia / violet / mint / yellow / lime.
// NO indigo, NO blue.
const ROLE_COLORS: Record<
  SampleRole,
  { hex: string; soft: string; ring: string }
> = {
  kick: {
    hex: '#00ffc8',
    soft: 'rgba(0,255,200,0.20)',
    ring: 'rgba(0,255,200,0.55)',
  },
  bass: {
    hex: '#ff2e88',
    soft: 'rgba(255,46,136,0.20)',
    ring: 'rgba(255,46,136,0.55)',
  },
  lead: {
    hex: '#b967ff',
    soft: 'rgba(185,103,255,0.20)',
    ring: 'rgba(185,103,255,0.55)',
  },
  'hat-closed': {
    hex: '#7dffd1',
    soft: 'rgba(125,255,209,0.18)',
    ring: 'rgba(125,255,209,0.55)',
  },
  'hat-open': {
    hex: '#ff7eb6',
    soft: 'rgba(255,126,182,0.18)',
    ring: 'rgba(255,126,182,0.55)',
  },
  clap: {
    hex: '#ffe066',
    soft: 'rgba(255,224,102,0.18)',
    ring: 'rgba(255,224,102,0.55)',
  },
  perc: {
    hex: '#9eff5c',
    soft: 'rgba(158,255,92,0.18)',
    ring: 'rgba(158,255,92,0.55)',
  },
  texture: {
    hex: '#b967ff',
    soft: 'rgba(185,103,255,0.18)',
    ring: 'rgba(185,103,255,0.55)',
  },
  fx: {
    hex: '#ff2e88',
    soft: 'rgba(255,46,136,0.18)',
    ring: 'rgba(255,46,136,0.55)',
  },
}

const BPM_MIN = 100
const BPM_MAX = 180

// ─── Helper: pretty-print license ───────────────────────────────────────────
function shortLicense(s: string): string {
  if (!s) return '—'
  if (s.length <= 48) return s
  return s.slice(0, 45) + '…'
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function HomePage() {
  // ── Refs (persist across renders) ──────────────────────────────────────────
  const audioCtxRef = React.useRef<AudioContext | null>(null)
  const channelRef = React.useRef<InMemoryChannel | null>(null)
  const hostRef = React.useRef<DeviceHost | null>(null)
  const transportRef = React.useRef<DemoTransport | null>(null)
  const bundleRef = React.useRef<SamplerBundle | null>(null)
  const directorRef = React.useRef<DemoDirector | null>(null)
  const refDeviceRef = React.useRef<ReferenceDeviceStub | null>(null)
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)

  // ── State (drives re-renders) ───────────────────────────────────────────────
  const [audioReady, setAudioReady] = React.useState(false)
  const [loadingSamples, setLoadingSamples] = React.useState(false)
  const [loadResult, setLoadResult] = React.useState<{
    loaded: number
    skipped: number
    total: number
  } | null>(null)
  const [initError, setInitError] = React.useState<string | null>(null)

  const [isPlaying, setIsPlaying] = React.useState(false)
  const [bpm, setBpm] = React.useState(145)
  const [section, setSection] = React.useState<SectionName>('DROP')
  const [energy, setEnergy] = React.useState(0.7)
  const [currentStep, setCurrentStep] = React.useState<number>(-1)
  const [pattern, setPattern] = React.useState<Pattern>(() =>
    structuredClone(DEFAULT_PATTERN),
  )
  const [samples, setSamples] = React.useState<SampleAsset[]>([])
  const [deviceStats, setDeviceStats] = React.useState({
    samplerEvents: 0,
    samplerNotesTriggered: 0,
    samplerNotesSkipped: 0,
    samplerActiveVoices: 0,
    samplerPendingEvents: 0,
    refEvents: 0,
    deviceCount: 0,
  })

  const { toast } = useToast()

  // ── Initialize the entire device stack on first user gesture ────────────────
  const initializeAudio = React.useCallback(async () => {
    if (audioCtxRef.current) return
    setInitError(null)
    try {
      // 1. AudioContext (created on user gesture — browser policy).
      const Ctx: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      await ctx.resume()
      audioCtxRef.current = ctx

      // 2. Channel + 3. Host.
      const channel = new InMemoryChannel('psy-sampler-demo')
      channelRef.current = channel
      const host = new DeviceHost(channel)
      hostRef.current = host

      // 4. Transport.
      const transport = new DemoTransport({
        audioContext: ctx,
        initialBpm: bpm,
        beatsPerBar: 4,
      })
      transportRef.current = transport

      // 5. Sampler bundle (wires library + selectionPolicy + scheduler + audioGraph + voicePool + device).
      const bundle = createSamplerDevice({
        audioContext: ctx,
        manifestUrl: '/samples/manifest.json',
        onLoaded: (r) => setLoadResult(r),
      })
      bundleRef.current = bundle

      // 6. Reference stub — proves multi-device coexistence.
      const refDevice = new ReferenceDeviceStub()
      refDeviceRef.current = refDevice

      // Register both devices before loading samples. The host calls onStart
      // for each, but the sampler's scheduler is happy to idle without samples.
      host.register(bundle.device)
      host.register(refDevice)

      // 7. Director — drives NoteEvents on a 16-step grid.
      const director = new DemoDirector(
        {
          host,
          transport,
          audioContext: ctx,
          bpm,
          initialPattern: structuredClone(DEFAULT_PATTERN),
        },
        (step) => setCurrentStep(step),
      )
      directorRef.current = director

      setAudioReady(true)

      // 8. Load samples asynchronously, update UI on completion.
      setLoadingSamples(true)
      try {
        const result = await bundle.load()
        setSamples(bundle.library.list())
        toast({
          title: 'PSY Sampler ready',
          description: `${result.loaded}/${result.total} samples loaded · ${result.skipped} skipped`,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setInitError(`Sample load failed: ${msg}`)
        toast({
          variant: 'destructive',
          title: 'Sample load failed',
          description: msg,
        })
      } finally {
        setLoadingSamples(false)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setInitError(`Audio init failed: ${msg}`)
      toast({
        variant: 'destructive',
        title: 'Audio init failed',
        description: msg,
      })
    }
  }, [bpm, toast])

  // ── Cleanup on unmount ──────────────────────────────────────────────────────
  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      directorRef.current?.stop()
      hostRef.current?.dispose()
      channelRef.current?.close()
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {
          /* ignore */
        })
      }
    }
  }, [])

  // ── Poll device stats (voices, events, ref counter) ─────────────────────────
  React.useEffect(() => {
    if (!audioReady) return
    const id = window.setInterval(() => {
      const bundle = bundleRef.current
      const ref = refDeviceRef.current
      const host = hostRef.current
      if (!bundle || !ref || !host) return
      setDeviceStats({
        samplerEvents: bundle.device.eventsReceived,
        samplerNotesTriggered: bundle.device.notesTriggered,
        samplerNotesSkipped: bundle.device.notesSkipped,
        samplerActiveVoices: bundle.device.activeVoices,
        samplerPendingEvents: bundle.device.pendingEvents,
        refEvents: ref.eventsReceived,
        deviceCount: host.deviceCount,
      })
    }, 200)
    return () => window.clearInterval(id)
  }, [audioReady])

  // ── Resize visualizer canvas (DPR-aware) ────────────────────────────────────
  React.useEffect(() => {
    if (!audioReady) return
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [audioReady])

  // ── Visualizer animation loop ───────────────────────────────────────────────
  React.useEffect(() => {
    if (!audioReady) return
    const canvas = canvasRef.current
    const bundle = bundleRef.current
    if (!canvas || !bundle) return
    const analyser = bundle.audioGraph.analyser
    if (!analyser) return

    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    const binCount = analyser.frequencyBinCount // 128 (fftSize=256)
    const freqData = new Uint8Array(binCount)
    const timeData = new Uint8Array(binCount)

    const draw = () => {
      const w = canvas.width
      const h = canvas.height

      // Background fill + subtle vignette.
      ctx2d.fillStyle = 'rgba(7,7,11,0.55)'
      ctx2d.fillRect(0, 0, w, h)

      // Faint scanline grid.
      ctx2d.strokeStyle = 'rgba(0,255,200,0.04)'
      ctx2d.lineWidth = 1
      for (let y = 0; y < h; y += 24) {
        ctx2d.beginPath()
        ctx2d.moveTo(0, y)
        ctx2d.lineTo(w, y)
        ctx2d.stroke()
      }

      // Frequency bars (bottom 55%).
      analyser.getByteFrequencyData(freqData)
      const barWidth = w / binCount
      for (let i = 0; i < binCount; i++) {
        const v = freqData[i] / 255
        if (v <= 0.01) continue
        const barH = v * h * 0.55
        const t = i / binCount
        let r: number, g: number, b: number
        if (t < 0.33) {
          // low band → fuchsia
          r = 255
          g = 46
          b = 136
        } else if (t < 0.66) {
          // mid band → violet
          r = 185
          g = 103
          b = 255
        } else {
          // high band → emerald
          r = 0
          g = 255
          b = 200
        }
        const a = 0.35 + v * 0.6
        ctx2d.fillStyle = `rgba(${r},${g},${b},${a})`
        ctx2d.fillRect(i * barWidth, h - barH, barWidth - 1, barH)
      }

      // Waveform line (centered).
      analyser.getByteTimeDomainData(timeData)
      ctx2d.lineWidth = 2
      ctx2d.strokeStyle = 'rgba(0,255,200,0.9)'
      ctx2d.shadowBlur = 14
      ctx2d.shadowColor = 'rgba(0,255,200,0.65)'
      ctx2d.beginPath()
      const sliceWidth = w / binCount
      let x = 0
      for (let i = 0; i < binCount; i++) {
        const v = timeData[i] / 128.0
        const y = (v * h) / 2
        if (i === 0) ctx2d.moveTo(x, y)
        else ctx2d.lineTo(x, y)
        x += sliceWidth
      }
      ctx2d.stroke()
      ctx2d.shadowBlur = 0

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [audioReady])

  // ── Transport handlers ──────────────────────────────────────────────────────
  const handlePlayStop = () => {
    const director = directorRef.current
    const ctx = audioCtxRef.current
    if (!director || !ctx) return
    if (isPlaying) {
      director.stop()
      setIsPlaying(false)
      setCurrentStep(-1)
    } else {
      // Ensure AudioContext is resumed (browsers may suspend after backgrounding).
      if (ctx.state !== 'running') {
        ctx.resume().catch(() => {
          /* ignore */
        })
      }
      director.start()
      setIsPlaying(true)
    }
  }

  const handleBpm = (val: number[]) => {
    const v = val[0]
    setBpm(v)
    directorRef.current?.setBpm(v)
  }

  const handleSection = (s: string) => {
    setSection(s as SectionName)
    directorRef.current?.setContext({ section: s })
  }

  const handleEnergy = (val: number[]) => {
    const v = val[0]
    setEnergy(v)
    directorRef.current?.setContext({ energy: v })
  }

  const handleToggleStep = (role: SampleRole, step: number) => {
    directorRef.current?.toggleStep(role, step)
    if (directorRef.current) {
      setPattern(structuredClone(directorRef.current.getPattern()))
    }
  }

  // ── Pre-init overlay (browser policy: AudioContext on user gesture) ─────────
  if (!audioReady) {
    return (
      <InitOverlay
        onInit={initializeAudio}
        loading={loadingSamples}
        error={initError}
        loadResult={loadResult}
      />
    )
  }

  const totalSamples = samples.length
  const allCommercial =
    totalSamples > 0 &&
    samples.every((s) => s.metadata.provenance.commercialUse)

  return (
    <div className="relative min-h-screen flex flex-col bg-zinc-950 text-zinc-100 font-sans">
      {/* Ambient glow background */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-60"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 10%, rgba(255,46,136,0.10), transparent 60%), radial-gradient(55% 45% at 85% 20%, rgba(185,103,255,0.10), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(0,255,200,0.08), transparent 60%)',
        }}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-4">
          <div className="flex items-center gap-3">
            <div
              className="grid size-11 place-items-center rounded-xl border border-emerald-400/40 bg-zinc-900 shadow-[0_0_22px_rgba(0,255,200,0.35)]"
              style={{ boxShadow: '0 0 22px rgba(0,255,200,0.35)' }}
            >
              <Waves className="size-6 text-emerald-300" />
            </div>
            <div>
              <h1 className="font-mono text-2xl font-bold leading-none tracking-[0.18em] sm:text-3xl">
                <span className="bg-gradient-to-r from-emerald-300 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                  PSY SAMPLER
                </span>
              </h1>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500 sm:text-[11px]">
                Canonical family member · demo host
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] sm:gap-3 sm:text-xs">
            <StatBadge
              icon={<Boxes className="size-3.5" />}
              label="devices"
              value={deviceStats.deviceCount.toString()}
              color="emerald"
            />
            <StatBadge
              icon={<Activity className="size-3.5" />}
              label="events"
              value={deviceStats.samplerEvents.toLocaleString()}
              color="emerald"
            />
            <StatBadge
              icon={<Layers className="size-3.5" />}
              label="voices"
              value={`${deviceStats.samplerActiveVoices}/32`}
              color={deviceStats.samplerActiveVoices > 0 ? 'fuchsia' : 'zinc'}
            />
            <StatBadge
              icon={<Zap className="size-3.5" />}
              label="pending"
              value={deviceStats.samplerPendingEvents.toString()}
              color="violet"
            />
            <StatBadge
              icon={<Radio className="size-3.5" />}
              label="ref·events"
              value={deviceStats.refEvents.toLocaleString()}
              color="violet"
            />
            <div
              className="flex items-center gap-2 rounded-md border border-fuchsia-500/40 bg-zinc-900/70 px-3 py-1.5"
              style={{ boxShadow: '0 0 14px rgba(255,46,136,0.18)' }}
            >
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                bpm
              </span>
              <span className="text-base font-bold tabular-nums text-fuchsia-300">
                {bpm.toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Transport bar ──────────────────────────────────────────────────── */}
      <section className="sticky top-[64px] z-20 border-b border-zinc-800/70 bg-zinc-950/75 backdrop-blur-md md:top-[76px]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 md:gap-5">
          <Button
            onClick={handlePlayStop}
            disabled={loadingSamples}
            className="h-11 min-w-[140px] gap-2 border border-emerald-400/40 bg-zinc-900 font-mono text-sm font-semibold uppercase tracking-[0.15em] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:opacity-50"
            style={{
              boxShadow: isPlaying
                ? '0 0 22px rgba(255,46,136,0.55)'
                : '0 0 18px rgba(0,255,200,0.35)',
            }}
            variant="outline"
          >
            {isPlaying ? (
              <>
                <Square className="size-4 fill-current" />
                Stop
              </>
            ) : (
              <>
                <Play className="size-4 fill-current" />
                Play
              </>
            )}
          </Button>

          {/* BPM slider */}
          <div className="flex min-w-[180px] flex-1 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              bpm
            </span>
            <Slider
              min={BPM_MIN}
              max={BPM_MAX}
              step={1}
              value={[bpm]}
              onValueChange={handleBpm}
              className="flex-1"
            />
            <span className="w-10 text-right font-mono text-sm font-bold tabular-nums text-emerald-300">
              {bpm.toFixed(0)}
            </span>
          </div>

          {/* Section selector */}
          <div className="flex min-w-[160px] items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              section
            </span>
            <Select value={section} onValueChange={handleSection}>
              <SelectTrigger className="h-8 flex-1 border-zinc-700 bg-zinc-900 font-mono text-sm text-violet-300 hover:border-violet-500/50 focus-visible:ring-violet-500/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-700 bg-zinc-900 font-mono text-violet-200">
                {SECTION_OPTIONS.map((s) => (
                  <SelectItem
                    key={s}
                    value={s}
                    className="font-mono uppercase tracking-wider data-[highlighted]:bg-violet-500/15 data-[highlighted]:text-violet-200"
                  >
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Energy slider */}
          <div className="flex min-w-[180px] flex-1 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              energy
            </span>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[energy]}
              onValueChange={handleEnergy}
              className="flex-1"
            />
            <span className="w-10 text-right font-mono text-sm font-bold tabular-nums text-fuchsia-300">
              {energy.toFixed(2)}
            </span>
          </div>

          {loadingSamples && (
            <Badge
              variant="outline"
              className="gap-1.5 border-amber-500/40 bg-amber-500/10 font-mono text-[11px] text-amber-300"
            >
              <Loader2 className="size-3 animate-spin" />
              loading
            </Badge>
          )}
        </div>
      </section>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          {/* Pattern editor */}
          <Card className="border-zinc-800/80 bg-zinc-900/50 shadow-[0_0_30px_rgba(0,255,200,0.04)]">
            <CardHeader className="border-b border-zinc-800/70 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AudioLines className="size-4 text-emerald-300" />
                  <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-zinc-200">
                    16-step pattern
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(0,255,200,0.7)]" />
                    active
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full bg-fuchsia-400 shadow-[0_0_8px_rgba(255,46,136,0.7)]" />
                    current step
                  </span>
                </div>
              </div>
              <CardDescription className="font-mono text-[11px] text-zinc-500">
                click any cell to toggle. director plays these 16 steps per bar,
                6 visible roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto pt-4">
              <div className="min-w-[640px]">
                {/* Step ruler */}
                <div
                  className="mb-2 grid gap-1 font-mono text-[10px] text-zinc-600"
                  style={{ gridTemplateColumns: '72px repeat(16, minmax(0,1fr))' }}
                >
                  <div />
                  {Array.from({ length: 16 }, (_, i) => (
                    <div
                      key={i}
                      className={`text-center tabular-nums ${
                        i % 4 === 0 ? 'text-zinc-400' : 'text-zinc-700'
                      } ${currentStep === i ? 'text-emerald-300' : ''}`}
                    >
                      {(i + 1).toString().padStart(2, '0')}
                    </div>
                  ))}
                </div>

                {/* Rows */}
                <div className="flex flex-col gap-1">
                  {PATTERN_ROLES.map((role) => {
                    const row = pattern[role] ?? []
                    const color = ROLE_COLORS[role]
                    return (
                      <div
                        key={role}
                        className="grid items-center gap-1"
                        style={{
                          gridTemplateColumns:
                            '72px repeat(16, minmax(0,1fr))',
                        }}
                      >
                        <div
                          className="truncate rounded px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider"
                          style={{
                            color: color.hex,
                            background: color.soft,
                          }}
                        >
                          {role}
                        </div>
                        {Array.from({ length: 16 }, (_, i) => {
                          const active = !!row[i]
                          const isCurrent = currentStep === i && isPlaying
                          const beatStart = i % 4 === 0
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleToggleStep(role, i)}
                              aria-pressed={active}
                              aria-label={`${role} step ${i + 1}`}
                              className={`relative aspect-square w-full rounded-[5px] border transition-all duration-100 ${
                                beatStart
                                  ? 'border-zinc-600'
                                  : 'border-zinc-800'
                              } ${
                                active
                                  ? 'hover:brightness-110'
                                  : 'bg-zinc-900/60 hover:bg-zinc-800/70'
                              } ${isCurrent ? 'ring-2 ring-offset-1 ring-offset-zinc-900' : ''}`}
                              style={{
                                background: active ? color.hex : undefined,
                                borderColor: active
                                  ? color.hex
                                  : undefined,
                                boxShadow: active
                                  ? `0 0 10px ${color.ring}, inset 0 0 6px rgba(255,255,255,0.18)`
                                  : undefined,
                                ...(isCurrent
                                  ? {
                                      boxShadow: `0 0 14px ${color.ring}, 0 0 22px ${color.ring}`,
                                    }
                                  : {}),
                              }}
                            >
                              {isCurrent && (
                                <span
                                  className="absolute inset-0 animate-pulse rounded-[5px]"
                                  style={{
                                    background: `${color.soft}`,
                                  }}
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>

                {/* Footer row: current step indicator */}
                <div
                  className="mt-3 grid items-center gap-1 border-t border-zinc-800/70 pt-3 font-mono text-[10px] text-zinc-500"
                  style={{ gridTemplateColumns: '72px repeat(16, minmax(0,1fr))' }}
                >
                  <div className="uppercase tracking-wider">step</div>
                  {Array.from({ length: 16 }, (_, i) => (
                    <div
                      key={i}
                      className="flex justify-center"
                    >
                      <span
                        className={`size-1.5 rounded-full transition-all ${
                          currentStep === i && isPlaying
                            ? 'bg-fuchsia-400 shadow-[0_0_10px_rgba(255,46,136,0.8)]'
                            : 'bg-zinc-800'
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Sample library */}
          <Card className="border-zinc-800/80 bg-zinc-900/50 shadow-[0_0_30px_rgba(255,46,136,0.04)]">
            <CardHeader className="border-b border-zinc-800/70 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Boxes className="size-4 text-fuchsia-300" />
                  <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-zinc-200">
                    sample library
                  </CardTitle>
                </div>
                <Badge
                  variant="outline"
                  className="border-fuchsia-500/40 bg-fuchsia-500/10 font-mono text-[11px] text-fuchsia-300"
                >
                  {samples.length} loaded
                </Badge>
              </div>
              <CardDescription className="font-mono text-[11px] text-zinc-500">
                {loadResult
                  ? `${loadResult.loaded}/${loadResult.total} loaded · ${loadResult.skipped} skipped`
                  : 'loading manifest…'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[24rem] w-full overflow-y-auto rounded-md border border-zinc-800/50 bg-zinc-950/40 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent">
                <ul className="divide-y divide-zinc-800/60">
                  {samples.length === 0 && (
                    <li className="px-3 py-6 text-center font-mono text-xs text-zinc-600">
                      no samples loaded
                    </li>
                  )}
                  {samples.map((s) => {
                    const prov = s.metadata.provenance
                    return (
                      <li
                        key={s.metadata.id}
                        className="flex flex-col gap-1.5 px-3 py-2.5 transition-colors hover:bg-zinc-800/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-zinc-200">
                            {s.metadata.id}
                          </span>
                          <Badge
                            variant="outline"
                            className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${
                              prov.commercialUse
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-red-500/40 bg-red-500/10 text-red-300'
                            }`}
                          >
                            {prov.commercialUse ? 'commercial' : 'restricted'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
                          <span className="text-emerald-400/80">
                            cat·{s.metadata.category}
                          </span>
                          <span className="text-violet-400/80">
                            sub·{s.metadata.subcategory}
                          </span>
                          <span className="text-zinc-600">
                            {s.features.duration.toFixed(2)}s
                          </span>
                          <span className="text-zinc-600">
                            {s.features.sampleRate / 1000}kHz
                          </span>
                        </div>
                        <div className="truncate font-mono text-[10px] text-zinc-600">
                          {shortLicense(prov.license)}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Visualizer */}
        <Card className="mt-5 border-zinc-800/80 bg-zinc-900/50 shadow-[0_0_30px_rgba(185,103,255,0.05)]">
          <CardHeader className="border-b border-zinc-800/70 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Waves className="size-4 text-violet-300" />
                <CardTitle className="font-mono text-sm uppercase tracking-[0.2em] text-zinc-200">
                  master analyser
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-fuchsia-400" />
                  low
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-violet-400" />
                  mid
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-emerald-400" />
                  high
                </span>
              </div>
            </div>
            <CardDescription className="font-mono text-[11px] text-zinc-500">
              reads from bundle.audioGraph.analyser · fftSize=256 · frequency +
              waveform
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="relative h-56 w-full overflow-hidden rounded-lg border border-zinc-800 bg-black sm:h-64">
              <canvas ref={canvasRef} className="block h-full w-full" />
              {!isPlaying && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="flex flex-col items-center gap-2 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-zinc-600">
                    <Power className="size-5" />
                    press play to drive the analyser
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </main>

      {/* ── Footer (sticky bottom) ────────────────────────────────────────── */}
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-4">
          <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-500">
            <span className="bg-gradient-to-r from-emerald-300 via-fuchsia-400 to-violet-400 bg-clip-text font-semibold text-transparent">
              PSY Sampler Device
            </span>
            <span className="text-zinc-700">—</span>
            <span className="uppercase tracking-[0.15em]">
              canonical family member
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-zinc-500">
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            >
              {totalSamples} samples
            </Badge>
            <Badge
              variant="outline"
              className={`${
                allCommercial
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              }`}
            >
              {allCommercial
                ? 'all commercially usable'
                : 'license review needed'}
            </Badge>
            <a
              href="/PSY-SAMPLER-ARCHITECTURE-AUDIT.md"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 uppercase tracking-wider text-violet-300 transition-colors hover:border-violet-400/60 hover:bg-violet-500/20"
            >
              <FileText className="size-3" />
              audit doc
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── StatBadge sub-component ─────────────────────────────────────────────────
function StatBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: 'emerald' | 'fuchsia' | 'violet' | 'zinc'
}) {
  const palette: Record<typeof color, { text: string; border: string; bg: string; glow: string }> = {
    emerald: {
      text: 'text-emerald-300',
      border: 'border-emerald-500/40',
      bg: 'bg-emerald-500/10',
      glow: '0 0 12px rgba(0,255,200,0.18)',
    },
    fuchsia: {
      text: 'text-fuchsia-300',
      border: 'border-fuchsia-500/40',
      bg: 'bg-fuchsia-500/10',
      glow: '0 0 12px rgba(255,46,136,0.22)',
    },
    violet: {
      text: 'text-violet-300',
      border: 'border-violet-500/40',
      bg: 'bg-violet-500/10',
      glow: '0 0 12px rgba(185,103,255,0.18)',
    },
    zinc: {
      text: 'text-zinc-400',
      border: 'border-zinc-700',
      bg: 'bg-zinc-900/60',
      glow: 'none',
    },
  }
  const p = palette[color]
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md border ${p.border} ${p.bg} px-2.5 py-1.5`}
      style={{ boxShadow: p.glow === 'none' ? undefined : p.glow }}
    >
      <span className={p.text}>{icon}</span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <span className={`font-bold tabular-nums ${p.text}`}>{value}</span>
    </div>
  )
}

// ─── InitOverlay sub-component ───────────────────────────────────────────────
function InitOverlay({
  onInit,
  loading,
  error,
  loadResult,
}: {
  onInit: () => void
  loading: boolean
  error: string | null
  loadResult: { loaded: number; skipped: number; total: number } | null
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100 font-sans">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 20%, rgba(255,46,136,0.15), transparent 60%), radial-gradient(55% 45% at 80% 30%, rgba(185,103,255,0.15), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(0,255,200,0.10), transparent 60%)',
        }}
      />
      <div className="relative z-10 grid min-h-screen place-items-center px-6">
        <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
          <div
            className="grid size-20 place-items-center rounded-2xl border border-emerald-400/40 bg-zinc-900 shadow-[0_0_40px_rgba(0,255,200,0.45)]"
            style={{ boxShadow: '0 0 40px rgba(0,255,200,0.45)' }}
          >
            <Waves className="size-10 text-emerald-300" />
          </div>
          <div>
            <h1 className="font-mono text-4xl font-bold tracking-[0.18em]">
              <span className="bg-gradient-to-r from-emerald-300 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">
                PSY SAMPLER
              </span>
            </h1>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.3em] text-zinc-500">
              canonical family member · demo host
            </p>
          </div>
          <p className="font-mono text-xs leading-relaxed text-zinc-500">
            instantiates AudioContext, InMemoryChannel, DeviceHost,
            SamplerDevice, ReferenceDevice stub, DemoDirector. the browser
            requires a user gesture before any audio can play.
          </p>

          <Button
            onClick={onInit}
            disabled={loading}
            className="h-12 min-w-[220px] gap-2 border border-emerald-400/50 bg-zinc-900 font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:opacity-50"
            style={{ boxShadow: '0 0 28px rgba(0,255,200,0.5)' }}
            variant="outline"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                initializing…
              </>
            ) : (
              <>
                <Power className="size-4" />
                click to initialize audio
              </>
            )}
          </Button>

          {loadResult && !error && (
            <div className="font-mono text-[11px] text-emerald-400">
              {loadResult.loaded}/{loadResult.total} samples loaded ·{' '}
              {loadResult.skipped} skipped
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-left font-mono text-[11px] text-red-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 font-mono text-[10px] text-zinc-600">
            <span className="uppercase tracking-[0.2em]">stack:</span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-emerald-400/80">
              AudioContext
            </span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-fuchsia-400/80">
              InMemoryChannel
            </span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-violet-400/80">
              DeviceHost
            </span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-emerald-400/80">
              SamplerDevice
            </span>
            <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-fuchsia-400/80">
              DemoDirector
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
