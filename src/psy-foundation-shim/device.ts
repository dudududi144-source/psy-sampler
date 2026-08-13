// VERBATIM SHIM from psy-foundation/packages/device-sdk/src/device.ts
// Source: psy-audit/psy-foundation/packages/device-sdk/src/device.ts (lines 1-13)
// Do not modify. Replace with `import { PsyDevice } from '@psy-foundation/device-sdk'`
// when integrated into the canonical workspace.

import type { DeviceCapabilities, MusicalContext, MusicalEvent } from './protocol'
import type { MusicalTransport } from './transport'

export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
