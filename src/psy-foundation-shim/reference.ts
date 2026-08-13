import type { DeviceCapabilities, MusicalContext, MusicalEvent } from '@psy-foundation/protocol'
import type { MusicalTransport } from '@psy-foundation/transport'
import type { PsyDevice } from './device.ts'

export interface ReferenceDeviceOptions {
  id?: string
  roles?: string[]
}

export class ReferenceDevice implements PsyDevice {
  readonly id: string
  private readonly roles: string[]
  private lastTransport: MusicalTransport | null = null
  private lastContext: MusicalContext | null = null
  private transportCount = 0
  private contextCount = 0
  private eventCount = 0
  private readonly events: MusicalEvent[] = []
  private started = false
  private stopped = false

  constructor(opts: ReferenceDeviceOptions = {}) {
    this.id = opts.id ?? `ref-${Math.random().toString(36).slice(2, 8)}`
    this.roles = opts.roles ?? []
  }

  capabilities(): DeviceCapabilities {
    return {
      audio: false,
      midi: false,
      inputs: 0,
      outputs: 0,
      voices: 0,
      latencyMs: 0,
      roles: this.roles,
    }
  }

  onTransport(transport: MusicalTransport): void {
    this.lastTransport = transport
    this.transportCount += 1
  }
  onContext(context: MusicalContext): void {
    this.lastContext = context
    this.contextCount += 1
  }
  onEvent(event: MusicalEvent): void {
    this.eventCount += 1
    this.events.push(event)
  }
  onStart(): void {
    this.started = true
  }
  onStop(): void {
    this.stopped = true
  }

  get lastKnownTransport(): MusicalTransport | null {
    return this.lastTransport
  }
  get lastKnownContext(): MusicalContext | null {
    return this.lastContext
  }
  get transportUpdates(): number {
    return this.transportCount
  }
  get contextUpdates(): number {
    return this.contextCount
  }
  get eventsReceived(): number {
    return this.eventCount
  }
  get receivedEvents(): readonly MusicalEvent[] {
    return this.events
  }
  get isStarted(): boolean {
    return this.started
  }
  get isStopped(): boolean {
    return this.stopped
  }
}
