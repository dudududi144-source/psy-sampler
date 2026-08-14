'use client'

// Visualizer — DPR-aware canvas frequency-bar analyser with ResizeObserver.

import * as React from 'react'

export function Visualizer({ analyser, isPlaying }: { analyser: AnalyserNode | null; isPlaying: boolean }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rafRef = React.useRef<number>(0)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    // DPR-aware sizing.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.floor(rect.width))
      const h = 120
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.height = `${h}px`
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
    }
    resize()

    // Observe container resize.
    const ro = new ResizeObserver(resize)
    if (containerRef.current) ro.observe(containerRef.current)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteFrequencyData(dataArray)

      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = 120

      // Trail-style clear.
      ctx.fillStyle = 'rgba(9,9,11,0.45)'
      ctx.fillRect(0, 0, w, h)

      const barCount = 64
      const barWidth = w / barCount
      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * bufferLength * 0.7)
        const v = (dataArray[idx] ?? 0) / 255
        const barH = v * h * 0.95
        // Color zones: emerald → fuchsia → violet.
        const hue = i < barCount / 3 ? 160 : i < (barCount * 2) / 3 ? 325 : 280
        ctx.fillStyle = `hsla(${hue}, 100%, ${50 + v * 25}%, ${0.35 + v * 0.65})`
        ctx.fillRect(i * barWidth + 1, h - barH, Math.max(1, barWidth - 2), barH)

        // Reflection.
        ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${v * 0.2})`
        ctx.fillRect(i * barWidth + 1, h, Math.max(1, barWidth - 2), 2)
      }
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [analyser, isPlaying])

  return (
    <div ref={containerRef} className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">ANALYSER</h2>
        <span className="font-mono text-[11px] text-zinc-600">
          {isPlaying ? '● LIVE' : '○ IDLE'} · DPR-aware
        </span>
      </div>
      <canvas ref={canvasRef} className="w-full" style={{ height: 120 }} />
    </div>
  )
}
