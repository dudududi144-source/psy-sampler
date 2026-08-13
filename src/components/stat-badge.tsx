'use client'

// Stat — small labelled value badge used in headers / debug panels.

export function Stat({ label, value, color = 'emerald' }: { label: string; value: string | number; color?: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-300 border-emerald-400/30',
    fuchsia: 'text-fuchsia-300 border-fuchsia-400/30',
    violet: 'text-violet-300 border-violet-400/30',
    amber: 'text-amber-300 border-amber-400/30',
    zinc: 'text-zinc-300 border-zinc-400/30',
  }
  return (
    <div className={`flex flex-col gap-0.5 rounded border ${colorMap[color] ?? colorMap.emerald} bg-zinc-900/60 px-2.5 py-1.5`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums">{value}</span>
    </div>
  )
}
