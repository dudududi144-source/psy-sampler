'use client'

// SampleSlicer — transient-detection slicer for drum loops.
//
// When the user drops a multi-hit audio file (drum loop, percussion phrase,
// ambience with onsets) they can either import it whole OR slice it into
// individual hits. This component runs spectral-flux onset detection on the
// decoded buffer, shows the waveform with slice markers, lets the user adjust
// sensitivity, audition slices, and finally push all slices into the library
// as separate samples (with proper provenance per slice).
//
// Flow:
//   1. SampleImporter decodes the dropped WAV into an AudioBuffer + file metadata.
//   2. The user picks "SLICE" instead of "IMPORT" — SampleImporter opens us.
//   3. We compute onsets via detectOnsets() on a mono downmix.
//   4. We render the waveform + slice markers + a sensitivity slider.
//   5. The user clicks a slice to audition it (a short clip via BufferSource).
//   6. The user picks a role per slice (kick / snare / hat / perc / fx).
//   7. On "SLICE N SAMPLES" we sliceAudioBuffer() the source + emit one
//      onImport callback per slice. SampleImporter (parent) routes those
//      into library.addFromBuffer.

import * as React from 'react'
import { detectOnsets, sliceAudioBuffer, toMono, estimateBpmFromOnsets } from '@/psy-sampler'
import type { Onset } from '@/psy-sampler'
import type { SampleAsset, SampleCategory, SampleProvenance } from '@/psy-sampler'
import { ROLES, ROLE_COLORS, ROLE_LABEL } from '@/components/types'

interface SliceRow {
  /** Onset time in seconds (start of the slice). */
  start: number
  /** End of the slice in seconds (start of next slice, or buffer end). */
  end: number
  /** Detected strength (normalised spectral flux). */
  strength: number
  /** Role the user assigned to this slice. */
  role: SampleCategory
  /** Whether the user wants to keep this slice (some onsets are false positives). */
  keep: boolean
  /** Sliced AudioBuffer (computed once when first requested, cached). */
  buffer?: AudioBuffer
}

export interface SampleSlicerProps {
  audioContext: AudioContext | null
  /** The decoded source buffer (the original drum loop). */
  buffer: AudioBuffer
  /** Original file name (used to derive slice IDs). */
  fileName: string
  /** Shared provenance template (license/author/source/commercialUse). */
  provenance: Omit<SampleProvenance, 'dateAcquired'>
  /** Called once per emitted slice. Caller adds to library. */
  onImport: (asset: SampleAsset) => void
  /** Called when the user cancels / closes the slicer. */
  onCancel: () => void
  /** Optional: reconstruct the current pattern from slice timing. Called
   * with a per-role list of {step, sliceIndex} mappings + the detected BPM.
   * The page wireframe applies this to the director + pattern state. */
  onReconstruct?: (reconstruction: {
    /** Detected BPM (or 0 if unknown). Page can apply this as the new tempo. */
    bpm: number
    /** Map role → list of {step, sliceIdx} entries. */
    placements: Record<string, Array<{ step: number; sliceIdx: number }>>
  }) => void
}

export function SampleSlicer({
  audioContext,
  buffer,
  fileName,
  provenance,
  onImport,
  onCancel,
  onReconstruct,
}: SampleSlicerProps) {
  // ─── Compute mono downmix (derived value, no ref) ────────────────────────
  const mono = React.useMemo(() => toMono(buffer), [buffer])

  const [sensitivity, setSensitivity] = React.useState(0.5)
  const [auditioning, setAuditioning] = React.useState<number | null>(null)

  // Re-run detection when buffer or sensitivity changes.
  const onsets = React.useMemo(
    () => detectOnsets(mono, buffer.sampleRate, { sensitivity }),
    [mono, buffer.sampleRate, sensitivity],
  )

  // Estimate BPM from onset spacing.
  const bpmEstimate = React.useMemo(
    () => estimateBpmFromOnsets(onsets),
    [onsets],
  )

  // ─── User overrides per slice (kept + role) — keyed by slice index ────────
  // Default role/keep derive from pickDefaultRole; user can override per-row.
  const [overrides, setOverrides] = React.useState<
    Partial<Record<number, { role?: SampleCategory; keep?: boolean }>>
  >({})

  // Build slice rows from onsets + overrides.
  const rows: SliceRow[] = React.useMemo(() => {
    return onsets.map((o, i) => {
      const end = i + 1 < onsets.length ? onsets[i + 1].time : buffer.duration
      const ov = overrides[i] ?? {}
      return {
        start: o.time,
        end,
        strength: o.strength,
        role: ov.role ?? pickDefaultRole(i, onsets.length),
        keep: ov.keep ?? true,
      }
    })
  }, [onsets, overrides, buffer.duration])

  // ─── Audition a single slice via BufferSource ─────────────────────────────
  const auditionSlice = React.useCallback(
    (row: SliceRow, idx: number) => {
      if (!audioContext) return
      const slices = sliceAudioBuffer(buffer, [row.start, row.end])
      const sliced = slices[0]
      if (!sliced) return
      const src = audioContext.createBufferSource()
      src.buffer = sliced
      src.connect(audioContext.destination)
      src.start()
      src.onended = () => {
        setAuditioning((cur) => (cur === idx ? null : cur))
      }
      setAuditioning(idx)
    },
    [audioContext, buffer],
  )

  // ─── Emit all kept slices as separate samples ─────────────────────────────
  const emitSlices = React.useCallback(() => {
    const kept = rows.filter((r) => r.keep)
    if (kept.length === 0) return
    const onsetTimes = kept.map((r) => r.start)
    const slices = sliceAudioBuffer(buffer, onsetTimes)
    const baseId = fileName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24) || 'slice'
    kept.forEach((row, i) => {
      const sliced = slices[i]
      if (!sliced) return
      const id = `${baseId}-${i + 1}`
      const monoData = toMono(sliced)
      let peak = 0
      let sumSq = 0
      for (let j = 0; j < monoData.length; j++) {
        const s = Math.abs(monoData[j])
        if (s > peak) peak = s
        sumSq += monoData[j] * monoData[j]
      }
      const rms = monoData.length > 0 ? Math.sqrt(sumSq / monoData.length) : 0
      const asset: SampleAsset = {
        metadata: {
          id,
          file: `slice:${id}`,
          category: row.role,
          subcategory: 'sliced',
          provenance: {
            ...provenance,
            dateAcquired: new Date().toISOString().slice(0, 10),
          },
          character: {
            character: ['sliced', 'loop-cut'],
            genreFit: [],
            bpmRange: [60, 200],
            rootNote: 60,
          },
          duration: sliced.duration,
          sampleRate: sliced.sampleRate,
          channels: sliced.numberOfChannels,
        },
        audioBuffer: sliced,
        monoData,
        features: {
          peak,
          rms,
          duration: sliced.duration,
          sampleRate: sliced.sampleRate,
          channels: sliced.numberOfChannels,
        },
      }
      onImport(asset)
    })
    onCancel()
  }, [rows, buffer, fileName, provenance, onImport, onCancel])

  // ─── Reconstruct pattern from slice timing ──────────────────────────────
  // Maps each slice to a pattern step based on its onset time and the
  // detected BPM. The user gets back the original loop's groove, with
  // slices auto-assigned to the role they picked in the slicer UI.
  const reconstructPattern = React.useCallback(() => {
    if (!onReconstruct) return
    const kept = rows.filter((r) => r.keep)
    if (kept.length === 0) return
    const bpm = bpmEstimate.bpm > 0 ? bpmEstimate.bpm : 120
    // If confidence is low or BPM unknown, default to 16-step pattern.
    // secPerStep = 60 / (bpm * 4) [16th notes]
    const secPerStep = 60 / (bpm * 4)
    const maxStep = 32 // cap at 32-step pattern
    // Map each kept slice to a step index. Snap to nearest step.
    const placements: Record<string, Array<{ step: number; sliceIdx: number }>> = {}
    kept.forEach((row, i) => {
      const step = Math.min(maxStep - 1, Math.max(0, Math.round(row.start / secPerStep)))
      const role = row.role
      if (!placements[role]) placements[role] = []
      // Avoid duplicate steps for the same role (later slice wins).
      const existing = placements[role].find(p => p.step === step)
      if (existing) {
        existing.sliceIdx = i
      } else {
        placements[role].push({ step, sliceIdx: i })
      }
    })
    onReconstruct({ bpm, placements })
  }, [rows, bpmEstimate, onReconstruct])

  // ─── Render ────────────────────────────────────────────────────────────────
  const keptCount = rows.filter((r) => r.keep).length
  return (
    <div
      className="section p-4"
      style={{ borderColor: '#22d3ee', background: 'rgba(8,18,24,0.95)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
          style={{ '--c': '#22d3ee' } as React.CSSProperties}
        >
          SLICER · {onsets.length} onsets · {keptCount} kept
        </h2>
        <span className="font-mono text-[10px]" style={{ color: '#5b6470' }}>
          {fileName} · {buffer.duration.toFixed(2)}s · {buffer.sampleRate}Hz
        </span>
      </div>

      {/* BPM estimate — shown if we have enough onsets for a confident guess */}
      {bpmEstimate.bpm > 0 && (
        <div
          className="mb-3 flex items-center justify-between rounded border px-3 py-1.5 font-mono text-[11px]"
          style={{
            borderColor: bpmEstimate.confidence > 0.5 ? '#22d3ee80' : '#3a4150',
            background: 'rgba(34,211,238,0.06)',
          }}
        >
          <span>
            <span style={{ color: '#22d3ee', fontWeight: 'bold' }}>ESTIMATED BPM:</span>{' '}
            <span style={{ color: '#cfd6df' }}>{bpmEstimate.bpm}</span>
          </span>
          <span style={{ color: '#5b6470' }}>
            {bpmEstimate.noteValue} notes · confidence {(bpmEstimate.confidence * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* Waveform + slice markers */}
      <SlicerWaveform
        mono={mono}
        sampleRate={buffer.sampleRate}
        onsets={onsets}
        rows={rows}
      />

      {/* Sensitivity slider */}
      <div className="mt-3 flex items-center gap-3">
        <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>
          sensitivity
        </span>
        <input
          type="range"
          min={0.1}
          max={0.95}
          step={0.05}
          value={sensitivity}
          onChange={(e) => setSensitivity(parseFloat(e.target.value))}
          className="h-2 flex-1"
          style={{ accentColor: '#22d3ee' }}
        />
        <span className="w-10 text-right font-mono text-[11px] tabular-nums" style={{ color: '#9aa3af' }}>
          {sensitivity.toFixed(2)}
        </span>
      </div>

      {/* Slice list */}
      <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {rows.length === 0 ? (
          <div className="font-mono text-[10px]" style={{ color: '#5b6470' }}>
            no onsets detected — try lowering sensitivity
          </div>
        ) : (
          rows.map((row, idx) => {
            const color = ROLE_COLORS[row.role]
            const isAud = auditioning === idx
            return (
              <div
                key={idx}
                className="flex min-h-[40px] touch-manipulation items-center gap-2 rounded border px-2 py-1"
                style={{
                  borderColor: row.keep ? color : '#3a4150',
                  backgroundColor: row.keep ? `${color}10` : 'rgba(20,22,28,0.4)',
                  opacity: row.keep ? 1 : 0.5,
                  boxShadow: isAud ? `0 0 12px ${color}80` : 'none',
                }}
              >
                <span
                  className="w-6 shrink-0 text-right font-mono text-[10px] tabular-nums"
                  style={{ color: '#5b6470' }}
                >
                  {idx + 1}
                </span>
                <span
                  className="w-16 shrink-0 font-mono text-[11px] tabular-nums"
                  style={{ color: '#9aa3af' }}
                >
                  {row.start.toFixed(3)}s
                </span>
                <span
                  className="w-16 shrink-0 font-mono text-[10px] tabular-nums"
                  style={{ color: '#5b6470' }}
                >
                  +{(row.end - row.start).toFixed(3)}s
                </span>
                {/* Role selector */}
                <select
                  value={row.role}
                  onChange={(e) => {
                    setOverrides((prev) => ({
                      ...prev,
                      [idx]: { ...(prev[idx] ?? {}), role: e.target.value as SampleCategory },
                    }))
                  }}
                  className="rounded border px-1 py-0.5 font-mono text-[10px]"
                  style={{
                    borderColor: color,
                    background: 'rgba(8,18,24,0.9)',
                    color,
                    minWidth: '90px',
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]} · {r}
                    </option>
                  ))}
                </select>
                {/* Audition button */}
                <button
                  onClick={() => auditionSlice(row, idx)}
                  className="min-h-[36px] touch-manipulation rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all hover:brightness-125"
                  style={{
                    borderColor: isAud ? '#fff' : color,
                    color: isAud ? '#fff' : color,
                    background: isAud ? `${color}40` : 'transparent',
                  }}
                >
                  {isAud ? 'PLAY' : 'AUD'}
                </button>
                {/* Keep toggle */}
                <button
                  onClick={() => {
                    setOverrides((prev) => ({
                      ...prev,
                      [idx]: { ...(prev[idx] ?? {}), keep: !row.keep },
                    }))
                  }}
                  className="min-h-[36px] touch-manipulation rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-all hover:brightness-125"
                  style={{
                    borderColor: row.keep ? '#3fb950' : '#3a4150',
                    color: row.keep ? '#3fb950' : '#5b6470',
                    background: row.keep ? 'rgba(63,185,80,0.1)' : 'transparent',
                  }}
                >
                  {row.keep ? 'KEEP' : 'SKIP'}
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={emitSlices}
          disabled={keptCount === 0}
          className="min-h-[44px] touch-manipulation flex-1 rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-40"
          style={{
            borderColor: '#22d3ee',
            color: '#22d3ee',
            background: 'rgba(34,211,238,0.1)',
            boxShadow: '0 0 12px rgba(34,211,238,0.4)',
          }}
        >
          SLICE {keptCount} SAMPLES
        </button>
        {onReconstruct && (
          <button
            onClick={reconstructPattern}
            disabled={keptCount === 0}
            className="min-h-[44px] touch-manipulation flex-1 rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-40"
            style={{
              borderColor: '#b967ff',
              color: '#b967ff',
              background: 'rgba(185,103,255,0.1)',
              boxShadow: '0 0 12px rgba(185,103,255,0.4)',
            }}
            title="Slice + reconstruct the original loop's groove in the pattern editor"
          >
            RECONSTRUCT PATTERN
          </button>
        )}
        <button
          onClick={onCancel}
          className="min-h-[44px] touch-manipulation rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:brightness-125"
          style={{ borderColor: '#3a4150', color: '#9aa3af' }}
        >
          CANCEL
        </button>
      </div>
    </div>
  )
}

// ─── SlicerWaveform — full-width waveform + slice markers ──────────────────

function SlicerWaveform({
  mono,
  sampleRate,
  onsets,
  rows,
}: {
  mono: Float32Array
  sampleRate: number
  onsets: Onset[]
  rows: SliceRow[]
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const W = canvas.clientWidth || 600
    const H = canvas.clientHeight || 64
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // Background.
    ctx.fillStyle = 'rgba(9,12,16,0.9)'
    ctx.fillRect(0, 0, W, H)

    // Compute peak per pixel column.
    const totalSamples = mono.length
    const totalSec = totalSamples / sampleRate
    const samplesPerPx = Math.max(1, Math.floor(totalSamples / W))
    const mid = H / 2
    ctx.fillStyle = '#86f7ff'
    for (let x = 0; x < W; x++) {
      let peak = 0
      const start = x * samplesPerPx
      const end = Math.min(totalSamples, start + samplesPerPx)
      for (let i = start; i < end; i++) {
        const v = Math.abs(mono[i] ?? 0)
        if (v > peak) peak = v
      }
      const h = Math.max(1, peak * H * 0.9)
      ctx.fillRect(x, mid - h / 2, 1, h)
    }

    // Draw slice markers.
    onsets.forEach((o, i) => {
      const x = (o.time / totalSec) * W
      const row = rows[i]
      const color = row ? ROLE_COLORS[row.role] : '#22d3ee'
      // Vertical line.
      ctx.fillStyle = color
      ctx.fillRect(x - 0.5, 0, 1.5, H)
      // Marker triangle at top.
      ctx.beginPath()
      ctx.moveTo(x - 4, 0)
      ctx.lineTo(x + 4, 0)
      ctx.lineTo(x, 6)
      ctx.closePath()
      ctx.fill()
      // Skip overlay if !keep.
      if (row && !row.keep) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(x, 0, 1.5, H)
      }
    })
  }, [mono, sampleRate, onsets, rows])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '64px',
        display: 'block',
        border: '1px solid #232932',
        background: '#090c10',
      }}
    />
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Heuristic default role for slice index `i` out of `total` slices.
 *
 * Assumes a 4/4 drum loop:
 *   - Position 0, 4, 8...    → kick (downbeats)
 *   - Position 2, 6, 10...   → clap/snare (backbeats)
 *   - Odd positions           → hat-closed (offbeats)
 *   - Last position           → fx (tail)
 *
 * The user can override per-row.
 */
function pickDefaultRole(i: number, total: number): SampleCategory {
  if (total <= 1) return 'perc'
  if (i === total - 1) return 'fx'
  if (i % 4 === 0) return 'kick'
  if (i % 4 === 2) return 'clap'
  if (i % 2 === 1) return 'hat-closed'
  return 'perc'
}
