'use client'

// SongEditor — UX4 (ROADMAP-TO-100).
//
// Lets the user build a song arrangement by chaining saved pattern slots
// (0-3) into a sequence of segments. Each segment specifies which slot to
// play and for how many bars.
//
// Example: [slot 0, 4 bars] → [slot 1, 4 bars] → [slot 0, 4 bars] → [slot 2, 8 bars]
// = A→B→A→C arrangement.
//
// When SONG mode is enabled (via the transport bar toggle), the director
// advances through segments at bar boundaries, automatically swapping the
// pattern. When the last segment ends, playback stops.

import * as React from 'react'
import type { Song, SongSegment } from '@/lib/song-persistence'

export function SongEditor({
  song,
  slotNames,
  songMode,
  currentSegment,
  currentBar,
  onChange,
  onToggleSongMode,
}: {
  song: Song
  slotNames: string[]
  songMode: boolean
  currentSegment: number
  currentBar: number
  onChange: (song: Song) => void
  onToggleSongMode: () => void
}) {
  const addSegment = (slot: number) => {
    onChange({
      ...song,
      segments: [...song.segments, { slot, bars: 4 }],
    })
  }

  const removeSegment = (index: number) => {
    onChange({
      ...song,
      segments: song.segments.filter((_, i) => i !== index),
    })
  }

  const updateSegment = (index: number, patch: Partial<SongSegment>) => {
    onChange({
      ...song,
      segments: song.segments.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    })
  }

  const moveSegment = (index: number, dir: -1 | 1) => {
    const newIndex = index + dir
    if (newIndex < 0 || newIndex >= song.segments.length) return
    const segments = [...song.segments]
    const tmp = segments[index]!
    segments[index] = segments[newIndex]!
    segments[newIndex] = tmp
    onChange({ ...song, segments })
  }

  return (
    <div className="section p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
          style={{ '--c': '#c084fc' } as React.CSSProperties}
        >
          SONG · arrangement
        </h2>
        <button
          onClick={onToggleSongMode}
          disabled={song.segments.length === 0}
          className="touch-manipulation min-h-[44px] rounded border px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-30"
          style={{
            borderColor: songMode ? '#22d3ee' : '#3f3f46',
            color: songMode ? '#22d3ee' : '#71717a',
            backgroundColor: songMode ? 'rgba(34,211,238,0.1)' : 'transparent',
            boxShadow: songMode ? '0 0 12px rgba(34,211,238,0.4)' : 'none',
          }}
          title="Toggle song mode — plays segments in sequence"
        >
          {songMode ? '● PLAYING' : '○ SONG'}
        </button>
      </div>

      {/* Segment list */}
      {song.segments.length === 0 ? (
        <div className="py-4 text-center font-mono text-[11px] text-zinc-600">
          no segments — add one below to build an arrangement
        </div>
      ) : (
        <div className="space-y-1">
          {song.segments.map((seg, i) => {
            const isCurrent = songMode && i === currentSegment
            const slotName = slotNames[seg.slot] || `slot ${seg.slot + 1}`
            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded border p-1.5 transition-all"
                style={{
                  borderColor: isCurrent ? '#22d3ee' : '#27272a',
                  backgroundColor: isCurrent ? 'rgba(34,211,238,0.08)' : 'rgba(24,24,27,0.5)',
                  boxShadow: isCurrent ? '0 0 8px rgba(34,211,238,0.3)' : 'none',
                }}
              >
                {/* Segment index */}
                <span className="w-6 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                  {String.fromCharCode(65 + (i % 26))}
                </span>

                {/* Slot selector */}
                <select
                  value={seg.slot}
                  onChange={(e) => updateSegment(i, { slot: parseInt(e.target.value) })}
                  disabled={songMode}
                  className="min-h-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[11px] text-zinc-200 disabled:opacity-50"
                >
                  {slotNames.map((name, idx) => (
                    <option key={idx} value={idx}>
                      {name || `slot ${idx + 1}`}
                    </option>
                  ))}
                </select>

                {/* Bars input */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateSegment(i, { bars: Math.max(1, seg.bars - 1) })}
                    disabled={songMode}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-400 disabled:opacity-50"
                  >
                    −
                  </button>
                  <span className="w-12 text-center font-mono text-[11px] tabular-nums text-zinc-300">
                    {seg.bars} bar{seg.bars !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => updateSegment(i, { bars: Math.min(64, seg.bars + 1) })}
                    disabled={songMode}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-400 disabled:opacity-50"
                  >
                    +
                  </button>
                </div>

                {/* Progress indicator (when playing this segment) */}
                {isCurrent && (
                  <span className="font-mono text-[10px] tabular-nums text-cyan-300">
                    bar {currentBar}/{seg.bars}
                  </span>
                )}

                {/* Move + delete buttons */}
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => moveSegment(i, -1)}
                    disabled={songMode || i === 0}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-400 disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveSegment(i, 1)}
                    disabled={songMode || i === song.segments.length - 1}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-400 disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeSegment(i)}
                    disabled={songMode}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border border-red-500/30 bg-zinc-900 font-mono text-xs text-red-400 disabled:opacity-30"
                    title="Remove segment"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add segment buttons */}
      <div className="mt-3 flex flex-wrap gap-1">
        {slotNames.map((name, idx) => (
          <button
            key={idx}
            onClick={() => addSegment(idx)}
            disabled={songMode}
            className="min-h-[36px] touch-manipulation rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400 transition-all hover:bg-zinc-800 disabled:opacity-30"
            title={`Add segment: play slot ${idx + 1} for 4 bars`}
          >
            + {name || `slot ${idx + 1}`}
          </button>
        ))}
      </div>

      {/* Total duration */}
      {song.segments.length > 0 && (
        <div className="mt-2 font-mono text-[10px] text-zinc-600">
          {song.segments.length} segment{song.segments.length !== 1 ? 's' : ''} · {song.segments.reduce((a, s) => a + s.bars, 0)} bars total
        </div>
      )}
    </div>
  )
}
