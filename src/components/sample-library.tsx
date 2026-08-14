'use client'

// SampleLibrary — scrollable list of loaded samples with audition + waveform thumbnail
// + COMMERCIAL / NON-COMM badge + now-playing highlight.

import * as React from 'react'
import type { SampleAsset, SampleRole } from '@/psy-sampler'
import { Badge } from '@/components/ui/badge'
import {
  ROLE_COLORS,
  NOW_PLAYING_MS,
} from '@/components/types'

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

export function SampleLibrary({
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
                className="flex min-h-[44px] w-full touch-manipulation items-center gap-2 rounded border bg-zinc-900/40 px-2 py-1 text-left transition-all hover:bg-zinc-800/60"
                style={{
                  borderColor: isPlaying ? color : '#27272a',
                  boxShadow: isPlaying ? `0 0 12px ${color}60, inset 0 0 8px ${color}20` : 'none',
                  backgroundColor: isPlaying ? `${color}10` : undefined,
                }}
              >
                <span
                  className="w-10 shrink-0 font-mono text-[11px] font-bold uppercase"
                  style={{ color, textShadow: isPlaying ? `0 0 6px ${color}80` : 'none' }}
                >
                  {s.metadata.category}
                </span>
                <WaveformThumbnail data={s.monoData} color={isPlaying ? '#ffffff' : color} width={48} height={18} />
                <span className="flex-1 truncate font-mono text-[10px] text-zinc-300">{s.metadata.id}</span>
                <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                  {s.features.duration.toFixed(2)}s
                </span>
                {s.metadata.provenance.commercialUse ? (
                  <Badge className="border border-emerald-400/30 bg-emerald-500/10 px-1 py-0 font-mono text-[10px] uppercase text-emerald-300">
                    COMMERCIAL
                  </Badge>
                ) : (
                  <Badge className="border border-amber-400/30 bg-amber-500/10 px-1 py-0 font-mono text-[10px] uppercase text-amber-300">
                    NON-COMM
                  </Badge>
                )}
                <span className="font-mono text-[11px] text-zinc-600">▶</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
