// PSY Sampler — device factory.
// Wires together all components into a ready-to-register SamplerDevice.

import { SampleLibrary } from './library'
import { SampleLoader } from './loader'
import { SelectionPolicy } from './selector'
import { RealizationScheduler } from './realization-scheduler'
import { AudioGraph } from './audio-graph'
import { SampleVoice } from './voice'
import { SamplerDevice, wireSchedulerTrigger } from './device'
import { VoicePool } from '../psy-foundation-shim'
import type { BusName } from './types'

export interface CreateSamplerOptions {
  audioContext: AudioContext
  manifestUrl: string
  voiceCount?: number
  masterGain?: number
  /**
   * External output node (for shared AudioContext with host).
   * If provided, the sampler's master chain connects here instead of ctx.destination.
   * This enables shared master/limiter/ducking when the host provides a bus input.
   */
  outputNode?: AudioNode | null
  onLoaded?: (result: { loaded: number; skipped: number; total: number }) => void
  /** Progress callback during sample loading (for UI progress bar). */
  onProgress?: (loaded: number, total: number) => void
}

export interface SamplerBundle {
  device: SamplerDevice
  library: SampleLibrary
  selectionPolicy: SelectionPolicy
  scheduler: RealizationScheduler
  audioGraph: AudioGraph
  voicePool: VoicePool<SampleVoice>
  /** Load samples from the manifest. Must be called before the device can play. */
  load: () => Promise<{ loaded: number; skipped: number; total: number }>
  /** Dispose all resources (scheduler, voice pool, audio graph). */
  dispose: () => void
}

/**
 * Create a fully-wired SamplerDevice bundle.
 *
 * Usage:
 *   const bundle = createSamplerDevice({ audioContext, manifestUrl: '/samples/manifest.json' })
 *   await bundle.load()
 *   host.register(bundle.device)
 */
export function createSamplerDevice(opts: CreateSamplerOptions): SamplerBundle {
  const ctx = opts.audioContext
  const voiceCount = opts.voiceCount ?? 32

  // 1. Audio graph (buses + FX + master). Connects to outputNode if provided.
  const audioGraph = new AudioGraph(ctx, {
    masterGain: opts.masterGain ?? 0.85,
    outputNode: opts.outputNode ?? null,
  })

  // 2. Voice pool — preallocate `voiceCount` SampleVoices, all connected to the drum bus by default.
  //    The device re-routes each voice to the correct bus per event.
  const defaultBus = audioGraph.getBusInput('drum' as BusName)
  const voicePool = new VoicePool<SampleVoice>(
    () => new SampleVoice({ audioContext: ctx, output: defaultBus }),
    voiceCount
  )

  // 3. Sample library + loader.
  const loader = new SampleLoader(ctx)
  const library = new SampleLibrary(loader)

  // 4. Selection policy (deterministic).
  const selectionPolicy = new SelectionPolicy(library)

  // 5. Realization scheduler (device-local — fires voices at host-decided event.at).
  const scheduler = new RealizationScheduler(ctx)

  // 6. Wire the scheduler's trigger function to the voice pool + audio graph.
  wireSchedulerTrigger(scheduler, voicePool, audioGraph)

  // 7. The device.
  const device = new SamplerDevice({
    audioContext: ctx,
    library,
    selectionPolicy,
    scheduler,
    audioGraph,
    voicePool,
    voiceCount,
    manifestUrl: opts.manifestUrl,
  })

  return {
    device,
    library,
    selectionPolicy,
    scheduler,
    audioGraph,
    voicePool,
    load: async () => {
      const result = await library.load(opts.manifestUrl, opts.onProgress)
      opts.onLoaded?.(result)
      return result
    },
    dispose: () => {
      scheduler.stop()
      voicePool.panic()
      audioGraph.dispose()
    },
  }
}
