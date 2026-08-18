'use client'

// InitOverlay — full-screen bootstrap overlay shown before AudioContext starts.
// Renders loading progress, error states, and the user-gesture init button.

import { Button } from '@/components/ui/button'
import type { LoadProgress } from '@/components/types'

export function InitOverlay({
  onInit,
  loadProgress,
  error,
  initializing,
}: {
  onInit: () => void
  loadProgress: LoadProgress | null
  error: string | null
  initializing: boolean
}) {
  const pct = loadProgress ? Math.round((loadProgress.loaded / Math.max(1, loadProgress.total)) * 100) : 0
  return (
    <div className="fixed inset-0 z-50 grid place-items-center" style={{
      background: 'radial-gradient(1100px 500px at 15% -10%, rgba(96, 60, 180, 0.16) 0%, transparent 60%), radial-gradient(900px 500px at 85% 110%, rgba(20, 120, 130, 0.12) 0%, transparent 60%), linear-gradient(180deg, #0d0f14 0%, #08090d 100%)',
    }}>
      <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden style={{
        background: 'radial-gradient(60% 50% at 20% 20%, rgba(96,60,180,0.15), transparent 60%), radial-gradient(55% 45% at 80% 30%, rgba(20,120,130,0.12), transparent 60%)',
      }} />
      <div className="relative flex max-w-md flex-col items-center gap-6 px-6 text-center">
        <div className="grid size-20 place-items-center rounded-2xl border border-[#0b2836] bg-[#03131a] shadow-[0_0_40px_rgba(0,229,255,0.35)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-10" style={{ color: '#86f7ff' }}>
            <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          </svg>
        </div>
        <div>
          <h1 className="font-mono text-3xl font-bold tracking-[0.15em]">
            <span className="bg-gradient-to-r from-[#86f7ff] via-[#b967ff] to-[#4dd6e8] bg-clip-text text-transparent">PSY SAMPLER</span>
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-[#5b6470]">web-audio sampler</p>
        </div>

        {/* Loading progress bar */}
        {loadProgress && (
          <div className="w-full max-w-sm">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-[#9aa3af]">
              <span className="uppercase tracking-wider" style={{ color: '#86f7ff' }}>loading samples…</span>
              <span className="tabular-nums">{loadProgress.loaded}/{loadProgress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-[#0b2836] bg-[#020a0f]">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #86f7ff, #00e5ff)',
                  boxShadow: '0 0 12px rgba(0,229,255,0.6)',
                }}
              />
            </div>
            <div className="mt-1 text-right font-mono text-[11px] tabular-nums text-[#5b6470]">{pct}%</div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="w-full max-w-sm rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-left">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-red-300">⚠</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-300">initialization failed</span>
            </div>
            <p className="break-words font-mono text-[10px] leading-relaxed text-[#cfd6df]">{error}</p>
          </div>
        )}

        <p className="font-mono text-[11px] leading-relaxed text-[#5b6470]">
          Professional web-audio sampler with chord progression generator, velocity tools, and MIDI export.
        </p>

        {!loadProgress && (
          <Button
            onClick={onInit}
            disabled={initializing}
            className="h-12 min-w-[220px] gap-2 border border-[#0b2836] bg-[#03131a] font-mono text-sm font-semibold uppercase tracking-[0.2em] hover:brightness-125 disabled:opacity-50"
            style={{ color: '#86f7ff', boxShadow: '0 0 28px rgba(0,229,255,0.5)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
            </svg>
            {initializing ? 'initializing…' : 'click to initialize audio'}
          </Button>
        )}

        {/* Retry button on error */}
        {error && (
          <Button
            onClick={onInit}
            disabled={initializing}
            className="h-10 gap-2 border border-fuchsia-400/50 bg-zinc-900 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300 hover:bg-fuchsia-500/10"
          >
            retry initialization
          </Button>
        )}

        {/* Keyboard hint */}
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
          shortcuts: <span className="text-[#9aa3af]">[space]</span> play/stop · <span className="text-[#9aa3af]">[esc]</span> stop
        </div>
      </div>
    </div>
  )
}
