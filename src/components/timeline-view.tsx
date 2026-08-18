'use client'

// TimelineView — visual song arrangement display with moving playhead.

import * as React from 'react'
import type { Song } from '@/lib/song-persistence'

const SLOT_COLORS = ['#00ffc8', '#ff2e88', '#fbbf24', '#a78bfa']

export function TimelineView({
  song, songMode, currentSegment, currentBar, bpm,
}: {
  song: Song
  songMode: boolean
  currentSegment: number
  currentBar: number
  bpm: number
}) {
  const totalBars = song.segments.reduce((sum, s) => sum + s.bars, 0)
  const totalSec = totalBars * (60 / bpm) * 4
  const currentGlobalBar = song.segments.slice(0, currentSegment).reduce((s, seg) => s + seg.bars, 0) + currentBar
  const playheadPercent = totalBars > 0 ? (currentGlobalBar / totalBars) * 100 : 0

  if (song.segments.length === 0) {
    return (
      <div className="section rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2
            className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-300"
            style={{ '--c': '#f07dc2' } as React.CSSProperties}
          >
            TIMELINE
          </h2>
          <span className="font-mono text-[10px] text-zinc-600">no segments</span>
        </div>
        <div className="flex h-16 items-center justify-center font-mono text-[11px] text-zinc-600">
          add segments in the Song Editor below to see the timeline
        </div>
      </div>
    )
  }

  return (
    <div className="section rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-300"
          style={{ '--c': '#f07dc2' } as React.CSSProperties}
        >
          TIMELINE · {totalBars} bars · {totalSec.toFixed(1)}s
        </h2>
        <span className="font-mono text-[10px] text-zinc-500">
          {songMode ? `▶ bar ${currentGlobalBar}/${totalBars}` : '○ stopped'}
        </span>
      </div>
      <div className="mb-1 flex h-4 overflow-hidden rounded-sm border border-zinc-800 bg-zinc-900/50">
        {Array.from({ length: totalBars }).map((_, i) => (
          <div key={i} className="flex items-center justify-center border-r border-zinc-800/50 font-mono text-[8px] text-zinc-600" style={{ width: `${100 / totalBars}%` }}>
            {(i + 1) % 4 === 0 || i === 0 ? i + 1 : ''}
          </div>
        ))}
      </div>
      <div className="relative flex h-12 overflow-hidden rounded-sm border border-zinc-700 bg-zinc-900/70">
        {song.segments.map((seg, i) => {
          const widthPercent = (seg.bars / totalBars) * 100
          const color = SLOT_COLORS[seg.slot % 4]!
          const isCurrent = songMode && i === currentSegment
          return (
            <div key={i} className="relative flex items-center justify-center border-r border-zinc-950 transition-all"
              style={{ width: `${widthPercent}%`, backgroundColor: isCurrent ? color : `${color}40`, boxShadow: isCurrent ? `inset 0 0 12px ${color}80` : 'none' }}
              title={`Segment ${String.fromCharCode(65 + i)}: slot ${seg.slot + 1} · ${seg.bars} bars`}
            >
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: isCurrent ? '#000' : color }}>
                {String.fromCharCode(65 + (i % 26))}·{seg.bars}
              </span>
            </div>
          )
        })}
        {songMode && (
          <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white"
            style={{ left: `${playheadPercent}%`, boxShadow: '0 0 8px rgba(255,255,255,0.8)', transition: 'left 0.1s linear' }}
          >
            <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
          </div>
        )}
      </div>
      <div className="mt-1 flex">
        {song.segments.map((seg, i) => (
          <div key={i} className="text-center font-mono text-[9px] text-zinc-500" style={{ width: `${(seg.bars / totalBars) * 100}%` }}>
            slot{seg.slot + 1}
          </div>
        ))}
      </div>
    </div>
  )
}
