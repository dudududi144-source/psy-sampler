'use client'

// use-mixer-ops — encapsulates all bus-level mixer state + callbacks.
//
// Extracted from src/app/page.tsx. This hook owns:
//   - busState (drum/music/atmos: gain, muted, solo, eq, saturation)
//   - filterMode ('off' | 'lp' | 'hp')
//
// And exposes 7 callbacks:
//   onBusGain, onBusEQ, onBusSaturation, onBusMute, onBusSolo,
//   loadMixerPreset, resetMixer.
//
// The hook receives:
//   - bundleRef (ref to SamplerBundle — the audioGraph is the source of truth
//     for DSP routing; busState is the UI mirror)
//
// Independent of usePatternOps() — these are master-level operations on the
// 3-bus mixer, not per-instrument. Per-role mute/solo lives in usePatternOps.

import * as React from 'react'
import type { SamplerBundle } from '@/psy-sampler'
import type { BusName } from '@/psy-sampler'
import { BUS_NAMES } from '@/components/types'
import type { BusMixerState } from '@/components/types'
import type { MixerPreset } from '@/lib/mixer-presets'
import { useToast } from '@/hooks/use-toast'

const DEFAULT_BUS_STATE: Record<BusName, BusMixerState> = {
  drum: { gain: 0.9, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  music: { gain: 0.85, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
  atmos: { gain: 0.7, muted: false, solo: false, eqLow: 0, eqMid: 0, eqHigh: 0, saturation: 0 },
}

export interface UseMixerOpsOptions {
  bundleRef: React.MutableRefObject<SamplerBundle | null>
}

export function useMixerOps(opts: UseMixerOpsOptions) {
  const { bundleRef } = opts
  const { toast } = useToast()

  const [busState, setBusState] = React.useState<Record<BusName, BusMixerState>>(structuredClone(DEFAULT_BUS_STATE))
  const [filterMode, setFilterMode] = React.useState<'off' | 'lp' | 'hp'>('off')

  // Mirror busState in a ref so callbacks can read the latest value without
  // re-creating on every state change (which would invalidate useCallback's
  // deps and re-trigger renders downstream).
  const busStateRef = React.useRef(busState)
  React.useEffect(() => { busStateRef.current = busState }, [busState])

  const onBusGain = React.useCallback((name: BusName, value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusGain(name, value)
      const soloed = BUS_NAMES.filter((n) => busStateRef.current[n].solo)
      if (soloed.length > 0) graph.applySolo(soloed)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], gain: value } }))
  }, [bundleRef])

  const onBusEQ = React.useCallback((name: BusName, band: 'low' | 'mid' | 'high', value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusEQ(name, { [band]: value })
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], [`eq${band.charAt(0).toUpperCase() + band.slice(1)}`]: value } }))
  }, [bundleRef])

  const onBusSaturation = React.useCallback((name: BusName, value: number) => {
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusSaturation(name, value)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], saturation: value } }))
  }, [bundleRef])

  const onBusMute = React.useCallback((name: BusName) => {
    const newMuted = !busStateRef.current[name].muted
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      graph.setBusMuted(name, newMuted)
      const soloed = BUS_NAMES.filter((n) => busStateRef.current[n].solo)
      if (soloed.length > 0) graph.applySolo(soloed)
    }
    setBusState((prev) => ({ ...prev, [name]: { ...prev[name], muted: newMuted } }))
  }, [bundleRef])

  const onBusSolo = React.useCallback((name: BusName) => {
    const newSolo = !busStateRef.current[name].solo
    const next = { ...busStateRef.current, [name]: { ...busStateRef.current[name], solo: newSolo } }
    const soloed = BUS_NAMES.filter((n) => next[n].solo)
    const graph = bundleRef.current?.audioGraph
    if (graph) {
      if (soloed.length > 0) {
        graph.applySolo(soloed)
      } else {
        BUS_NAMES.forEach((n) => graph.setBusGain(n, next[n].gain))
      }
    }
    setBusState(next)
  }, [bundleRef])

  /** Load a mixer preset (EQ + saturation + filter per genre). */
  const loadMixerPreset = React.useCallback((preset: MixerPreset) => {
    const graph = bundleRef.current?.audioGraph
    setBusState(preset.busState)
    setFilterMode(preset.filterMode)
    if (graph) {
      for (const busName of ['drum', 'music', 'atmos'] as const) {
        const bs = preset.busState[busName]
        graph.setBusGain(busName, bs.gain)
        graph.setBusMuted(busName, bs.muted)
        graph.setBusEQ(busName, { low: bs.eqLow, mid: bs.eqMid, high: bs.eqHigh })
        graph.setBusSaturation(busName, bs.saturation)
      }
      if (preset.filterMode === 'off') {
        graph.setMasterFilter({ type: 'allpass', freq: 20000, Q: 1 })
        graph.setFilterEnvelopeEnabled(false)
      } else if (preset.filterMode === 'lp') {
        graph.setMasterFilter({ type: 'lowpass', freq: 8000, Q: 2 })
        graph.setFilterEnvelopeEnabled(true)
        graph.setFilterEnvelopeParams(0.6, 0.25)
      } else {
        graph.setMasterFilter({ type: 'highpass', freq: 200, Q: 1.5 })
        graph.setFilterEnvelopeEnabled(false)
      }
    }
    toast({ title: `Mixer: ${preset.name}`, description: 'EQ + saturation + filter applied' })
  }, [bundleRef, toast])

  /** Reset mixer to default (used when loading a project). */
  const resetMixer = React.useCallback((state: Record<BusName, BusMixerState>, mode: 'off' | 'lp' | 'hp') => {
    setBusState(state)
    setFilterMode(mode)
  }, [])

  return {
    busState,
    busStateRef,
    filterMode,
    setBusState,
    setFilterMode,
    onBusGain,
    onBusEQ,
    onBusSaturation,
    onBusMute,
    onBusSolo,
    loadMixerPreset,
    resetMixer,
  }
}

export type UseMixerOpsResult = ReturnType<typeof useMixerOps>
