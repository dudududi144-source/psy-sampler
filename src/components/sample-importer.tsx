'use client'

// SampleImporter — C2 (ROADMAP-TO-100).
//
// Drag-and-drop WAV import with MANDATORY provenance assertion.
// The user MUST select a license + assert commercial-use rights before the
// sample enters the audio graph. This enforces the SAME provenance policy as
// the manifest path: no unprovenanced sample ever reaches the audio output.
//
// Flow:
//   1. User drags a .wav file onto the drop zone (or clicks to browse).
//   2. We decode it via AudioContext.decodeAudioData.
//   3. The provenance form appears (role, license, author, source, commercialUse checkbox).
//   4. On submit, library.addFromBuffer() is called — it refuses if commercialUse=false
//      or license/source are empty (double enforcement: UI + library).
//   5. The imported sample appears in the SampleLibrary list and participates in selection.

import * as React from 'react'
import type { SampleCategories, SampleAsset } from '@/psy-sampler'
import { ROLES } from '@/components/types'

const LICENSE_OPTIONS = [
  { value: 'CC0 1.0', label: 'CC0 1.0 (Public Domain)' },
  { value: 'CC-BY 4.0', label: 'CC-BY 4.0 (Attribution)' },
  { value: 'CC-BY-SA 4.0', label: 'CC-BY-SA 4.0 (Attribution-ShareAlike)' },
  { value: 'MIT', label: 'MIT License' },
  { value: 'Self-made', label: 'Self-made (I created this)' },
  { value: 'Other', label: 'Other (specify in source)' },
]

interface PendingImport {
  file: File
  buffer: AudioBuffer
  id: string
}

export function SampleImporter({
  audioContext,
  onImport,
}: {
  audioContext: AudioContext | null
  onImport: (asset: SampleAsset) => void
}) {
  const [pending, setPending] = React.useState<PendingImport | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [dragOver, setDragOver] = React.useState(false)
  const [form, setForm] = React.useState({
    category: 'kick' as SampleCategory,
    license: 'CC0 1.0',
    author: '',
    source: '',
    commercialUse: true,
    attribution: '',
    rootNote: 60,
  })

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleFile = React.useCallback(async (file: File) => {
    if (!audioContext) {
      setError('AudioContext not initialized')
      return
    }
    if (!file.name.toLowerCase().endsWith('.wav') && !file.type.includes('audio')) {
      setError('Please drop a .wav file')
      return
    }
    setError(null)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const buffer = await audioContext.decodeAudioData(arrayBuffer)
      const id = `user-${Date.now()}`
      setPending({ file, buffer, id })
    } catch (err) {
      setError(`Failed to decode audio: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [audioContext])

  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleFileInput = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }, [handleFile])

  const submitImport = React.useCallback(() => {
    if (!pending) return
    if (!form.source.trim()) {
      setError('Source is required (where did this sample come from?)')
      return
    }
    if (!form.author.trim()) {
      setError('Author is required')
      return
    }
    if (!form.commercialUse) {
      setError('You must assert commercial-use rights to import. Non-commercial samples are refused.')
      return
    }
    setError(null)
    onImport({
      metadata: {
        id: pending.id,
        file: `import:${pending.id}`,
        category: form.category,
        subcategory: 'user',
        provenance: {
          source: form.source.trim(),
          author: form.author.trim(),
          license: form.license,
          licenseUrl: null,
          commercialUse: form.commercialUse,
          attribution: form.attribution.trim() || null,
          dateAcquired: new Date().toISOString().slice(0, 10),
          usageRestrictions: 'None — user asserted commercial rights',
        },
        character: {
          character: ['user-import'],
          genreFit: [],
          bpmRange: [60, 200],
          rootNote: form.rootNote,
        },
        duration: pending.buffer.duration,
        sampleRate: pending.buffer.sampleRate,
        channels: pending.buffer.numberOfChannels,
      },
      audioBuffer: pending.buffer,
      monoData: new Float32Array(0), // filled by library.addFromBuffer
      features: {
        peak: 0, rms: 0,
        duration: pending.buffer.duration,
        sampleRate: pending.buffer.sampleRate,
        channels: pending.buffer.numberOfChannels,
      },
    })
    setPending(null)
    setForm((prev) => ({ ...prev, source: '', author: '', attribution: '' }))
  }, [pending, form, onImport])

  const cancelImport = React.useCallback(() => {
    setPending(null)
    setError(null)
  }, [])

  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: '#232932', background: 'rgba(11,13,17,0.8)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">IMPORT · drag WAV</h2>
        <span className="font-mono text-[10px]" style={{ color: '#5b6470' }}>provenance required</span>
      </div>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className="flex min-h-[80px] cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-4 transition-all"
        style={{
          borderColor: dragOver ? '#22d3ee' : '#3f3f46',
          backgroundColor: dragOver ? 'rgba(34,211,238,0.1)' : 'rgba(24,24,27,0.5)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,audio/wav,audio/*"
          onChange={handleFileInput}
          className="hidden"
        />
        <span className="font-mono text-xs" style={{ color: '#9aa3af' }}>
          {dragOver ? 'DROP TO DECODE' : 'DROP WAV HERE OR CLICK'}
        </span>
        <span className="mt-1 font-mono text-[10px]" style={{ color: '#5b6470' }}>
          sample enters graph only after license assertion
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 font-mono text-[11px] text-red-300">
          {error}
        </div>
      )}

      {/* Provenance form (appears after decode) */}
      {pending && (
        <div className="mt-3 space-y-2 rounded border border-cyan-500/30 bg-cyan-500/5 p-3">
          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-300">
            decoded: {pending.file.name} ({pending.buffer.duration.toFixed(2)}s, {pending.buffer.sampleRate}Hz, {pending.buffer.numberOfChannels}ch)
          </div>

          {/* Role selector */}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>role</span>
            <select
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value as SampleCategory }))}
              className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>

          {/* License selector */}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>license</span>
            <select
              value={form.license}
              onChange={(e) => setForm((prev) => ({ ...prev, license: e.target.value }))}
              className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
            >
              {LICENSE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </label>

          {/* Author */}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>author *</span>
            <input
              type="text"
              value={form.author}
              onChange={(e) => setForm((prev) => ({ ...prev, author: e.target.value }))}
              placeholder="e.g. Jane Doe"
              className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
            />
          </label>

          {/* Source */}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>source * (where from?)</span>
            <input
              type="text"
              value={form.source}
              onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
              placeholder="e.g. freesound.org/user123, self-recorded, etc."
              className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
            />
          </label>

          {/* Root note (for pitched roles) */}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>root note (MIDI, for bass/lead)</span>
            <input
              type="number"
              min={0}
              max={127}
              value={form.rootNote}
              onChange={(e) => setForm((prev) => ({ ...prev, rootNote: parseInt(e.target.value) || 60 }))}
              className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
            />
          </label>

          {/* Commercial use checkbox */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.commercialUse}
              onChange={(e) => setForm((prev) => ({ ...prev, commercialUse: e.target.checked }))}
              className="h-4 w-4"
            />
            <span className="font-mono text-[10px]" style={{ color: '#cfd6df' }}>
              I assert this sample may be used commercially *
            </span>
          </label>

          {/* Attribution */}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: '#5b6470' }}>attribution (optional)</span>
            <input
              type="text"
              value={form.attribution}
              onChange={(e) => setForm((prev) => ({ ...prev, attribution: e.target.value }))}
              placeholder="e.g. Copyright Jane Doe 2026"
              className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-xs"
              style={{ borderColor: '#282e38', background: '#14161c', color: '#cfd6df' }}
            />
          </label>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={submitImport}
              className="min-h-[44px] touch-manipulation flex-1 rounded border border-cyan-400/50 bg-cyan-500/20 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-cyan-200 transition-all hover:bg-cyan-500/30"
            >
              import to library
            </button>
            <button
              onClick={cancelImport}
              className="min-h-[44px] touch-manipulation rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider transition-all hover:brightness-125"
              style={{ borderColor: '#3a4150', color: '#9aa3af' }}
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
