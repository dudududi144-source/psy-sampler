'use client'

// SampleEditModal — sample editor modal (Phase 2.3.2).
//
// Provides trim, fade in/out, normalize, and reverse controls for a sample.
// All edits are NON-DESTRUCTIVE — the modal works on a copy, shows a preview,
// and only commits to the library when the user clicks "APPLY".
//
// The modal is opened from the SampleLibrary's "EDIT" button (Phase 2.3.3).
// It receives the current sample's AudioBuffer + metadata, and calls
// onApply with the edited buffer + new monoData + features.

import * as React from 'react'
import type { SampleAsset } from '@/psy-sampler'
import { applyEdits, toMono } from '@/psy-sampler'
import { ScrubableWaveform } from '@/components/scrubable-waveform'

export interface SampleEditModalProps {
  /** The sample to edit. */
  asset: SampleAsset
  /** The AudioContext (for creating new AudioBuffers). */
  audioContext: AudioContext | null
  /** Called when the user clicks APPLY. Receives the edited asset. */
  onApply: (edited: SampleAsset) => void
  /** Called when the user cancels / closes the modal. */
  onCancel: () => void
}

export function SampleEditModal({ asset, audioContext, onApply, onCancel }: SampleEditModalProps) {
  const buf = asset.audioBuffer
  const [trimStart, setTrimStart] = React.useState(0)
  const [trimEnd, setTrimEnd] = React.useState(buf.duration)
  const [fadeIn, setFadeIn] = React.useState(0)
  const [fadeOut, setFadeOut] = React.useState(0)
  const [reverse, setReverse] = React.useState(false)
  const [normalize, setNormalize] = React.useState(false)
  const [previewFraction, setPreviewFraction] = React.useState(0)

  // Build the preview buffer (edits applied) for the waveform display.
  // useMemo so we don't recompute on every render (only when inputs change).
  const previewData = React.useMemo(() => {
    if (!audioContext) return asset.monoData
    const edited = applyEdits(buf, audioContext, {
      trimStart,
      trimEnd,
      reverse,
      fadeIn,
      fadeOut,
      normalize: normalize ? 0.95 : 0,
    })
    return toMono(edited)
  }, [buf, audioContext, trimStart, trimEnd, reverse, fadeIn, fadeOut, normalize, asset.monoData])

  const color = '#b8e05a'  // library green

  const handleApply = () => {
    if (!audioContext) return
    const edited = applyEdits(buf, audioContext, {
      trimStart,
      trimEnd,
      reverse,
      fadeIn,
      fadeOut,
      normalize: normalize ? 0.95 : 0,
    })
    const monoData = toMono(edited)
    // Recompute features.
    let peak = 0
    let sumSq = 0
    for (let i = 0; i < monoData.length; i++) {
      const s = Math.abs(monoData[i])
      if (s > peak) peak = s
      sumSq += monoData[i] * monoData[i]
    }
    const rms = monoData.length > 0 ? Math.sqrt(sumSq / monoData.length) : 0
    const editedAsset: SampleAsset = {
      metadata: {
        ...asset.metadata,
        duration: edited.duration,
        sampleRate: edited.sampleRate,
        channels: edited.numberOfChannels,
      },
      audioBuffer: edited,
      monoData,
      features: {
        peak,
        rms,
        duration: edited.duration,
        sampleRate: edited.sampleRate,
        channels: edited.numberOfChannels,
      },
    }
    onApply(editedAsset)
  }

  const handleReset = () => {
    setTrimStart(0)
    setTrimEnd(buf.duration)
    setFadeIn(0)
    setFadeOut(0)
    setReverse(false)
    setNormalize(false)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0b0d11',
          border: '1px solid #232932',
          borderRadius: '8px',
          padding: '20px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em]" style={{ color }}>
            EDIT · {asset.metadata.id}
          </h2>
          <button
            onClick={onCancel}
            className="rounded border px-2 py-0.5 font-mono text-[10px] uppercase hover:brightness-125"
            style={{ borderColor: '#3a4150', color: '#9aa3af' }}
          >
            ✕ CLOSE
          </button>
        </div>

        {/* Waveform preview */}
        <div className="mb-4">
          <ScrubableWaveform
            data={previewData}
            sampleRate={buf.sampleRate}
            color={color}
            onScrub={(f) => setPreviewFraction(f)}
            playFraction={previewFraction}
            height={60}
          />
          <div className="mt-1 flex justify-between font-mono text-[9px]" style={{ color: '#5b6470' }}>
            <span>0:00</span>
            <span>preview (edits applied live)</span>
            <span>{(previewData.length / buf.sampleRate).toFixed(2)}s</span>
          </div>
        </div>

        {/* Trim controls */}
        <div className="mb-3">
          <div className="mb-1 font-mono text-[10px] uppercase" style={{ color: '#9aa3af' }}>TRIM</div>
          <div className="space-y-1">
            <label className="flex items-center gap-2">
              <span className="w-16 font-mono text-[10px]" style={{ color: '#5b6470' }}>start</span>
              <input
                type="range"
                min={0}
                max={buf.duration - 0.01}
                step={0.001}
                value={trimStart}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  setTrimStart(Math.min(v, trimEnd - 0.001))
                }}
                className="h-2 flex-1"
                style={{ accentColor: color }}
              />
              <span className="w-12 text-right font-mono text-[10px] tabular-nums" style={{ color: '#9aa3af' }}>
                {trimStart.toFixed(3)}s
              </span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 font-mono text-[10px]" style={{ color: '#5b6470' }}>end</span>
              <input
                type="range"
                min={0.01}
                max={buf.duration}
                step={0.001}
                value={trimEnd}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  setTrimEnd(Math.max(v, trimStart + 0.001))
                }}
                className="h-2 flex-1"
                style={{ accentColor: color }}
              />
              <span className="w-12 text-right font-mono text-[10px] tabular-nums" style={{ color: '#9aa3af' }}>
                {trimEnd.toFixed(3)}s
              </span>
            </label>
          </div>
        </div>

        {/* Fade controls */}
        <div className="mb-3">
          <div className="mb-1 font-mono text-[10px] uppercase" style={{ color: '#9aa3af' }}>FADES</div>
          <div className="space-y-1">
            <label className="flex items-center gap-2">
              <span className="w-16 font-mono text-[10px]" style={{ color: '#5b6470' }}>fade in</span>
              <input
                type="range"
                min={0}
                max={Math.min(1, buf.duration / 2)}
                step={0.005}
                value={fadeIn}
                onChange={(e) => setFadeIn(parseFloat(e.target.value))}
                className="h-2 flex-1"
                style={{ accentColor: '#22d3ee' }}
              />
              <span className="w-12 text-right font-mono text-[10px] tabular-nums" style={{ color: '#9aa3af' }}>
                {fadeIn > 0 ? `${fadeIn.toFixed(3)}s` : 'off'}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 font-mono text-[10px]" style={{ color: '#5b6470' }}>fade out</span>
              <input
                type="range"
                min={0}
                max={Math.min(1, buf.duration / 2)}
                step={0.005}
                value={fadeOut}
                onChange={(e) => setFadeOut(parseFloat(e.target.value))}
                className="h-2 flex-1"
                style={{ accentColor: '#22d3ee' }}
              />
              <span className="w-12 text-right font-mono text-[10px] tabular-nums" style={{ color: '#9aa3af' }}>
                {fadeOut > 0 ? `${fadeOut.toFixed(3)}s` : 'off'}
              </span>
            </label>
          </div>
        </div>

        {/* Reverse + Normalize toggles */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setReverse(!reverse)}
            className="rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-wider hover:brightness-125"
            style={{
              borderColor: reverse ? '#ff2e88' : '#3a4150',
              color: reverse ? '#ff2e88' : '#9aa3af',
              background: reverse ? 'rgba(255,46,136,0.1)' : 'transparent',
            }}
          >
            REVERSE
          </button>
          <button
            onClick={() => setNormalize(!normalize)}
            className="rounded border px-3 py-1 font-mono text-[10px] uppercase tracking-wider hover:brightness-125"
            style={{
              borderColor: normalize ? '#b8e05a' : '#3a4150',
              color: normalize ? '#b8e05a' : '#9aa3af',
              background: normalize ? 'rgba(184,224,90,0.1)' : 'transparent',
            }}
          >
            NORMALIZE 0.95
          </button>
        </div>

        {/* Footer actions */}
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={!audioContext}
            className="min-h-[44px] touch-manipulation flex-1 rounded border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-all hover:brightness-125 disabled:opacity-40"
            style={{
              borderColor: '#b8e05a',
              color: '#b8e05a',
              background: 'rgba(184,224,90,0.1)',
            }}
          >
            APPLY EDITS
          </button>
          <button
            onClick={handleReset}
            className="min-h-[44px] touch-manipulation rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider hover:brightness-125"
            style={{ borderColor: '#3a4150', color: '#9aa3af' }}
          >
            RESET
          </button>
          <button
            onClick={onCancel}
            className="min-h-[44px] touch-manipulation rounded border px-3 py-2 font-mono text-xs uppercase tracking-wider hover:brightness-125"
            style={{ borderColor: '#3a4150', color: '#9aa3af' }}
          >
            CANCEL
          </button>
        </div>

        {/* Honest limitation note */}
        <p className="mt-3 font-mono text-[9px]" style={{ color: '#5b6470' }}>
          Edits are non-destructive — APPLY replaces the sample in the library
          with the edited version. The original file on disk is unchanged.
        </p>
      </div>
    </div>
  )
}
