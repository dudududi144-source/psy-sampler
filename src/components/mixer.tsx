'use client'

// Mixer — 3-bus (drum/music/atmos) panel with gain + mute + solo per bus.

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
  onMute,
  onSolo,
}: {
  busState: Record<BusName, BusMixerState>
  onGain: (name: BusName, value: number) => void
  onMute: (name: BusName) => void
  onSolo: (name: BusName) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">MIXER · 3 buses</h2>
        <span className="font-mono text-[10px] text-zinc-500">drum · music · atmos</span>
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
              {/* Vertical-ish gain slider (horizontal for compactness) */}
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-zinc-600">G</span>
                <Slider
                  value={[state.gain]}
                  onValueChange={(v) => onGain(name, v[0]!)}
                  min={0}
                  max={1.2}
                  step={0.01}
                  className="flex-1"
                />
                <span className="w-7 font-mono text-[11px] tabular-nums" style={{ color }}>
                  {state.gain.toFixed(2)}
                </span>
              </div>
              {/* Mute + Solo buttons */}
              <div className="mt-2 flex gap-1">
                <button
                  onClick={() => onMute(name)}
                  title="Mute"
                  className="flex-1 min-h-[44px] touch-manipulation rounded border px-1 py-2 font-mono text-[11px] uppercase tracking-wider transition-all"
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
                  className="flex-1 min-h-[44px] touch-manipulation rounded border px-1 py-2 font-mono text-[11px] uppercase tracking-wider transition-all"
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
