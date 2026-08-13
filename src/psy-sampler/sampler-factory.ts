// PSY Sampler — Registry-compatible factory.
//
// Wraps the createSamplerDevice bundle into a DeviceFactory that can be
// registered with DeviceRegistry. This is the integration adapter that makes
// the sampler discoverable by any PSY family host.
//
// Usage:
//   import { samplerDeviceFactory } from '@psy-sampler/device'
//   import { DeviceRegistry } from '@psy-sampler/device'
//
//   const registry = new DeviceRegistry()
//   registry.register(samplerDeviceFactory)
//
//   const factory = registry.get('sampler')!
//   const bundle = factory.create({ audioContext, manifestUrl: '/samples/manifest.json' })
//   await bundle.load()
//   host.register(bundle.device)

import type { DeviceFactory } from './registry'
import { createSamplerDevice, type SamplerBundle, type CreateSamplerOptions } from './factory'
import type { DeviceCapabilities } from '../psy-foundation-shim'

/**
 * Static capabilities declaration for discovery (before instantiation).
 */
export const samplerCapabilities: DeviceCapabilities = {
  audio: true,
  midi: false,
  inputs: 0,
  outputs: 1,
  voices: 32,
  latencyMs: 5,
  roles: ['sampler', 'kick', 'bass', 'hat', 'perc', 'snare', 'clap', 'lead', 'fx'],
}

/**
 * The sampler device factory — registerable with DeviceRegistry.
 *
 * create() returns a SamplerBundle (which contains the device + helpers).
 * The host extracts bundle.device for DeviceHost.register().
 */
export const samplerDeviceFactory: DeviceFactory<CreateSamplerOptions, SamplerBundle> = {
  type: 'sampler',
  name: 'PSY Sampler Device',
  capabilities: samplerCapabilities,
  create(options: CreateSamplerOptions): SamplerBundle {
    return createSamplerDevice(options)
  },
}
