'use client'

// AutomationEditor — draw parameter automation breakpoints on a timeline.

import * as React from 'react'
import type { AutomationBank, AutomationTarget } from '@/lib/automation'
import { sampleTrack } from '@/lib/automation'

const TARGETS: Array<{ target: AutomationTarget; label: string; min: number; max: number; unit: string; color: string }> = [
  { target: 'masterFilter.freq', label: 'FLT FREQ', min: 20, max: 20000, unit: 'Hz', color: '#60a5fa' },
  { target: 'master.gain', label: 'MASTER', min: 0, max: 1.2, unit: '', color: '#a78bfa' },
  { target: 'bus.drum.gain', label: 'DRUM G', min: 0, max: 1.2, unit: '', color: '#00ffc8' },
  { target: 'bus.music.gain', label: 'MUSIC G', min: 0, max: 1.2, unit: '', color: '#ff2e88' },
  { target: 'bus.atmos.gain', label: 'ATMOS G', min: 0, max: 1.2, unit: '', color: '#b967ff' },
  { target: 'bus.drum.saturation', label: 'DRUM SAT', min: 0, max: 10, unit: '', color: '#fb923c' },
]

const TRACK_HEIGHT = 48
const TIMELINE_DURATION = 32

export function AutomationEditor({
  bank, dirty, enabled, onToggle, onAddPoint, onClearTrack,
}: {
  bank: AutomationBank
  dirty: number
  enabled: boolean
  onToggle: () => void
  onAddPoint: (target: AutomationTarget, time: number, value: number) => void
  onClearTrack: (target: AutomationTarget) => void
}) {
  void dirty
  const handleClick = (target: AutomationTarget, e: React.MouseEvent<HTMLDivElement>, min: number, max: number) => {
    if (enabled) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const time = (x / rect.width) * TIMELINE_DURATION
    const value = max - (y / rect.height) * (max - min)
    onAddPoint(target, Math.max(0, time), value)
  }

  return (
    <div className="section p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
          style={{ '--c': '#fbbf24' } as React.CSSProperties}
        >
          AUTOMATION · {TIMELINE_DURATION}s
        </h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500">
            {bank.activeTracks.length} active · {bank.activeTracks.reduce((s, t) => s + t.points.length, 0)} pts
          </span>
          <button onClick={onToggle}
            className="touch-manipulation min-h-[36px] rounded border px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider transition-all"
            style={{
              borderColor: enabled ? '#f472b6' : '#3f3f46',
              color: enabled ? '#f472b6' : '#71717a',
              backgroundColor: enabled ? 'rgba(244,114,182,0.1)' : 'transparent',
              boxShadow: enabled ? '0 0 12px rgba(244,114,182,0.4)' : 'none',
            }}
            title="Toggle automation — applies parameter changes over time during playback"
          >
            {enabled ? 'RUNNING' : 'AUTO'}
          </button>
        </div>
      </div>
      <div className="mb-1 flex h-4 overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/50">
        {Array.from({ length: TIMELINE_DURATION }).map((_, i) => (
          <div key={i} className="flex items-center justify-center border-r border-zinc-800/50 font-mono text-[8px] text-zinc-600" style={{ width: `${100 / TIMELINE_DURATION}%` }}>
            {i % 4 === 0 ? `${i}s` : ''}
          </div>
        ))}
      </div>
      <div className="space-y-1">
        {TARGETS.map(({ target, label, min, max, unit, color }) => {
          const track = bank.get(target)
          const points = track.points
          return (
            <div key={target} className="flex items-center gap-2">
              <div className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wider" style={{ color }}>{label}</div>
              <div onClick={(e) => handleClick(target, e, min, max)}
                className="relative flex-1 cursor-crosshair overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/70"
                style={{ height: TRACK_HEIGHT, opacity: enabled ? 0.5 : 1 }}
                title={enabled ? 'Stop automation to edit' : 'Click to add breakpoint'}
              >
                <div className="absolute left-0 right-0 top-1/2 border-t border-zinc-800/50" />
                {points.length >= 2 && (
                  <svg className="absolute inset-0 pointer-events-none" width="100%" height={TRACK_HEIGHT} preserveAspectRatio="none" viewBox={`0 0 ${TIMELINE_DURATION} ${TRACK_HEIGHT}`}>
                    <polyline
                      points={points.map((p) => {
                        const x = (p.time / TIMELINE_DURATION) * TIMELINE_DURATION
                        const y = TRACK_HEIGHT - ((p.value - min) / (max - min)) * TRACK_HEIGHT
                        return `${x},${y}`
                      }).join(' ')}
                      fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
                {points.map((p, i) => {
                  const x = (p.time / TIMELINE_DURATION) * 100
                  const y = TRACK_HEIGHT - ((p.value - min) / (max - min)) * TRACK_HEIGHT
                  return (
                    <div key={i} className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                      style={{ left: `${x}%`, top: `${y}px`, backgroundColor: color, borderColor: '#000', boxShadow: `0 0 4px ${color}80` }}
                    />
                  )
                })}
                {enabled && (
                  <div className="pointer-events-none absolute right-1 top-1 font-mono text-[9px] tabular-nums" style={{ color }}>
                    {sampleTrack(track, 0).toFixed(1)}{unit}
                  </div>
                )}
              </div>
              {points.length > 0 && (
                <button onClick={() => onClearTrack(target)} disabled={enabled}
                  className="min-h-[36px] w-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-400 disabled:opacity-30"
                  title="Clear all breakpoints"
                >CLR</button>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-2 font-mono text-[10px] text-zinc-600">
        click on a track to add a breakpoint · line shows interpolation · {enabled ? 'running — stop to edit' : 'ready'}
      </div>
    </div>
  )
}
