'use client'

// RoleFxPanel — per-role FX chain controls (Phase 1.6.2).
//
// Exposes the per-voice FX chain (transient designer, bitcrusher, saturation)
// to the user via a compact panel with one row per role. Each row has 3
// sliders + a bypass toggle. Sliders control the per-role FX options that
// flow through:
//   Page state → SamplerDevice.setRoleFx() → handleNoteEvent → VoiceTriggerOptions.fx → SampleVoice
//
// The FX chain runs per-voice (per-trigger), so a change here affects the
// NEXT trigger of the role. Already-sustained triggers are NOT affected
// (each trigger creates a fresh chain).

import * as React from 'react'
import type { SampleRole, VoiceFXOptions } from '@/psy-sampler'
import { ROLES, ROLE_COLORS, ROLE_LABEL } from '@/components/types'

export interface RoleFxPanelProps {
  /** Per-role FX state (mirrored from device). Keyed by role. */
  fxState: Partial<Record<SampleRole, VoiceFXOptions>>
  /** Called when the user changes a slider. */
  onChange: (role: SampleRole, fx: VoiceFXOptions | null) => void
  /** Disabled until audio is initialized. */
  disabled?: boolean
}

interface FxRow {
  /** Slider label (e.g. "TRANS"). */
  label: string
  /** Min value. */
  min: number
  /** Max value. */
  max: number
  /** Step size. */
  step: number
  /** Default value (when role has no FX set). */
  def: number
  /** Key in VoiceFXOptions. */
  key: keyof VoiceFXOptions
  /** Color for the slider accent. */
  color: string
  /** Format the value for display. */
  fmt: (v: number) => string
}

const ROWS: FxRow[] = [
  {
    label: 'TRANS',
    min: -1, max: 1, step: 0.05, def: 0,
    key: 'transient', color: '#fbbf24',
    fmt: (v) => v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2),
  },
  {
    label: 'BITS',
    min: 0, max: 16, step: 1, def: 16,
    key: 'bitcrusher', color: '#22d3ee',
    fmt: (v) => v >= 16 ? 'off' : v.toFixed(0),
  },
  {
    label: 'SAT',
    min: 0, max: 10, step: 0.1, def: 0,
    key: 'saturation', color: '#ff2e88',
    fmt: (v) => v <= 0.05 ? 'off' : v.toFixed(1),
  },
]

export function RoleFxPanel({ fxState, onChange, disabled }: RoleFxPanelProps) {
  return (
    <div className="section p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2
          className="stitle font-mono text-xs font-bold uppercase tracking-[0.2em]"
          style={{ '--c': '#22d3ee' } as React.CSSProperties}
        >
          FX · per role
        </h2>
        <span className="font-mono text-[10px]" style={{ color: '#5b6470' }}>
          {disabled ? 'audio not ready' : 'live on next trigger'}
        </span>
      </div>
      <div className="max-h-72 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
        {ROLES.map((role) => {
          const color = ROLE_COLORS[role]
          const fx = fxState[role]
          const hasFx = fx !== undefined
          return (
            <div
              key={role}
              className="rounded border p-2"
              style={{
                borderColor: hasFx ? color : '#232932',
                backgroundColor: hasFx ? `${color}08` : 'rgba(20,22,28,0.4)',
                opacity: disabled ? 0.4 : 1,
              }}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className="font-mono text-[11px] font-bold uppercase tracking-wider"
                  style={{ color }}
                >
                  {ROLE_LABEL[role]}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!hasFx) {
                      // Initialize with defaults (all bypassed)
                      onChange(role, { transient: 0, bitcrusher: 16, saturation: 0 })
                    } else {
                      // Clear (back to bypass)
                      onChange(role, null)
                    }
                  }}
                  className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider hover:brightness-125 disabled:opacity-50"
                  style={{
                    borderColor: hasFx ? color : '#3a4150',
                    color: hasFx ? color : '#9aa3af',
                  }}
                  title={hasFx ? 'Disable FX for this role' : 'Enable FX for this role'}
                  aria-label={`Toggle FX for ${role} role${hasFx ? ' (currently on)' : ' (currently off)'}`}
                  aria-pressed={hasFx}
                >
                  {hasFx ? 'ON' : 'OFF'}
                </button>
              </div>
              {hasFx && (
                <div className="space-y-1">
                  {ROWS.map((row) => {
                    const value = fx?.[row.key] ?? row.def
                    return (
                      <div key={row.label} className="flex items-center gap-2">
                        <span className="w-12 shrink-0 font-mono text-[9px] uppercase" style={{ color: row.color }}>
                          {row.label}
                        </span>
                        <input
                          type="range"
                          min={row.min}
                          max={row.max}
                          step={row.step}
                          value={value}
                          disabled={disabled}
                          onChange={(e) => {
                            const newVal = parseFloat(e.target.value)
                            const newFx: VoiceFXOptions = { ...(fx ?? {}), [row.key]: newVal }
                            onChange(role, newFx)
                          }}
                          className="h-2 flex-1"
                          style={{ accentColor: row.color }}
                        />
                        <span
                          className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums"
                          style={{ color: '#9aa3af' }}
                        >
                          {row.fmt(value)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
