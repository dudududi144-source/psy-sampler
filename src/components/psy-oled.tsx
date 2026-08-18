'use client'

// PSY OLED Display — React port of PsySynthPro's OLED strip.
//
// A hardware-style OLED display with:
//   - Dark gradient background (#03131a → #020a0f)
//   - Phosphor cyan text (#86f7ff) with glow
//   - Canvas scope (real-time audio waveform)
//   - Glass reflection (::before)
//   - Scanlines (::after)
//
// The OLED is used for:
//   - Preset name display (left)
//   - Scope canvas (center, flex:1)
//   - Meta readout (right)
//
// CSS class (.oled) from psy-design.css. The ::before and ::after
// pseudo-elements (glass + scanlines) are in the CSS.

import * as React from 'react'

export interface PsyOledProps {
  /** Preset/name text (left side, cyan phosphor). */
  name?: string
  /** Meta readout (right side, dim cyan). */
  meta?: string
  /** Analyser node for scope canvas. Optional. */
  analyser?: AnalyserNode | null
  /** Whether audio is active (drives scope animation). */
  active?: boolean
  /** Children (replaces name+scope+meta layout if provided). */
  children?: React.ReactNode
  /** Style override. */
  style?: React.CSSProperties
}

export function PsyOled({
  name,
  meta,
  analyser,
  active = false,
  children,
  style,
}: PsyOledProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const rafRef = React.useRef<number>(0)

  // ─── Scope canvas animation ──────────────────────────────────────────────
  React.useEffect(() => {
    if (!analyser || !active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    const buf = new Uint8Array(analyser.frequencyBinCount)

    const draw = () => {
      analyser.getByteTimeDomainData(buf)

      // Trail persistence — semi-transparent dark fill.
      ctx.fillStyle = 'rgba(2, 10, 15, 0.42)'
      ctx.fillRect(0, 0, W, H)

      // Scope trace — cyan phosphor with glow.
      ctx.lineWidth = 1.6
      ctx.strokeStyle = '#86f7ff'
      ctx.shadowBlur = 7
      ctx.shadowColor = '#00e5ff'
      ctx.beginPath()

      const slice = W / buf.length
      let x = 0
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i]! / 128.0
        const y = (v * H) / 2
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
        x += slice
      }
      ctx.stroke()
      ctx.shadowBlur = 0

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyser, active])

  // ─── Children mode (custom content) ──────────────────────────────────────
  if (children) {
    return (
      <div className="oled" style={{ position: 'relative', ...style }}>
        {children}
      </div>
    )
  }

  // ─── Standard layout (name + scope + meta) ───────────────────────────────
  return (
    <div className="oled" style={{ position: 'relative', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {name && (
          <div
            className="pname"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '1.5px',
              color: '#86f7ff',
              textShadow: '0 0 10px rgba(0,229,255,0.55)',
              minWidth: '100px',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={520}
          height={54}
          style={{ flex: 1, height: '54px', display: analyser ? 'block' : 'none' }}
        />
        {meta && (
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9px',
              letterSpacing: '0.5px',
              color: '#3fa9bc',
              lineHeight: 1.7,
              textAlign: 'right',
              whiteSpace: 'nowrap',
            }}
          >
            {meta}
          </div>
        )}
      </div>
    </div>
  )
}
