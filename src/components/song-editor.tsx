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

function SongEditorImpl({
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
          {songMode ? 'PLAYING' : 'SONG'}
        </button>
      </div>

      {/* Segment list */}
      {song.segments.length === 0 ? (
        <div className="py-4 text-center font-mono text-[11px]" style={{ color: '#5b6470' }}>
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
                <span className="w-6 shrink-0 font-mono text-[10px] tabular-nums" style={{ color: '#5b6470' }}>
                  {String.fromCharCode(65 + (i % 26))}
                </span>

                {/* Slot selector */}
                <select
                  value={seg.slot}
                  onChange={(e) => updateSegment(i, { slot: parseInt(e.target.value) })}
                  disabled={songMode}
                  className="min-h-[36px] touch-manipulation rounded border px-2 py-1 font-mono text-[11px] disabled:opacity-50"
                  style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
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
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border font-mono text-xs disabled:opacity-50"
                    style={{ borderColor: '#282e38', background: '#14161c', color: '#9aa3af' }}
                  >
                    -
                  </button>
                  <span className="w-12 text-center font-mono text-[11px] tabular-nums" style={{ color: '#cfd6df' }}>
                    {seg.bars} bar{seg.bars !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => updateSegment(i, { bars: Math.min(64, seg.bars + 1) })}
                    disabled={songMode}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border font-mono text-xs disabled:opacity-50"
                    style={{ borderColor: '#282e38', background: '#14161c', color: '#9aa3af' }}
                  >
                    +
                  </button>
                </div>

                {/* Phase 3.2: Follow Action — jump to target after bars */}
                {song.segments.length > 1 && (
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[9px] uppercase" style={{ color: '#5b6470' }}>FOLLOW</span>
                    <select
                      value={seg.followAction ? seg.followAction.targetIndex : -1}
                      onChange={(e) => {
                        const target = parseInt(e.target.value)
                        if (target === -1) {
                          updateSegment(i, { followAction: undefined })
                        } else {
                          updateSegment(i, { followAction: { targetIndex: target, probability: seg.followAction?.probability ?? 1 } })
                        }
                      }}
                      disabled={songMode}
                      className="rounded border px-1 py-0.5 font-mono text-[9px] disabled:opacity-50"
                      style={{ borderColor: '#282e38', background: '#14161c', color: '#9aa3af' }}
                      title="After this segment, jump to..."
                    >
                      <option value={-1}>next</option>
                      {song.segments.map((_, si) => (
                        <option key={si} value={si}>
                          {si === i ? `loop (seg ${si + 1})` : `seg ${si + 1}`}
                        </option>
                      ))}
                    </select>
                    {seg.followAction && (
                      <>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={seg.followAction.probability}
                          onChange={(e) => updateSegment(i, {
                            followAction: { ...seg.followAction!, probability: parseFloat(e.target.value) }
                          })}
                          disabled={songMode}
                          className="h-1.5 w-12"
                          style={{ accentColor: '#c084fc' }}
                          title="Probability of following the action"
                        />
                        <span className="font-mono text-[9px] tabular-nums" style={{ color: '#5b6470' }}>
                          {Math.round(seg.followAction.probability * 100)}%
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* Progress indicator (when playing this segment) */}
                {isCurrent && (
                  <span className="font-mono text-[10px] tabular-nums ">
                    bar {currentBar}/{seg.bars}
                  </span>
                )}

                {/* Move + delete buttons */}
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => moveSegment(i, -1)}
                    disabled={songMode || i === 0}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border font-mono text-xs disabled:opacity-30"
                    style={{ borderColor: '#282e38', background: '#14161c', color: '#9aa3af' }}
                    title="Move up"
                  >
                    UP
                  </button>
                  <button
                    onClick={() => moveSegment(i, 1)}
                    disabled={songMode || i === song.segments.length - 1}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border font-mono text-xs disabled:opacity-30"
                    style={{ borderColor: '#282e38', background: '#14161c', color: '#9aa3af' }}
                    title="Move down"
                  >
                    DN
                  </button>
                  <button
                    onClick={() => removeSegment(i)}
                    disabled={songMode}
                    className="min-h-[36px] w-[36px] touch-manipulation rounded border border-red-500/30 font-mono text-xs text-red-400 disabled:opacity-30"
                    style={{ background: '#14161c' }}
                    title="Remove segment"
                  >
                    DEL
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
            className="min-h-[36px] touch-manipulation rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-30"
            style={{ borderColor: '#282e38', background: '#14161c', color: '#9aa3af' }}
            title={`Add segment: play slot ${idx + 1} for 4 bars`}
          >
            + {name || `slot ${idx + 1}`}
          </button>
        ))}
      </div>

      {/* Total duration */}
      {song.segments.length > 0 && (
        <div className="mt-2 font-mono text-[10px]" style={{ color: '#5b6470' }}>
          {song.segments.length} segment{song.segments.length !== 1 ? 's' : ''} · {song.segments.reduce((a, s) => a + s.bars, 0)} bars total
        </div>
      )}
    </div>
  )
}

// Phase 7.3.1: React.memo
export const SongEditor = React.memo(SongEditorImpl)
