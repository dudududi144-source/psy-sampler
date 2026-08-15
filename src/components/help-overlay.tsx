'use client'

// HelpOverlay — modal that shows all keyboard shortcuts + feature guide.
//
// Triggered by pressing ? (Shift+/) or clicking the ? button in the header.
// Closes on Escape or clicking outside the modal.

import * as React from 'react'

const SHORTCUTS = [
  { key: 'Space', desc: 'Play / Stop' },
  { key: 'Escape', desc: 'Stop playback' },
  { key: 'T', desc: 'Tap tempo (tap repeatedly to detect BPM)' },
  { key: 'Ctrl+Z', desc: 'Undo' },
  { key: 'Ctrl+Shift+Z', desc: 'Redo (or Ctrl+Y)' },
  { key: '?', desc: 'Toggle this help overlay' },
  { key: 'M', desc: 'Mute drum bus (toggle)' },
  { key: 'S', desc: 'Solo drum bus (toggle)' },
  { key: 'C', desc: 'Clear pattern (all steps off)' },
  { key: 'F', desc: 'Cycle master filter (off→lp→hp)' },
  { key: 'P', desc: 'Toggle sidechain pump' },
  { key: 'E', desc: 'Toggle auto-evolve' },
  { key: 'R', desc: 'Toggle live recording' },
  { key: '1/2/3', desc: 'Set pattern length (8/16/32 steps)' },
  { key: 'X', desc: 'Randomize pattern (seeded — deterministic)' },
]

const FEATURES = [
  { icon: '▶', title: 'PLAY', desc: 'Start/stop the pattern loop' },
  { icon: '⬇', title: 'EXPORT WAV', desc: 'Offline render (deterministic, faster than real-time)' },
  { icon: '○', title: 'REC', desc: 'Live recording (captures MIDI + automation + tweaks)' },
  { icon: '💾', title: 'SAVE', desc: 'Save project as .psy.json (pattern + mixer + song)' },
  { icon: '📂', title: 'LOAD', desc: 'Load project from .psy.json' },
  { icon: '○', title: 'PUMP', desc: 'Sidechain ducking (kick ducks music+atmos)' },
  { icon: '○', title: 'EVOLVE', desc: 'Auto-mutate pattern every 4 bars (deterministic)' },
  { icon: '○', title: 'FLT', desc: 'Master filter: OFF → LP (auto-wah) → HP' },
  { icon: '↶', title: 'UNDO/REDO', desc: 'Pattern history (50 steps)' },
  { icon: '⊡', title: 'TAP', desc: 'Tap tempo detection' },
  { icon: '🎹', title: 'MIDI', desc: 'Play from MIDI keyboard (Web MIDI API)' },
  { icon: '⧉', title: 'COPY', desc: 'Copy role pattern to clipboard' },
  { icon: '⤓', title: 'PASTE', desc: 'Paste clipboard into another role' },
]

const EDITOR_FEATURES = [
  { title: 'Velocity mode', desc: 'Click cycles: off → 100 → 127 → off' },
  { title: 'Probability mode', desc: '○ PROB: click cycles 100→75→50→25→100%' },
  { title: 'Drag-paint', desc: 'Mousedown + drag paints velocity' },
  { title: 'Shift+drag', desc: 'Paint at accent velocity (127)' },
  { title: 'Alt+drag', desc: 'Erase (set to 0)' },
  { title: 'Pattern length', desc: '8 / 16 / 32 steps (buttons in header)' },
]

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-mono text-lg font-bold uppercase tracking-[0.2em] text-emerald-300">
            PSY SAMPLER · GUIDE
          </h2>
          <button
            onClick={onClose}
            className="rounded border border-zinc-600 px-3 py-1 font-mono text-xs text-zinc-400 hover:bg-zinc-800"
          >
            ✕ ESC
          </button>
        </div>

        {/* Keyboard shortcuts */}
        <section className="mb-6">
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-fuchsia-300">
            Keyboard Shortcuts
          </h3>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {SHORTCUTS.map((s) => (
              <div key={s.key} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                <kbd className="min-w-[80px] rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-center font-mono text-[10px] font-bold text-emerald-300">
                  {s.key}
                </kbd>
                <span className="font-mono text-[11px] text-zinc-300">{s.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Transport buttons */}
        <section className="mb-6">
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">
            Transport Buttons
          </h3>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                <span className="min-w-[24px] text-center font-mono text-sm text-amber-300">{f.icon}</span>
                <span className="min-w-[80px] font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-200">{f.title}</span>
                <span className="font-mono text-[11px] text-zinc-400">{f.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Pattern editor */}
        <section className="mb-6">
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-violet-300">
            Pattern Editor
          </h3>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {EDITOR_FEATURES.map((f) => (
              <div key={f.title} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1">
                <span className="min-w-[100px] font-mono text-[10px] font-bold uppercase tracking-wider text-violet-300">{f.title}</span>
                <span className="font-mono text-[11px] text-zinc-400">{f.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Other panels */}
        <section>
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
            Other Panels
          </h3>
          <div className="space-y-1 font-mono text-[11px] text-zinc-400">
            <div><span className="text-emerald-300">MIXER</span> — per-bus gain + 3-band EQ + saturation + mute/solo</div>
            <div><span className="text-fuchsia-300">SONG</span> — chain saved slots into A→B→A→C arrangement</div>
            <div><span className="text-cyan-300">TIMELINE</span> — visual song arrangement with playhead</div>
            <div><span className="text-fuchsia-300">AUTOMATION</span> — draw parameter breakpoints (filter sweeps, volume rides)</div>
            <div><span className="text-cyan-300">IMPORT</span> — drag-drop WAV with mandatory provenance assertion</div>
            <div><span className="text-amber-300">ANALYSER</span> — 3 modes: BARS / WAVE / BOTH</div>
          </div>
        </section>

        <div className="mt-6 border-t border-zinc-800 pt-3 text-center font-mono text-[10px] text-zinc-600">
          Press <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1 text-zinc-300">?</kbd> or <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1 text-zinc-300">ESC</kbd> to close
        </div>
      </div>
    </div>
  )
}
