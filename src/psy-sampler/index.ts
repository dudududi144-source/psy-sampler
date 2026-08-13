// PSY Sampler — public API barrel.
//
// The PSY Sampler Device is a canonical family member implementing PsyDevice.
// It consumes MusicalTransport, MusicalContext, and MusicalEvent (NoteEvent)
// from the foundation, and renders sample-based audio via a pooled voice
// architecture with genuinely deterministic selection.
//
// See PSY-SAMPLER-FAMILY-INTEGRATION-RECONCILIATION.md for the current
// integration status and ownership boundaries.

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

// Variance rules
export { DEFAULT_VARIANCE_RULES, type VarianceRule } from './variance-rules'

// Selector
export { SelectionPolicy, pitchRatio, type SelectionPolicyOptions } from './selector'

// Realization scheduler (device-local — NOT a family scheduler)
export {
  RealizationScheduler,
  type ScheduledSampleEvent,
  type VoiceTriggerFn,
} from './realization-scheduler'

// Audio graph
export { AudioGraph, type AudioGraphOptions } from './audio-graph'

// Device
export { SamplerDevice, wireSchedulerTrigger, type SamplerDeviceOptions } from './device'

// Factory
export { createSamplerDevice, type CreateSamplerOptions, type SamplerBundle } from './factory'
