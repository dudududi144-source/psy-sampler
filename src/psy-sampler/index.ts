// PSY Sampler — public API barrel.
//
// The PSY Sampler Device is a canonical family member implementing PsyDevice.
// It consumes MusicalTransport, MusicalContext, and MusicalEvent (NoteEvent)
// from the foundation, and renders sample-based audio via a pooled voice
// architecture with deterministic selection.
//
// See PSY-SAMPLER-ARCHITECTURE-AUDIT.md and PSY-SAMPLER-IMPLEMENTATION-PLAN.md
// for the full design.

// Types
export type {
  SampleId,
  SampleRole,
  SampleBank,
  SampleCategory,
  SampleProvenance,
  SampleCharacter,
  SampleMetadata,
  SampleFeatures,
  SampleAsset,
  SampleManifestEntry,
  SampleManifest,
  ParsedChannel,
  SelectionInput,
  SelectionOutput,
  VoiceTriggerOptions,
  BusName,
} from './types'

export { parseChannel, roleToBus } from './types'

// Provenance
export { ProvenanceError, validateProvenance, isCommerciallyUsable, provenanceFromEntry } from './provenance'

// Manifest
export { ManifestError, loadManifest, validateManifest } from './manifest'

// Loader
export { SampleLoader } from './loader'

// Library
export { SampleLibrary, type LibraryQuery, type LibraryLoadResult } from './library'

// Voice
export { SampleVoice, type SampleVoiceInit } from './voice'

// Round-robin
export {
  RoundRobinBank,
  DEFAULT_VARIANCE_RULES,
  type VarianceRule,
  type RoundRobinResult,
} from './round-robin'

// Selector
export { SelectionPolicy, pitchRatio, type SelectionPolicyOptions } from './selector'

// Scheduler
export {
  RuntimeScheduler,
  type ScheduledSampleEvent,
  type VoiceTriggerFn,
} from './scheduler'

// Audio graph
export { AudioGraph, type AudioGraphOptions } from './audio-graph'

// Device
export { SamplerDevice, wireSchedulerTrigger, type SamplerDeviceOptions } from './device'

// Factory
export { createSamplerDevice, type CreateSamplerOptions, type SamplerBundle } from './factory'
