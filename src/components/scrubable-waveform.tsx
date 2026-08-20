'use client'

// ScrubableWaveform — large waveform display with click-to-scrub preview.
//
// Phase 2.2: sample preview improvements. This component renders a full-width
// waveform (height 60px) and lets the user click anywhere to start playback
// from that position. While the sample is playing, a vertical playhead line
// shows the current position.
//
// Used in the SampleLibrary's expanded view (when a sample is selected for
// detailed preview) and in the SampleImporter's decoded preview.

import * as React from 'react'

export interface ScrubableWaveformProps {
  /** Mono audio data for visualization. */
  data: Float32Array
  /** Sample rate (for converting data index → time). */
  sampleRate: number
  /** Color of the waveform bars. */
  color: string
  /** Called when the user clicks/drags on the waveform. Receives the
   *  position as a fraction (0..1) of the waveform. */
  onScrub: (fraction: number) => void
  /** Current playback position as a fraction (0..1). Updates the playhead. */
  playFraction?: number
  /** Height in pixels (default 60). */
  height?: number
  /** Width (default '100%'). */
  width?: number | string
}

export function ScrubableWaveform({
  data,
  sampleRate,
  color,
  onScrub,
  playFraction,
  height = 60,
  width = '100%',
}: ScrubableWaveformProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const [hoverX, setHoverX] = React.useState<number | null>(null)

  // Compute waveform peaks (downsample to canvas width).
  const peaks = React.useMemo(() => {
    const W = 400 // logical width for peak computation
    const p: number[] = new Array(W).fill(0)
    const step = Math.max(1, Math.floor(data.length / W))
    for (let b = 0; b < W; b++) {
      let peak = 0
      const start = b * step
      const end = Math.min(data.length, start + step)
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i] ?? 0)
        if (v > peak) peak = v
      }
      p[b] = peak
    }
    return p
  }, [data])

  // Draw waveform + playhead + hover marker.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const W = canvas.clientWidth || 400
    const H = height
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // Background.
    ctx.fillStyle = 'rgba(9,12,16,0.9)'
    ctx.fillRect(0, 0, W, H)

    // Draw waveform bars.
    const mid = H / 2
    const barWidth = W / peaks.length
    ctx.fillStyle = color
    for (let b = 0; b < peaks.length; b++) {
      const h = Math.max(1, peaks[b] * H * 0.9)
      const x = b * barWidth
      ctx.fillRect(x, mid - h / 2, Math.max(1, barWidth), h)
    }

    // Playhead.
    if (playFraction !== undefined && playFraction >= 0 && playFraction <= 1) {
      const px = playFraction * W
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(px - 0.5, 0, 1.5, H)
      // Soft glow.
      ctx.fillStyle = `${color}40`
      ctx.fillRect(px - 3, 0, 6, H)
    }

    // Hover marker (when mouse is over the waveform).
    if (hoverX !== null) {
      ctx.fillStyle = `${color}80`
      ctx.fillRect(hoverX - 0.5, 0, 1, H)
    }
  }, [peaks, color, height, playFraction, hoverX])

  // Convert mouse event → fraction (0..1).
  const eventToFraction = (e: React.MouseEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    return Math.max(0, Math.min(1, x / rect.width))
  }

  // Mouse handlers: click → scrub, drag → continuous scrub.
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setDragging(true)
    onScrub(eventToFraction(e))
  }
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setHoverX(e.clientX - rect.left)
    if (dragging) {
      onScrub(eventToFraction(e))
    }
  }
  const handleMouseUp = () => setDragging(false)
  const handleMouseLeave = () => {
    setDragging(false)
    setHoverX(null)
  }

  return (
    <canvas
      ref={canvasRef}
      style={{
        width,
        height,
        display: 'block',
        cursor: 'pointer',
        border: '1px solid #232932',
        background: '#090c10',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      role="slider"
      aria-label="Waveform scrubber — click to start playback from this position"
      aria-valuenow={Math.round((playFraction ?? 0) * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    />
  )
}
