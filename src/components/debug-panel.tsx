'use client'

// DebugPanel — projects device state: stats grid + lastEvent + transport + context
// + capabilities + scrollable event log. Auto-scrolls the log to the newest entry.

import * as React from 'react'
import { parseChannel } from '@/psy-sampler'
import { Stat } from '@/components/stat-badge'
import {
  ROLE_COLORS,
  EVENT_LOG_MAX,
  type DeviceStats,
  type EventLogEntry,
} from '@/components/types'

export function DebugPanel({ stats, eventLog }: { stats: DeviceStats; eventLog: EventLogEntry[] }) {
  const lastEv = stats.lastEvent
  const caps = stats.capabilities
  const transport = stats.lastTransport
  const context = stats.lastContext

  const logRef = React.useRef<HTMLDivElement>(null)
  // Auto-scroll to newest event.
  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0
  }, [eventLog])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="size-2 animate-pulse rounded-full bg-emerald-400" style={{ boxShadow: '0 0 8px rgba(0,255,200,0.8)' }} />
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">DEBUG · event flow</h2>
      </div>

      {/* Device stats grid */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Stat label="EVENTS" value={stats.eventsReceived} color="emerald" />
        <Stat label="TRIGGERED" value={stats.notesTriggered} color="emerald" />
        <Stat label="SKIPPED" value={stats.notesSkipped} color={stats.notesSkipped > 0 ? 'amber' : 'zinc'} />
        <Stat label="VOICES" value={`${stats.activeVoices}/32`} color="fuchsia" />
        <Stat label="PENDING" value={stats.pendingEvents} color="violet" />
      </div>

      {/* Performance stats */}
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        <Stat label="N/SEC" value={stats.notesPerSec.toFixed(1)} color="cyan" />
        <Stat label="PEAK" value={stats.peakVoices} color={stats.peakVoices >= 28 ? 'amber' : 'zinc'} />
        <Stat label="UPTIME" value={`${stats.uptimeSec.toFixed(0)}s`} color="zinc" />
        <Stat label="LIB" value={stats.librarySize} color="violet" />
      </div>

      {/* Last event — the key debug info */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">LAST EVENT</div>
        {lastEv ? (
          <div className="space-y-0.5 font-mono text-[11px]">
            <div className="flex justify-between">
              <span className="text-zinc-500">channel</span>
              <span className="text-emerald-300">{lastEv.channel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">note</span>
              <span className="tabular-nums text-fuchsia-300">{lastEv.note}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">velocity</span>
              <span className="tabular-nums text-violet-300">{lastEv.velocity.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">at</span>
              <span className="tabular-nums text-amber-300">{lastEv.at.toFixed(3)}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">sample</span>
              <span className="text-emerald-300">{lastEv.sampleId ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">triggered</span>
              <span className={lastEv.triggered ? 'text-emerald-300' : 'text-amber-300'}>
                {lastEv.triggered ? '✓ YES' : '✗ SKIPPED'}
              </span>
            </div>
          </div>
        ) : (
          <div className="font-mono text-[11px] text-zinc-600">no events yet — press PLAY</div>
        )}
      </div>

      {/* Transport + Context */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">TRANSPORT</div>
          {transport ? (
            <div className="space-y-0.5 font-mono text-[10px] text-zinc-400">
              <div>bpm: <span className="tabular-nums text-emerald-300">{transport.bpm}</span></div>
              <div>bar: <span className="tabular-nums text-fuchsia-300">{transport.bar}</span></div>
              <div>rev: <span className="tabular-nums text-violet-300">{transport.revision}</span></div>
              <div>locked: <span className={transport.locked ? 'text-emerald-300' : 'text-amber-300'}>{transport.locked ? 'YES' : 'NO'}</span></div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-zinc-600">—</div>
          )}
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">CONTEXT</div>
          {context ? (
            <div className="space-y-0.5 font-mono text-[10px] text-zinc-400">
              <div>section: <span className="text-emerald-300">{context.section}</span></div>
              <div>energy: <span className="tabular-nums text-fuchsia-300">{context.energy.toFixed(2)}</span></div>
              <div>style: <span className="text-violet-300">{context.style}</span></div>
              <div>key: <span className="text-amber-300">{context.key}</span></div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-zinc-600">—</div>
          )}
        </div>
      </div>

      {/* Capabilities */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">CAPABILITIES · roles</div>
        <div className="flex flex-wrap gap-1">
          {caps.roles.map((r) => (
            <span key={r} className="rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
              {r}
            </span>
          ))}
        </div>
      </div>

      {/* Scrollable event log */}
      <div className="mt-3 rounded border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">EVENT LOG · last {EVENT_LOG_MAX}</div>
          <span className="font-mono text-[10px] tabular-nums text-zinc-600">{eventLog.length}</span>
        </div>
        <div
          ref={logRef}
          className="max-h-44 space-y-0.5 overflow-y-auto pr-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {eventLog.length === 0 ? (
            <div className="font-mono text-[10px] text-zinc-600">no events yet</div>
          ) : (
            eventLog.map((e) => {
              const role = parseChannel(e.channel).role
              const color = role ? (ROLE_COLORS[role] ?? '#a1a1aa') : '#a1a1aa'
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded px-1 py-0.5 font-mono text-[11px] hover:bg-zinc-800/40"
                >
                  <span className="w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}80` }} />
                  <span className="w-12 shrink-0 tabular-nums text-zinc-600">{(e.receivedAt / 1000 % 1000).toFixed(2)}s</span>
                  <span className="w-16 shrink-0 truncate" style={{ color }}>{e.channel}</span>
                  <span className="w-8 shrink-0 tabular-nums text-fuchsia-300">{e.note}</span>
                  <span className="w-10 shrink-0 tabular-nums text-violet-300">v{e.velocity.toFixed(2)}</span>
                  <span className="flex-1 truncate text-emerald-300">{e.sampleId ?? '—'}</span>
                  <span className={e.triggered ? 'text-emerald-400' : 'text-amber-400'}>
                    {e.triggered ? '✓' : '✗'}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
