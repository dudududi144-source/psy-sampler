'use client'

// Visualizer — DPR-aware canvas with three display modes:
//   1. BARS — frequency bars (classic spectrum analyzer)
//   2. WAVE — realtime waveform (time-domain oscilliscope)
//   3. BOTH — frequency bars + waveform overlay
//
// The waveform mode shows the actual audio signal shape — useful for seeing
// transients (kick hits), clipping, and phase relationships. This is what
// oscilloscopes show in professional studios.

import * as React from 'react'

type VizMode = 'bars' | 'wave' | 'both'

export function Visualizer({ analyser, isPlaying }: { analyser: AnalyserNode | null; isPlaying: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rafRef = React.useRef<number>(0)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [mode, setMode] = React.useState<VizMode>('bars')

  React.useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const freqBufferLength = analyser.frequencyBinCount
    const freqData = new Uint8Array(freqBufferLength)
    const timeData = new Uint8Array(analyser.fftSize)

    // DPR-aware sizing.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = 160
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.height = `${h}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }
    resize()

    const ro = new ResizeObserver(resize)
    if (containerRef.current) ro.observe(containerRef.current)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(freqData)
      if (mode === 'wave' || mode === 'both') {
        analyser.getByteTimeDomainData(timeData)
      }

      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = 160

      // Trail-style clear.
      ctx.fillStyle = 'rgba(9,9,11,0.35)'
      ctx.fillRect(0, 0, w, h)

      // ── Frequency bars (BARS or BOTH mode) ──────────────────────────────
      if (mode === 'bars' || mode === 'both') {
        const barCount = 64
        const barWidth = w / barCount
        const barAreaH = mode === 'both' ? h * 0.6 : h
        for (let i = 0; i < barCount; i++) {
          const idx = Math.floor((i / barCount) * freqBufferLength * 0.7)
          const v = (freqData[idx] ?? 0) / 255
          const barH = v * barAreaH * 0.95
          // Color zones: emerald → fuchsia → violet.
          const hue = i < barCount / 3 ? 160 : i < (barCount * 2) / 3 ? 325 : 280
          ctx.fillStyle = `hsla(${hue}, 100%, ${50 + v * 25}%, ${0.35 + v * 0.65})`
          ctx.fillRect(i * barWidth + 1, barAreaH - barH, Math.max(1, barWidth - 2), barH)
          // Reflection.
          ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${v * 0.2})`
          ctx.fillRect(i * barWidth + 1, barAreaH, Math.max(1, barWidth - 2), 2)
        }
      }

      // ── Waveform (WAVE or BOTH mode) ────────────────────────────────────
      if (mode === 'wave' || mode === 'both') {
        const waveY = mode === 'both' ? h * 0.8 : h / 2
        const waveH = mode === 'both' ? h * 0.35 : h * 0.8
        const sliceWidth = w / timeData.length
        ctx.lineWidth = 2
        ctx.strokeStyle = mode === 'both' ? 'rgba(0,255,200,0.9)' : 'rgba(0,255,200,0.8)'
        ctx.shadowBlur = 8
        ctx.shadowColor = 'rgba(0,255,200,0.6)'
        ctx.beginPath()
        let x = 0
        for (let i = 0; i < timeData.length; i++) {
          const v = (timeData[i] ?? 128) / 128.0 // 0..2 (128 = center)
          const y = waveY + (v - 1) * waveH / 2
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
          x += sliceWidth
        }
        ctx.stroke()
        ctx.shadowBlur = 0

        // Center line (zero crossing).
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, waveY)
        ctx.lineTo(w, waveY)
        ctx.stroke()
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [analyser, isPlaying, mode])

  return (
    <div ref={containerRef} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">ANALYSER</h2>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex gap-0.5">
            {(['bars', 'wave', 'both'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                disabled={mode === m}
                className="touch-manipulation min-h-[24px] rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider transition-all disabled:opacity-100"
                style={{
                  borderColor: mode === m ? '#fbbf24' : '#3f3f46',
                  color: mode === m ? '#fbbf24' : '#71717a',
                  backgroundColor: mode === m ? 'rgba(251,191,36,0.1)' : 'transparent',
                }}
                title={`${m} mode`}
              >
                {m}
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px] text-zinc-600">
            {isPlaying ? '● LIVE' : '○ IDLE'}
          </span>
        </div>
      </div>
      <canvas ref={canvasRef} className="w-full" style={{ height: 160 }} />
    </div>
  )
}
