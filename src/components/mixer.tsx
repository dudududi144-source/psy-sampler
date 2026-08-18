'use client'

import * as React from 'react'

// Mixer — 3-bus (drum/music/atmos) panel with gain + EQ + saturation + mute + solo per bus.
//
// Each bus card has:
//   - Gain slider (0..1.2)
//   - 3-band EQ sliders (low/mid/high, -24..+24 dB) — shapes the bus tone
//   - Saturation slider (0..10) — adds warmth/bite via waveshaper
//   - Mute + Solo buttons
//   - Roles indicator

import type { BusName } from '@/psy-sampler'
import { Slider } from '@/components/ui/slider'
import {
  BUS_NAMES,
  BUS_COLORS,
  BUS_ROLES,
  ROLE_COLORS,
  ROLE_LABEL,
  type BusMixerState,
} from '@/components/types'

export function Mixer({
  busState,
  onGain,
  onEQ,
  onSaturation,
  onMute,
  onSolo,
}: {
  busState: Record<BusName, BusMixerState>
  onGain: (name: BusName, value: number) => void
  onEQ: (name: BusName, band: 'low' | 'mid' | 'high', value: number) => void
  onSaturation: (name: BusName, value: number) => void
  onMute: (name: BusName) => void
  onSolo: (name: BusName) => void
}) {
  return (
    <div className="section p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
          style={{ '--c': '#4dd6e8' } as React.CSSProperties}
        >
          MIXER · 3 buses
        </h2>
        <span className="font-mono text-[10px] text-zinc-500">gain · eq · sat · mute · solo</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BUS_NAMES.map((name) => {
          const state = busState[name]
          const color = BUS_COLORS[name]
          const roles = BUS_ROLES[name]
          return (
            <div
              key={name}
              className="rounded border border-zinc-800 bg-zinc-900/40 p-2"
              style={state.muted ? { opacity: 0.4 } : undefined}
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
                  {name}
                </span>
                <span className="font-mono text-[10px] text-zinc-600">{roles.length} roles</span>
              </div>

              {/* Gain slider */}
              <SliderRow label="G" color={color} value={state.gain} min={0} max={1.2} step={0.01} onChange={(v) => onGain(name, v)} display={state.gain.toFixed(2)} />

              {/* 3-band EQ */}
              <div className="mt-1.5 space-y-1">
                <SliderRow label="L" color="#60a5fa" value={state.eqLow} min={-24} max={24} step={0.5} onChange={(v) => onEQ(name, 'low', v)} display={`${state.eqLow > 0 ? '+' : ''}${state.eqLow.toFixed(0)}`} />
                <SliderRow label="M" color="#a78bfa" value={state.eqMid} min={-24} max={24} step={0.5} onChange={(v) => onEQ(name, 'mid', v)} display={`${state.eqMid > 0 ? '+' : ''}${state.eqMid.toFixed(0)}`} />
                <SliderRow label="H" color="#f472b6" value={state.eqHigh} min={-24} max={24} step={0.5} onChange={(v) => onEQ(name, 'high', v)} display={`${state.eqHigh > 0 ? '+' : ''}${state.eqHigh.toFixed(0)}`} />
              </div>

              {/* Saturation */}
              <div className="mt-1.5">
                <SliderRow
                  label="S"
                  color={state.saturation > 0.1 ? '#fb923c' : '#52525b'}
                  value={state.saturation}
                  min={0}
                  max={10}
                  step={0.1}
                  onChange={(v) => onSaturation(name, v)}
                  display={state.saturation > 0.1 ? state.saturation.toFixed(1) : 'off'}
                />
              </div>

              {/* Mute + Solo buttons */}
              <div className="mt-2 flex gap-1">
                <button
                  onClick={() => onMute(name)}
                  title="Mute"
                  className="tbtn flex-1 min-h-[44px] touch-manipulation px-1 py-2 font-mono text-[11px] uppercase tracking-wider transition-all"
                  style={{
                    borderColor: state.muted ? '#fbbf24' : '#3f3f46',
                    color: state.muted ? '#fbbf24' : '#71717a',
                    backgroundColor: state.muted ? 'rgba(251,191,36,0.1)' : 'transparent',
                  }}
                >
                  M
                </button>
                <button
                  onClick={() => onSolo(name)}
                  title="Solo"
                  className="tbtn flex-1 min-h-[44px] touch-manipulation px-1 py-2 font-mono text-[11px] uppercase tracking-wider transition-all"
                  style={{
                    borderColor: state.solo ? '#00ffc8' : '#3f3f46',
                    color: state.solo ? '#00ffc8' : '#71717a',
                    backgroundColor: state.solo ? 'rgba(0,255,200,0.1)' : 'transparent',
                  }}
                >
                  S
                </button>
              </div>
              {/* Roles indicator */}
              <div className="mt-1.5 flex flex-wrap gap-0.5">
                {roles.map((r) => (
                  <span key={r} className="font-mono text-[10px] uppercase tracking-wider" style={{ color: ROLE_COLORS[r] }}>
                    {ROLE_LABEL[r].trim()}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A compact horizontal slider row with a label and a value display. */
function SliderRow({
  label,
  color,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  label: string
  color: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  display: string
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-3 shrink-0 font-mono text-[10px] text-zinc-600">{label}</span>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0]!)}
        min={min}
        max={max}
        step={step}
        className="flex-1"
      />
      <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums" style={{ color }}>
        {display}
      </span>
    </div>
  )
}
