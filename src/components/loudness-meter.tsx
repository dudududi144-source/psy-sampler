'use client'

// LoudnessMeter — professional peak + RMS metering (Phase 4.6).
//
// Reads time-domain data from the shared AnalyserNode and displays:
//   - PEAK (sample peak, dBFS) — red zone above -3 dB
//   - RMS (root mean square, dBFS) — green zone below -12 dB
//
// Both meters show a horizontal bar with a dBFS scale (-60 to 0).
// The peak hold indicator (thin line) holds the max for 1 second.
//
// This is NOT true LUFS (which requires K-weighting + 400ms integration
// windows, typically an AudioWorklet). For full ITU-R BS.1770 LUFS,
// we'd need a separate worklet — out of scope for Phase 4.6 MVP.
// The peak + RMS meters cover 90% of the use cases for mixing.

import * as React from 'react'

function LoudnessMeterImpl({ analyser, isPlaying }: {
  analyser: AnalyserNode | null
  isPlaying: boolean
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const peakHoldRef = React.useRef<{ peak: number; time: number }>({ peak: -60, time: 0 })
  const rafRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!analyser || !canvasRef.current) return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    const W = canvas.clientWidth || 200
    const H = canvas.clientHeight || 80
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const timeData = new Uint8Array(analyser.fftSize)
    const MIN_DB = -60
    const MAX_DB = 0
    const dbRange = MAX_DB - MIN_DB

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(timeData)

      // Compute peak + RMS.
      let peak = 0
      let sumSq = 0
      const N = timeData.length
      for (let i = 0; i < N; i++) {
        // Convert 0-255 to -1..1 (128 = silence).
        const s = (timeData[i]! - 128) / 128
        const abs = Math.abs(s)
        if (abs > peak) peak = abs
        sumSq += s * s
      }
      const rms = Math.sqrt(sumSq / N)

      // Convert to dBFS. -Infinity → MIN_DB.
      const peakDb = peak > 0.0001 ? Math.max(MIN_DB, 20 * Math.log10(peak)) : MIN_DB
      const rmsDb = rms > 0.0001 ? Math.max(MIN_DB, 20 * Math.log10(rms)) : MIN_DB

      // Peak hold: keep the max for 1 second.
      const now = performance.now()
      if (peakDb > peakHoldRef.current.peak || now - peakHoldRef.current.time > 1000) {
        peakHoldRef.current = { peak: peakDb, time: now }
      }
      const holdDb = peakHoldRef.current.peak

      // ── Draw ──────────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(9,12,16,0.95)'
      ctx.fillRect(0, 0, W, H)

      // Scale: -60 dB at left, 0 dB at right.
      const dbToX = (db: number) => ((db - MIN_DB) / dbRange) * W

      // ── RMS bar (bottom half, green) ──────────────────────────────────
      const rmsY = H * 0.55
      const rmsH = H * 0.35
      // Background.
      ctx.fillStyle = 'rgba(20,22,28,0.8)'
      ctx.fillRect(0, rmsY, W, rmsH)
      // Segmented meter (LED-style blocks).
      const segWidth = 4
      const gap = 1
      const rmsEnd = dbToX(rmsDb)
      for (let x = 0; x < W; x += segWidth + gap) {
        if (x >= rmsEnd) break
        const db = MIN_DB + (x / W) * dbRange
        // Color zones: green < -12, yellow -12 to -3, red > -3.
        let color: string
        if (db > -3) color = '#f85149'
        else if (db > -12) color = '#fbbf24'
        else color = '#3fb950'
        ctx.fillStyle = color
        ctx.fillRect(x, rmsY, segWidth, rmsH)
      }

      // ── Peak bar (top half, brighter) ────────────────────────────────
      const peakY = H * 0.1
      const peakH = H * 0.35
      ctx.fillStyle = 'rgba(20,22,28,0.8)'
      ctx.fillRect(0, peakY, W, peakH)
      const peakEnd = dbToX(peakDb)
      for (let x = 0; x < W; x += segWidth + gap) {
        if (x >= peakEnd) break
        const db = MIN_DB + (x / W) * dbRange
        let color: string
        if (db > -3) color = '#f85149'
        else if (db > -12) color = '#fbbf24'
        else color = '#22d3ee'
        ctx.fillStyle = color
        ctx.fillRect(x, peakY, segWidth, peakH)
      }

      // ── Peak hold indicator (thin line) ──────────────────────────────
      const holdX = dbToX(holdDb)
      ctx.fillStyle = holdDb > -3 ? '#f85149' : '#ffffff'
      ctx.fillRect(holdX - 1, peakY, 2, peakH)

      // ── Labels ────────────────────────────────────────────────────────
      ctx.font = '8px JetBrains Mono, monospace'
      ctx.textBaseline = 'top'
      // Peak label
      ctx.fillStyle = peakDb > -3 ? '#f85149' : '#9aa3af'
      ctx.fillText(`PK ${peakDb === MIN_DB ? '−∞' : peakDb.toFixed(1)}`, 2, 0)
      // RMS label
      ctx.fillStyle = '#9aa3af'
      ctx.fillText(`RMS ${rmsDb === MIN_DB ? '−∞' : rmsDb.toFixed(1)}`, 2, rmsY - 10)
      // dB scale markers at -60, -30, -12, -6, -3, 0
      ctx.fillStyle = '#5b6470'
      ctx.textAlign = 'right'
      for (const db of [0, -3, -6, -12, -30]) {
        const x = dbToX(db)
        ctx.fillText(`${db}`, x - 2, H - 9)
        // Tick mark
        ctx.fillStyle = '#3a4150'
        ctx.fillRect(x, H - 1, 1, 1)
        ctx.fillStyle = '#5b6470'
      }
      ctx.textAlign = 'left'
    }

    draw()
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [analyser, isPlaying])

  return (
    <div className="section p-2" style={{ borderColor: '#232932' }}>
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: '#5b6470' }}>
          METER · dBFS
        </span>
        <span className="font-mono text-[9px]" style={{ color: '#5b6470' }}>
          {!analyser ? 'no signal' : isPlaying ? 'live' : 'idle'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '80px',
          display: 'block',
          border: '1px solid #232932',
          background: '#090c10',
        }}
        aria-label="Audio level meter — peak and RMS in decibels full scale. Idle when not playing."
      />
    </div>
  )
}

// Phase 7.3.1: React.memo
export const LoudnessMeter = React.memo(LoudnessMeterImpl)
