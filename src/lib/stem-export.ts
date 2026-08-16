// Stem export — render each bus (drum/music/atmos) as a separate WAV.
//
// This is the "stem mastering" workflow: a producer exports each bus as a
// separate WAV, then mixes them in an external DAW with full plugin chains.
// Professional releases are often stem-mastered.
//
// We render 3 times — once per bus — using the SAME events but soloing each
// bus in turn. The output is 3 WAV files (drum.wav, music.wav, atmos.wav)
// downloaded in sequence.
//
// All 3 renders are deterministic (same seed → same output).

import type { NoteEvent, MusicalTransport } from '@/psy-foundation-shim'
import type { SampleLibrary, SelectionPolicy, BusName } from '@/psy-sampler'
import { renderOffline, type OfflineRenderOptions } from './offline-render'
import type { BusMixerState } from '@/components/types'

export interface StemExportOptions {
  library: SampleLibrary
  selectionPolicy: SelectionPolicy
  events: NoteEvent[]
  transport: MusicalTransport
  durationSec: number
  sampleRate?: number
  masterGain: number
  voiceCount?: number
  sidechain?: { enabled: boolean; depth?: number }
  busEQ?: OfflineRenderOptions['busEQ']
  busSaturation?: OfflineRenderOptions['busSaturation']
  masterFilter?: OfflineRenderOptions['masterFilter']
  filterEnvelope?: OfflineRenderOptions['filterEnvelope']
  /** Base filename (without extension). Each stem gets _{bus} appended. */
  baseFilename: string
}

export interface StemExportResult {
  stems: Array<{
    bus: BusName
    blob: Blob
    renderMs: number
    eventsRealized: number
  }>
  totalMs: number
}

/**
 * Export each bus as a separate WAV file. Renders 3 times — once per bus —
 * with all other buses muted (soloed). Downloads each as {base}_{bus}.wav.
 *
 * This is slower than a single render (3× the time) but enables stem
 * mastering in an external DAW.
 */
export async function exportStems(opts: StemExportOptions): Promise<StemExportResult> {
  const buses: BusName[] = ['drum', 'music', 'atmos']
  const results: StemExportResult['stems'] = []
  const t0 = performance.now()

  for (const bus of buses) {
    // Render with ONLY this bus audible (others muted via gain=0).
    const busGains = {
      drum: bus === 'drum' ? 0.9 : 0,
      music: bus === 'music' ? 0.85 : 0,
      atmos: bus === 'atmos' ? 0.7 : 0,
    }

    const result = await renderOffline({
      library: opts.library,
      selectionPolicy: opts.selectionPolicy,
      events: opts.events,
      transport: opts.transport,
      durationSec: opts.durationSec,
      sampleRate: opts.sampleRate,
      masterGain: opts.masterGain,
      voiceCount: opts.voiceCount,
      sidechain: opts.sidechain,
      busGains,
      busEQ: opts.busEQ,
      busSaturation: opts.busSaturation,
      masterFilter: opts.masterFilter,
      filterEnvelope: opts.filterEnvelope,
      filename: `${opts.baseFilename}_${bus}.wav`,
      download: true,
    })

    results.push({
      bus,
      blob: result.blob,
      renderMs: result.renderMs,
      eventsRealized: result.eventsRealized,
    })
  }

  return {
    stems: results,
    totalMs: performance.now() - t0,
  }
}
