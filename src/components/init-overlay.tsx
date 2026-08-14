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
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950">
      <div className="pointer-events-none absolute inset-0 opacity-80" aria-hidden style={{
        background:
          'radial-gradient(60% 50% at 20% 20%, rgba(255,46,136,0.12), transparent 60%), radial-gradient(55% 45% at 80% 30%, rgba(185,103,255,0.12), transparent 60%), radial-gradient(70% 60% at 50% 100%, rgba(0,255,200,0.08), transparent 60%)',
      }} />
      <div className="relative flex max-w-md flex-col items-center gap-6 px-6 text-center">
        <div className="grid size-20 place-items-center rounded-2xl border border-emerald-400/40 bg-zinc-900 shadow-[0_0_40px_rgba(0,255,200,0.45)]">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-10 text-emerald-300">
            <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
            <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          </svg>
        </div>
        <div>
          <h1 className="font-mono text-3xl font-bold tracking-[0.15em]">
            <span className="bg-gradient-to-r from-emerald-300 via-fuchsia-400 to-violet-400 bg-clip-text text-transparent">PSY SAMPLER</span>
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">debug-first · realization device</p>
        </div>

        {/* Loading progress bar */}
        {loadProgress && (
          <div className="w-full max-w-sm">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-zinc-400">
              <span className="uppercase tracking-wider text-emerald-300">loading samples…</span>
              <span className="tabular-nums">{loadProgress.loaded}/{loadProgress.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-zinc-800 bg-zinc-900">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #00ffc8, #b967ff)',
                  boxShadow: '0 0 12px rgba(0,255,200,0.6)',
                }}
              />
            </div>
            <div className="mt-1 text-right font-mono text-[11px] tabular-nums text-zinc-500">{pct}%</div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="w-full max-w-sm rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-left">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-red-300">⚠</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-300">initialization failed</span>
            </div>
            <p className="break-words font-mono text-[10px] leading-relaxed text-zinc-300">{error}</p>
          </div>
        )}

        <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
          creates AudioContext, InMemoryChannel, DeviceHost. registers SamplerDevice + StubDevice.
          drives a 16-step pattern via DemoDirector. all events are visible in the debug panel.
        </p>

        {!loadProgress && (
          <Button
            onClick={onInit}
            disabled={initializing}
            className="h-12 min-w-[220px] gap-2 border border-emerald-400/50 bg-zinc-900 font-mono text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 disabled:opacity-50"
            style={{ boxShadow: '0 0 28px rgba(0,255,200,0.5)' }}
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
          shortcuts: <span className="text-zinc-400">[space]</span> play/stop · <span className="text-zinc-400">[esc]</span> stop
        </div>
      </div>
    </div>
  )
}
