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
  { key: 'F', desc: 'Cycle master filter (offtolptohp)' },
  { key: 'P', desc: 'Toggle sidechain pump' },
  { key: 'E', desc: 'Toggle auto-evolve' },
  { key: 'R', desc: 'Toggle live recording' },
  { key: '1-9', desc: 'Trigger performance pads (Shift=accent, Alt=ghost)' },
  { key: 'D', desc: 'Generate chord-aware bass/lead (scale + key from context)' },
  { key: 'A', desc: 'Cycle arpeggio pattern (uptodowntoupDowntodownUptorandomtochordal)' },
  { key: 'B', desc: 'Cycle bass pattern (roottowalkingtooctavetopedaltoarp)' },
  { key: 'H', desc: 'Humanize velocities (add groove via random variation)' },
  { key: 'Q', desc: 'Quantize velocities (snap to off/normal/accent tiers)' },
  { key: 'X', desc: 'Randomize pattern (seeded — deterministic)' },
  { key: 'N', desc: 'Toggle metronome (click on every beat)' },
]

const FEATURES = [
  { title: 'PLAY', desc: 'Start/stop the pattern loop' },
  { title: 'EXPORT WAV', desc: 'Offline render (deterministic, 28x faster than real-time)' },
  { title: 'STEMS', desc: 'Export drum/music/atmos as separate WAVs (stem mastering)' },
  { title: 'MIDI OUT', desc: 'Export pattern as Standard MIDI File (.mid) for DAWs' },
  { title: 'MIDI IN', desc: 'Import .mid file from any DAW into the pattern' },
  { title: 'REC', desc: 'Live recording (captures MIDI + automation + tweaks)' },
  { title: 'SAVE', desc: 'Save project as .psy.json (pattern + mixer + song)' },
  { title: 'LOAD', desc: 'Load project from .psy.json' },
  { title: 'PUMP', desc: 'Sidechain ducking (kick ducks music+atmos)' },
  { title: 'EVOLVE', desc: 'Auto-mutate pattern every 4 bars (deterministic)' },
  { title: 'FLT', desc: 'Master filter: OFF to LP (auto-wah) to HP' },
  { title: 'UNDO/REDO', desc: 'Pattern history (50 steps)' },
  { title: 'TAP', desc: 'Tap tempo detection' },
  { title: 'MIDI', desc: 'Play from MIDI keyboard (Web MIDI API)' },
  { title: 'COPY', desc: 'Copy role pattern to clipboard' },
  { title: 'PASTE', desc: 'Paste clipboard into another role' },
  { title: 'PADS', desc: 'Live one-shot triggering (MPC-style, keys 1-9)' },
  { title: 'CHORDS', desc: 'Scale-aware bass/lead/texture from diatonic progressions' },
]

const EDITOR_FEATURES = [
  { title: 'Velocity mode', desc: 'Click cycles: off to 100 to 127 to off' },
  { title: 'Probability mode', desc: 'PROB: click cycles 100, 75, 50, 25, 100%' },
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
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto "
        onClick={(e) => e.stopPropagation()}
        style={{ scrollbarWidth: 'thin', background: '#0b0d11', borderColor: '#282e38' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="font-mono text-lg font-bold uppercase tracking-[0.2em]"
            style={{ color: '#86f7ff' }}
          >
            PSY SAMPLER · GUIDE
          </h2>
          <button
            onClick={onClose}
            className="rounded border px-3 py-1 font-mono text-xs hover:brightness-125"
            style={{ borderColor: '#3a4150', color: '#9aa3af' }}
          >
            ESC
          </button>
        </div>

        {/* Keyboard shortcuts */}
        <section className="mb-6">
          <h3
            className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em]"
            style={{ color: '#f07dc2' }}
          >
            Keyboard Shortcuts
          </h3>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {SHORTCUTS.map((s) => (
              <div
                key={s.key}
                className="flex items-center gap-2 rounded border px-2 py-1"
                style={{ borderColor: '#232932', background: 'rgba(20,22,28,0.8)' }}
              >
                <kbd
                  className="min-w-[80px] rounded border px-2 py-0.5 text-center font-mono text-[10px] font-bold"
                  style={{ borderColor: '#3a4150', background: '#191c22', color: '#86f7ff' }}
                >
                  {s.key}
                </kbd>
                <span className="font-mono text-[11px]" style={{ color: '#cfd6df' }}>{s.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Transport buttons */}
        <section className="mb-6">
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em] ">
            Transport Buttons
          </h3>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex items-center gap-2 rounded border px-2 py-1"
                style={{ borderColor: '#232932', background: 'rgba(20,22,28,0.8)' }}
              >
                <span className="min-w-[80px] font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: '#cfd6df' }}>{f.title}</span>
                <span className="font-mono text-[11px]" style={{ color: '#9aa3af' }}>{f.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Pattern editor */}
        <section className="mb-6">
          <h3
            className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em]"
            style={{ color: '#c084fc' }}
          >
            Pattern Editor
          </h3>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {EDITOR_FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex items-center gap-2 rounded border px-2 py-1"
                style={{ borderColor: '#232932', background: 'rgba(20,22,28,0.8)' }}
              >
                <span className="min-w-[100px] font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: '#c084fc' }}>{f.title}</span>
                <span className="font-mono text-[11px]" style={{ color: '#9aa3af' }}>{f.desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Other panels */}
        <section>
          <h3
            className="mb-2 font-mono text-xs font-bold uppercase tracking-[0.2em]"
            style={{ color: '#fbbf24' }}
          >
            Other Panels
          </h3>
          <div className="space-y-1 font-mono text-[11px]" style={{ color: '#9aa3af' }}>
            <div><span style={{ color: '#86f7ff' }}>MIXER</span> — per-bus gain + 3-band EQ + saturation + mute/solo</div>
            <div><span style={{ color: '#f07dc2' }}>SONG</span> — chain saved slots into AtoBtoAtoC arrangement</div>
            <div><span className="">TIMELINE</span> — visual song arrangement with playhead</div>
            <div><span style={{ color: '#f07dc2' }}>AUTOMATION</span> — draw parameter breakpoints (filter sweeps, volume rides)</div>
            <div><span className="">IMPORT</span> — drag-drop WAV with mandatory provenance assertion</div>
            <div><span style={{ color: '#fbbf24' }}>ANALYSER</span> — 3 modes: BARS / WAVE / BOTH</div>
          </div>
        </section>

        <div
          className="mt-6 border-t pt-3 text-center font-mono text-[10px]"
          style={{ borderColor: '#232932', color: '#5b6470' }}
        >
          Press <kbd className="rounded border px-1" style={{ borderColor: '#3a4150', background: '#191c22', color: '#cfd6df' }}>?</kbd> or <kbd className="rounded border px-1" style={{ borderColor: '#3a4150', background: '#191c22', color: '#cfd6df' }}>ESC</kbd> to close
        </div>
      </div>
    </div>
  )
}
