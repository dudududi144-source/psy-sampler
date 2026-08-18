'use client'

// PresetsPanel + PatternSlots — genre pattern + mixer preset loader + 4-slot save/load/clear.

import { PATTERN_PRESETS, type PatternPreset } from '@/lib/pattern-persistence'
import { MIXER_PRESETS, type MixerPreset } from '@/lib/mixer-presets'

// ─── Presets Panel ───────────────────────────────────────────────────────────

export function PresetsPanel({
  onLoad,
  onLoadMixer,
}: {
  onLoad: (preset: PatternPreset) => void
  onLoadMixer?: (preset: MixerPreset) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">PRESETS · genre</h2>
        <span className="font-mono text-[10px] text-zinc-500">pattern + mixer</span>
      </div>
      {/* Pattern presets */}
      <div className="mb-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">PATTERN</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PATTERN_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => onLoad(preset)}
            className="preset rounded border border-zinc-700 bg-zinc-900/60 px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-300 transition-all hover:border-emerald-400/50 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <div>{preset.name}</div>
            <div className="mt-0.5 text-[10px] font-normal text-zinc-500">{preset.bpm} BPM</div>
          </button>
        ))}
      </div>
      {/* Mixer presets */}
      {onLoadMixer && (
        <>
          <div className="mb-2 mt-3 font-mono text-[9px] uppercase tracking-wider text-zinc-600">MIXER (EQ+SAT+FLT)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {MIXER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => onLoadMixer(preset)}
                className="preset rounded border border-zinc-700 bg-zinc-900/60 px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300 transition-all hover:border-amber-400/50 hover:bg-amber-500/10"
                title={`${preset.name} mixer preset — EQ + saturation + filter`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Pattern Slots ───────────────────────────────────────────────────────────

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
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">SLOTS · save/load</h2>
        <span className="font-mono text-[10px] text-zinc-500">localStorage · 4 slots</span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {slotNames.map((name, i) => (
          <div key={i} className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">SLOT {i + 1}</span>
              {name ? (
                <span className="rounded bg-emerald-500/10 px-1 font-mono text-[10px] uppercase text-emerald-300">SAVED</span>
              ) : (
                <span className="rounded bg-zinc-800 px-1 font-mono text-[10px] uppercase text-zinc-600">EMPTY</span>
              )}
            </div>
            <div className="mb-1.5 truncate font-mono text-[10px] text-zinc-300" title={name}>
              {name || '—'}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => onSave(i)}
                title="Save to slot"
                className="flex-1 min-h-[44px] touch-manipulation rounded border border-emerald-400/30 bg-emerald-500/10 px-1 py-0.5 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-500/20"
              >
                SAVE
              </button>
              <button
                onClick={() => onLoad(i)}
                disabled={!name}
                title="Load from slot"
                className="flex-1 min-h-[44px] touch-manipulation rounded border border-fuchsia-400/30 bg-fuchsia-500/10 px-1 py-0.5 font-mono text-[10px] uppercase text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-30"
              >
                LOAD
              </button>
              <button
                onClick={() => onClear(i)}
                disabled={!name}
                title="Clear saved slot"
                className="min-h-[44px] touch-manipulation rounded border border-amber-400/30 bg-amber-500/10 px-1 py-0.5 font-mono text-[10px] uppercase text-amber-300 hover:bg-amber-500/20 disabled:opacity-30"
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
