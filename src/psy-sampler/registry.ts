// PSY Family — DeviceRegistry
//
// The missing family integration seam.
//
// Foundation provides PsyDevice + DeviceHost (canonical contracts) but does NOT
// provide a discovery/registry mechanism. This module is the smallest seam that
// allows a PSY family host to:
//   1. discover what realization devices are available
//   2. instantiate a device via its factory
//   3. register it with DeviceHost
//
// This is a TYPE C seam (missing family integration seam) per the architecture
// gate. It does NOT modify Foundation. It does NOT create a second contract.
// It uses Foundation's PsyDevice + DeviceHost as-is.
//
// When Foundation eventually provides a canonical registry, this module can be
// deprecated in favor of the canonical one.

import type { PsyDevice, DeviceCapabilities } from '../psy-foundation-shim'

/**
 * A device factory creates a device instance from options.
 * The factory is the registration unit — it knows how to construct a device.
 */
export interface DeviceFactory<TOptions = unknown> {
  /** The device type identifier (e.g., 'sampler', 'synth', 'drums'). */
  readonly type: string
  /** Human-readable name. */
  readonly name: string
  /** The capabilities the device will report (declared statically for discovery). */
  readonly capabilities: DeviceCapabilities
  /** Create a device instance. */
  create(options: TOptions): PsyDevice
}

/**
 * Registry entry for a discovered device factory.
 */
export interface RegistryEntry<TOptions = unknown> {
  readonly factory: DeviceFactory<TOptions>
  readonly registeredAt: number
}

/**
 * DeviceRegistry — the family-level device discovery mechanism.
 *
 * Usage:
 *   const registry = new DeviceRegistry()
 *   registry.register(samplerFactory)
 *   registry.register(synthFactory)
 *
 *   const available = registry.list()  // [{ type, name, capabilities }]
 *   const factory = registry.get('sampler')
 *   const device = factory.create({ audioContext, ... })
 *   host.register(device)
 */
export class DeviceRegistry {
  private readonly factories = new Map<string, RegistryEntry<any>>()

  /**
   * Register a device factory.
   * Throws if a factory with the same type is already registered.
   */
  register<TOptions>(factory: DeviceFactory<TOptions>): void {
    if (this.factories.has(factory.type)) {
      throw new Error(`Device factory already registered: ${factory.type}`)
    }
    this.factories.set(factory.type, {
      factory,
      registeredAt: Date.now(),
    })
  }

  /**
   * Unregister a device factory by type.
   */
  unregister(type: string): void {
    this.factories.delete(type)
  }

  /**
   * Get a device factory by type.
   * Returns undefined if not found.
   */
  get<TOptions = unknown>(type: string): DeviceFactory<TOptions> | undefined {
    const entry = this.factories.get(type)
    return entry?.factory as DeviceFactory<TOptions> | undefined
  }

  /**
   * List all registered device factories (for discovery).
   * Returns a summary suitable for UIs or programmatic selection.
   */
  list(): Array<{
    type: string
    name: string
    capabilities: DeviceCapabilities
  }> {
    return Array.from(this.factories.values()).map((entry) => ({
      type: entry.factory.type,
      name: entry.factory.name,
      capabilities: entry.factory.capabilities,
    }))
  }

  /**
   * Find devices by role (e.g., 'kick', 'bass', 'lead').
   * Returns factories whose capabilities.roles include the given role.
   */
  findByRole(role: string): Array<{
    type: string
    name: string
    capabilities: DeviceCapabilities
  }> {
    return this.list().filter((d) => d.capabilities.roles.includes(role))
  }

  /**
   * Check if a device type is registered.
   */
  has(type: string): boolean {
    return this.factories.has(type)
  }

  /**
   * Number of registered device factories.
   */
  get size(): number {
    return this.factories.size
  }

  /**
   * Clear all registered factories.
   */
  clear(): void {
    this.factories.clear()
  }
}
