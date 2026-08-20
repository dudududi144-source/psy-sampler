'use client'

// SampleLibrary — scrollable list of loaded samples with audition + waveform thumbnail
// + COMMERCIAL / NON-COMM badge + now-playing highlight.

import * as React from 'react'
import type { SampleAsset, SampleRole } from '@/psy-sampler'
import { Badge } from '@/components/ui/badge'
import {
  ROLES,
  ROLE_COLORS,
  NOW_PLAYING_MS,
} from '@/components/types'
import { ScrubableWaveform } from '@/components/scrubable-waveform'

// ─── Waveform Thumbnail (mini canvas from monoData) ──────────────────────────

export function WaveformThumbnail({ data, color, width = 48, height = 18 }: { data: Float32Array; color: string; width?: number; height?: number }) {
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

type SortMode = 'category' | 'name' | 'duration'

export function SampleLibrary({
  samples,
  onAudition,
  onRemove,
  nowPlayingSampleId,
  nowPlayingAt,
}: {
  samples: SampleAsset[]
  onAudition: (asset: SampleAsset) => void
  onRemove?: (sampleId: string) => void
  nowPlayingSampleId: string | null
  nowPlayingAt: number
}) {
  const now = Date.now()
  const fresh = nowPlayingSampleId !== null && (now - nowPlayingAt) < NOW_PLAYING_MS

  // Phase 2.1: search + filter + sort state.
  const [search, setSearch] = React.useState('')
  const [filterRole, setFilterRole] = React.useState<SampleRole | 'all'>('all')
  const [sortMode, setSortMode] = React.useState<SortMode>('category')

  // Phase 2.2: expanded preview state. Clicking a sample's "preview" button
  // expands a large scrubable waveform below the row.
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  // Play fraction for the expanded preview's playhead (0..1).
  const [previewFraction, setPreviewFraction] = React.useState(0)
  // RAF handle for the playhead animation.
  const rafRef = React.useRef<number | null>(null)
  // Track the timestamp when preview playback started, for playhead animation.
  const previewStartRef = React.useRef<{ audioCtxTime: number; sampleDuration: number; sampleRate: number } | null>(null)

  // Cancel any pending playhead animation on unmount.
  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  // Apply search + filter + sort. useMemo so we don't recompute on every render
  // (only when inputs change).
  const displayed = React.useMemo(() => {
    let list = samples
    // Search filter (case-insensitive, matches ID or category).
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((s) =>
        s.metadata.id.toLowerCase().includes(q) ||
        s.metadata.category.toLowerCase().includes(q),
      )
    }
    // Role filter.
    if (filterRole !== 'all') {
      list = list.filter((s) => s.metadata.category === filterRole)
    }
    // Sort.
    const sorted = [...list]
    switch (sortMode) {
      case 'category':
        sorted.sort((a, b) =>
          a.metadata.category.localeCompare(b.metadata.category) ||
          a.metadata.id.localeCompare(b.metadata.id),
        )
        break
      case 'name':
        sorted.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id))
        break
      case 'duration':
        sorted.sort((a, b) => a.features.duration - b.features.duration)
        break
    }
    return sorted
  }, [samples, search, filterRole, sortMode])

  // Tag counts for the role filter buttons.
  const roleCounts = React.useMemo(() => {
    const counts: Partial<Record<SampleRole, number>> = {}
    for (const s of samples) {
      const cat = s.metadata.category as SampleRole
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts
  }, [samples])

  return (
    <div className="section p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
          style={{ '--c': '#b8e05a' } as React.CSSProperties}
        >
          LIBRARY · {samples.length} samples
        </h2>
        <span className="font-mono text-[10px]" style={{ color: '#5b6470' }}>
          {displayed.length === samples.length ? 'click to audition' : `${displayed.length} shown`}
        </span>
      </div>

      {/* Phase 2.1: Search + sort controls */}
      <div className="mb-2 flex flex-wrap gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search id or role…"
          className="min-w-[140px] flex-1 rounded border px-2 py-1 font-mono text-[10px]"
          style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
        />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="rounded border px-1 py-1 font-mono text-[10px]"
          style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
          title="Sort mode"
        >
          <option value="category">by category</option>
          <option value="name">by name</option>
          <option value="duration">by duration</option>
        </select>
      </div>

      {/* Role filter — tag chips */}
      <div className="mb-3 flex flex-wrap gap-1">
        <button
          onClick={() => setFilterRole('all')}
          className="rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider hover:brightness-125"
          style={{
            borderColor: filterRole === 'all' ? '#b8e05a' : '#3a4150',
            color: filterRole === 'all' ? '#b8e05a' : '#9aa3af',
            background: filterRole === 'all' ? 'rgba(184,224,90,0.1)' : 'transparent',
          }}
        >
          ALL · {samples.length}
        </button>
        {ROLES.map((r) => {
          const count = roleCounts[r]
          if (!count) return null
          const active = filterRole === r
          const color = ROLE_COLORS[r]
          return (
            <button
              key={r}
              onClick={() => setFilterRole(active ? 'all' : r)}
              className="rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider hover:brightness-125"
              style={{
                borderColor: active ? color : '#3a4150',
                color: active ? color : '#9aa3af',
                background: active ? `${color}10` : 'transparent',
              }}
            >
              {r} · {count}
            </button>
          )
        })}
      </div>

      <div className="max-h-72 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {samples.length === 0 ? (
          <div className="font-mono text-[10px]" style={{ color: '#5b6470' }}>loading…</div>
        ) : displayed.length === 0 ? (
          <div className="font-mono text-[10px]" style={{ color: '#5b6470' }}>no samples match filter</div>
        ) : (
          displayed.map((s) => {
            const cat = s.metadata.category as SampleRole
            const color = ROLE_COLORS[cat] ?? '#71717a'
            const isPlaying = fresh && nowPlayingSampleId === s.metadata.id
            return (
              <div key={s.metadata.id}>
              <div
                className="flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded border px-2 py-1 text-left transition-all hover:brightness-125"
                style={{
                  borderColor: isPlaying ? color : '#232932',
                  boxShadow: isPlaying ? `0 0 12px ${color}60, inset 0 0 8px ${color}20` : 'none',
                  backgroundColor: isPlaying ? `${color}10` : 'rgba(20,22,28,0.4)',
                }}
              >
                <button
                  onClick={() => onAudition(s)}
                  className="preset flex flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="w-10 shrink-0 font-mono text-[11px] font-bold uppercase"
                    style={{ color, textShadow: isPlaying ? `0 0 6px ${color}80` : 'none' }}
                  >
                    {s.metadata.category}
                  </span>
                  <WaveformThumbnail data={s.monoData} color={isPlaying ? '#ffffff' : color} width={48} height={18} />
                  <span className="flex-1 truncate font-mono text-[10px]" style={{ color: '#cfd6df' }}>{s.metadata.id}</span>
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: '#5b6470' }}>
                    {s.features.duration.toFixed(2)}s
                  </span>
                  {s.metadata.provenance.commercialUse ? (
                    <Badge
                      className="border border-emerald-400/30 bg-emerald-500/10 px-1 py-0 font-mono text-[10px] uppercase"
                      style={{ color: '#86f7ff' }}
                    >
                      COMMERCIAL
                    </Badge>
                  ) : (
                    <Badge
                      className="border border-amber-400/30 bg-amber-500/10 px-1 py-0 font-mono text-[10px] uppercase"
                      style={{ color: '#fbbf24' }}
                    >
                      NON-COMM
                    </Badge>
                  )}
                </button>
                {onRemove && (
                  <button
                    onClick={() => onRemove(s.metadata.id)}
                    className="shrink-0 touch-manipulation rounded border  px-1.5 py-0.5 font-mono text-[10px]  hover:brightness-125"
                    title={`Remove ${s.metadata.id}`}
                  >
                    DEL
                  </button>
                )}
                {/* Phase 2.2: expand/collapse preview */}
                <button
                  onClick={() => {
                    setExpandedId(expandedId === s.metadata.id ? null : s.metadata.id)
                    setPreviewFraction(0)
                    previewStartRef.current = null
                  }}
                  className="shrink-0 touch-manipulation rounded border px-1.5 py-0.5 font-mono text-[10px] hover:brightness-125"
                  style={{
                    borderColor: expandedId === s.metadata.id ? color : '#3a4150',
                    color: expandedId === s.metadata.id ? color : '#9aa3af',
                  }}
                  title="Toggle large preview"
                >
                  {expandedId === s.metadata.id ? '−' : '+'}
                </button>
              </div>
              {/* Phase 2.2: expanded scrubable waveform */}
              {expandedId === s.metadata.id && (
                <div className="mt-2">
                  <ScrubableWaveform
                    data={s.monoData}
                    sampleRate={s.features.sampleRate}
                    color={color}
                    onScrub={(fraction) => {
                      // Trigger audition from this position. For MVP we just
                      // call onAudition (full sample). True scrub-from-position
                      // would require modifying onAudition to accept an offset —
                      // future enhancement.
                      onAudition(s)
                      // Animate playhead across the sample's duration.
                      previewStartRef.current = {
                        audioCtxTime: 0, // would need AudioContext ref
                        sampleDuration: s.features.duration,
                        sampleRate: s.features.sampleRate,
                      }
                      setPreviewFraction(fraction)
                      // Animate the playhead for the sample's duration.
                      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
                      const startTime = performance.now()
                      const duration = s.features.duration * 1000 // ms
                      const animate = () => {
                        const elapsed = performance.now() - startTime
                        const frac = (fraction * duration + elapsed) / duration
                        if (frac >= 1) {
                          setPreviewFraction(0)
                          previewStartRef.current = null
                          rafRef.current = null
                          return
                        }
                        setPreviewFraction(Math.min(1, frac))
                        rafRef.current = requestAnimationFrame(animate)
                      }
                      rafRef.current = requestAnimationFrame(animate)
                    }}
                    playFraction={previewFraction}
                    height={50}
                  />
                  <div className="mt-1 flex justify-between font-mono text-[9px]" style={{ color: '#5b6470' }}>
                    <span>0:00</span>
                    <span>click anywhere to preview from that point</span>
                    <span>{s.features.duration.toFixed(2)}s</span>
                  </div>
                </div>
              )}
              </div>
          )
          })
        )}
      </div>
    </div>
  )
}
