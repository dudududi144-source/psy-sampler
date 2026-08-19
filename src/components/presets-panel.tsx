'use client'

// PresetsPanel + PatternSlots — genre pattern + mixer preset loader + 4-slot save/load/clear.
// Compact layout matching PSY hardware aesthetic.

import { PATTERN_PRESETS, type PatternPreset } from '@/lib/pattern-persistence'
import { MIXER_PRESETS, type MixerPreset } from '@/lib/mixer-presets'
import * as React from 'react'

export function PresetsPanel({
  onLoad,
  onLoadMixer,
}: {
  onLoad: (preset: PatternPreset) => void
  onLoadMixer?: (preset: MixerPreset) => void
}) {
  return (
    <div className="section" style={{ '--c': '#86f7ff', padding: '8px 16px' } as React.CSSProperties}>
      <h2 className="stitle" style={{ '--c': '#86f7ff' } as React.CSSProperties}>PRESETS</h2>
      {/* Pattern presets — single row, compact */}
      <div className="krow" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {PATTERN_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onLoad(preset)}
            className="preset"
            style={{ padding: '6px 10px', fontSize: '9px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const }}
            title={`${preset.name} - ${preset.bpm} BPM`}
          >
            {preset.name}
          </button>
        ))}
      </div>
      {/* Mixer presets — single row, compact */}
      {onLoadMixer && (
        <div className="krow" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
          {MIXER_PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => onLoadMixer(preset)}
              className="preset"
              style={{ padding: '6px 10px', fontSize: '9px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const }}
              title={`${preset.name} mixer preset`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PatternSlots({
  slotNames,
  onSave,
  onLoad,
  onClear,
}: {
  slotNames: string[]
  onSave: (slot: number) => void
  onLoad: (slot: number) => void
  onClear: (slot: number) => void
}) {
  return (
    <div className="section" style={{ '--c': '#f07dc2', padding: '8px 16px' } as React.CSSProperties}>
      <h2 className="stitle" style={{ '--c': '#f07dc2' } as React.CSSProperties}>SLOTS</h2>
      <div className="krow" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {slotNames.map((name, i) => (
          <div
            key={i}
            style={{
              padding: '6px 10px',
              border: '1px solid #232932',
              borderRadius: '6px',
              background: 'rgba(20,22,28,0.4)',
              minWidth: '120px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '9px', color: '#5b6470', textTransform: 'uppercase' as const }}>
                SLOT {i + 1}
              </span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '8px', color: name ? '#86f7ff' : '#5b6470' }}>
                {name ? 'SAVED' : 'EMPTY'}
              </span>
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9px',
              color: '#cfd6df',
              whiteSpace: 'nowrap' as const,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: '4px',
            }} title={name}>
              {name || '---'}
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => onSave(i)}
                className="preset"
                style={{ flex: 1, padding: '4px', fontSize: '8px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: '#86f7ff' }}
                title="Save to slot"
              >
                SAVE
              </button>
              <button
                onClick={() => onLoad(i)}
                disabled={!name}
                className="preset"
                style={{ flex: 1, padding: '4px', fontSize: '8px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: '#f07dc2', opacity: name ? 1 : 0.3 }}
                title="Load from slot"
              >
                LOAD
              </button>
              <button
                onClick={() => onClear(i)}
                disabled={!name}
                className="preset"
                style={{ flex: 1, padding: '4px', fontSize: '8px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: '#fbbf24', opacity: name ? 1 : 0.3 }}
                title="Clear slot"
              >
                CLR
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
