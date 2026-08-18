# PSY CSS Cleanup Agent — Work Record

## Task
Remove conflicting Tailwind classes (bg-*, border-*, text-{color}-*, shadow-*, rounded-*)
from elements that also have PSY family CSS classes (.tbtn, .seq-btn, .preset, .topbar,
.oled, .section, .stitle, .viz3d-bezel, .seq-grid).

KEEP: layout classes (flex, grid, gap-*, p-*, m-*, w-*, h-*, etc.), interactions
(hover:brightness-*, active:scale-*), typography (font-mono, text-xs, font-bold,
uppercase, tracking-*).

## Files cleaned (45 elements total across 11 files)

### 1. src/app/page.tsx — 11 elements
- Line 1659: `tbtn power` PLAY/STOP button — removed `border`
- Line 1820: `tbtn` EXPORT WAV — removed `border border-violet-400/50 bg-zinc-900 text-violet-300 hover:bg-violet-500/10`
- Line 1830: `tbtn` STEMS — removed `border border-amber-400/50 bg-zinc-900 text-amber-300 hover:bg-amber-500/10`
- Line 1840: `tbtn midi` MIDI export — removed `border border-cyan-400/50 bg-zinc-900 text-cyan-300 hover:bg-cyan-500/10`
- Line 1850: `tbtn midi` MIDI import — removed `border border-cyan-400/50 bg-zinc-900 text-cyan-300 hover:bg-cyan-500/10`
- Line 1870: `tbtn` Metronome — removed `border`
- Line 1887: `tbtn panic` PANIC — removed `border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20`
- Line 1896: `tbtn rec` REC — removed `border`
- Line 1911: `tbtn` SAVE — removed `border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`
- Line 1918: `tbtn` LOAD — removed `border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20`
- Line 2052: `oled` harmonic status bar — removed `rounded-xl border border-zinc-800 bg-zinc-900/50`

Notes:
- `.topbar` container (line 1654) had no conflicting Tailwind classes — only inline styles. No change.
- `.section` containers (lines 2081, 2113, 2125, 2135, 2163) only had layout classes (grid, gap, mt-*, lg:grid-cols-*). No change.

### 2. src/components/pattern-editor.tsx — 12 elements
- Line 178: `stitle` PATTERN header — removed `text-fuchsia-300`
- Lines 187, 196, 206, 216, 226, 236, 246, 256, 266 (9 `preset` buttons: CLR, RND, CHORDS, HUM, QUANT, RAMP↑, RAMP↓, SCALE+, SCALE-) — removed `rounded border border-{color}-400/40 bg-{color}-500/10 text-{color}-300 hover:bg-{color}-500/20`
- Line 449 (seq-btn cell, first part of className array) — removed `rounded-sm border`
- Line 511: `oled` pattern statistics bar — removed `rounded border border-zinc-800 bg-zinc-900/30 text-zinc-400`

### 3. src/components/mixer.tsx — 4 elements
- Line 41: `section` MIXER container — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 44: `stitle` MIXER header — removed `text-amber-300`
- Line 98: `tbtn` M (mute) button — removed `rounded border`
- Line 110: `tbtn` S (solo) button — removed `rounded border`

### 4. src/components/performance-pads.tsx — 3 elements
- Line 72: `seq-btn` pad — removed `rounded-lg border-2`
- Line 130: `section` PERFORMANCE PADS container — removed `rounded-xl border border-zinc-800 bg-zinc-900/50`
- Line 133: `stitle` PERFORMANCE PADS header — removed `text-zinc-400`

### 5. src/components/sample-library.tsx — 2 elements
- Line 79: `section` LIBRARY container — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 82: `stitle` LIBRARY header — removed `text-violet-300`
- Line 109: `preset` button — no conflicting classes; no change needed

### 6. src/components/visualizer.tsx — 1 element
- Line 144: `viz3d-bezel` ANALYSER container — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`

### 7. src/components/debug-panel.tsx — 2 elements
- Line 29: `oled` DEBUG container — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 33: `stitle` DEBUG header — removed `text-emerald-300`

### 8. src/components/song-editor.tsx — 2 elements
- Line 68: `section` SONG container — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 71: `stitle` SONG header — removed `text-cyan-300`

### 9. src/components/automation-editor.tsx — 2 elements
- Line 43: `section` AUTOMATION container — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 46: `stitle` AUTOMATION header — removed `text-fuchsia-300`

### 10. src/components/timeline-view.tsx — 4 elements
- Line 26: `section` TIMELINE container (empty state) — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 29: `stitle` TIMELINE header (empty state) — removed `text-cyan-300`
- Line 44: `section` TIMELINE container (populated) — removed `rounded-lg border border-zinc-800 bg-zinc-950/80`
- Line 47: `stitle` TIMELINE header (populated) — removed `text-cyan-300`

### 11. src/components/presets-panel.tsx — 2 elements
- Line 30: `preset` PATTERN preset button — removed `rounded border border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:border-emerald-400/50 hover:bg-emerald-500/10 hover:text-emerald-300`
- Line 46: `preset` MIXER preset button — removed `rounded border border-zinc-700 bg-zinc-900/60 text-amber-300 hover:border-amber-400/50 hover:bg-amber-500/10`

## Summary
- **Total elements cleaned**: 45
- **Total files modified**: 11 (page.tsx + 10 component files)
- **No functionality changes** — onClick, props, state, JSX structure, and inline `style={{}}` props all preserved
- **PSY classes themselves preserved** (`.tbtn`, `.seq-btn`, `.preset`, `.oled`, `.section`, `.stitle`, `.viz3d-bezel`)
- **Layout, interaction, and typography classes kept** (flex, grid, gap, padding, h-*, w-*, font-mono, text-xs, font-bold, uppercase, tracking-*, hover:brightness-*, active:scale-*, transition-all, touch-manipulation, disabled:opacity-*, etc.)
- **No commits or pushes** — changes are local only

## Verification
- `bun run lint`: PASS (no errors, no warnings)
- `bun test`: 653 pass, 1 skip, 0 fail (173012 expect() calls across 40 files)
- Dev server compiles successfully (GET / 200 in dev.log)
