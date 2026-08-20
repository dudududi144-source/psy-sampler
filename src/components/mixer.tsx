'use client'

// Mixer — 3-bus panel with PSY knobs for gain + EQ + saturation.
//
// Each bus has 5 PsyKnobs:
//   GAIN (0..1.2), EQ-LOW (-24..+24dB), EQ-MID, EQ-HIGH, SAT (0..10)
// Plus mute + solo buttons.
//
// This replaces the old horizontal SliderRow with real PSY hardware knobs.
// 15 knobs total (5 per bus × 3 buses).

import * as React from 'react'
import { PsyKnob } from '@/components/psy-knob'
import {
  BUS_NAMES,
  BUS_COLORS,
  BUS_ROLES,
  ROLE_COLORS,
  ROLE_LABEL,
  type BusMixerState,
} from '@/components/types'
import type { BusName } from '@/psy-sampler'

export function Mixer({
  busState,
  onGain,
  onEQ,
  onSaturation,
  onDelaySend,
  onReverbSend,
  onMute,
  onSolo,
}: {
  busState: Record<BusName, BusMixerState>
  onGain: (name: BusName, value: number) => void
  onEQ: (name: BusName, band: 'low' | 'mid' | 'high', value: number) => void
  onSaturation: (name: BusName, value: number) => void
  /** Phase 4.1: delay send level (0..1). */
  onDelaySend: (name: BusName, value: number) => void
  /** Phase 4.1: reverb send level (0..1). */
  onReverbSend: (name: BusName, value: number) => void
  onMute: (name: BusName) => void
  onSolo: (name: BusName) => void
}) {
  return (
    <div className="section" style={{ '--c': '#4dd6e8' } as React.CSSProperties}>
      <h2 className="stitle" style={{ '--c': '#4dd6e8' } as React.CSSProperties}>
        MIXER · 3 BUSES
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BUS_NAMES.map((name) => {
          const state = busState[name]
          const color = BUS_COLORS[name]
          const roles = BUS_ROLES[name]
          return (
            <div
              key={name}
              style={{
                padding: '8px 12px',
                borderLeft: `1px solid ${color}33`,
                opacity: state.muted ? 0.4 : 1,
              }}
            >
              {/* Bus name + role count */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '1.5px',
                    color,
                    textTransform: 'uppercase',
                  }}
                >
                  {name}
                </span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#5b6470' }}>
                  {roles.length} ROLES
                </span>
              </div>

              {/* Knob row — 5 PSY knobs */}
              <div className="krow" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <PsyKnob
                  value={state.gain}
                  min={0}
                  max={1.2}
                  def={0.85}
                  step={0.01}
                  size={48}
                  color={color}
                  label="GAIN"
                  fmt={v => v.toFixed(2)}
                  onChange={v => onGain(name, v)}
                />
                <PsyKnob
                  value={state.eqLow}
                  min={-24}
                  max={24}
                  def={0}
                  step={0.5}
                  size={48}
                  color="#60a5fa"
                  label="EQ L"
                  fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}`}
                  onChange={v => onEQ(name, 'low', v)}
                />
                <PsyKnob
                  value={state.eqMid}
                  min={-24}
                  max={24}
                  def={0}
                  step={0.5}
                  size={48}
                  color="#a78bfa"
                  label="EQ M"
                  fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}`}
                  onChange={v => onEQ(name, 'mid', v)}
                />
                <PsyKnob
                  value={state.eqHigh}
                  min={-24}
                  max={24}
                  def={0}
                  step={0.5}
                  size={48}
                  color="#f472b6"
                  label="EQ H"
                  fmt={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}`}
                  onChange={v => onEQ(name, 'high', v)}
                />
                <PsyKnob
                  value={state.saturation}
                  min={0}
                  max={10}
                  def={0}
                  step={0.1}
                  size={48}
                  color={state.saturation > 0.1 ? '#fb923c' : '#52525b'}
                  label="SAT"
                  fmt={v => v > 0.1 ? v.toFixed(1) : 'off'}
                  onChange={v => onSaturation(name, v)}
                />
                {/* Phase 4.1: delay + reverb send knobs */}
                <PsyKnob
                  value={state.delaySend ?? 0}
                  min={0}
                  max={1}
                  def={name === 'drum' ? 0.05 : name === 'music' ? 0.2 : 0.4}
                  step={0.01}
                  size={48}
                  color={state.delaySend > 0.01 ? '#fbbf24' : '#52525b'}
                  label="DLY"
                  fmt={v => v > 0.01 ? v.toFixed(2) : 'off'}
                  onChange={v => onDelaySend(name, v)}
                />
                <PsyKnob
                  value={state.reverbSend ?? 0}
                  min={0}
                  max={1}
                  def={name === 'drum' ? 0.1 : name === 'music' ? 0.25 : 0.5}
                  step={0.01}
                  size={48}
                  color={state.reverbSend > 0.01 ? '#86f7ff' : '#52525b'}
                  label="REV"
                  fmt={v => v > 0.01 ? v.toFixed(2) : 'off'}
                  onChange={v => onReverbSend(name, v)}
                />
              </div>

              {/* Mute + Solo buttons */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <button
                  onClick={() => onMute(name)}
                  className="tbtn"
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '9px',
                    letterSpacing: '1.8px',
                    color: state.muted ? '#fbbf24' : '#71717a',
                    borderColor: state.muted ? '#fbbf24' : '#000',
                    backgroundColor: state.muted ? 'rgba(251,191,36,0.1)' : undefined,
                  }}
                >
                  MUTE
                </button>
                <button
                  onClick={() => onSolo(name)}
                  className="tbtn"
                  style={{
                    flex: 1,
                    padding: '6px',
                    fontSize: '9px',
                    letterSpacing: '1.8px',
                    color: state.solo ? '#00ffc8' : '#71717a',
                    borderColor: state.solo ? '#00ffc8' : '#000',
                    backgroundColor: state.solo ? 'rgba(0,255,200,0.1)' : undefined,
                  }}
                >
                  SOLO
                </button>
              </div>

              {/* Roles indicator */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', justifyContent: 'center' }}>
                {roles.map((r) => (
                  <span
                    key={r}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '9px',
                      letterSpacing: '1px',
                      color: ROLE_COLORS[r],
                      textTransform: 'uppercase',
                    }}
                  >
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
