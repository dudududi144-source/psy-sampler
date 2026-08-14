// Automation — parameter automation over time.
//
// An AutomationTrack is a series of {time, value} breakpoints. The director
// samples the track at the current playback time. Values are interpolated
// linearly between breakpoints.

export interface AutomationPoint {
  time: number
  value: number
}

export interface AutomationTrack {
  target: string
  points: AutomationPoint[]
  defaultValue: number
}

export type AutomationTarget =
  | 'masterFilter.freq'
  | 'masterFilter.Q'
  | 'master.gain'
  | 'bus.drum.gain'
  | 'bus.music.gain'
  | 'bus.atmos.gain'
  | 'bus.drum.saturation'
  | 'bus.music.saturation'
  | 'bus.atmos.saturation'

export function createTrack(target: AutomationTarget, defaultValue: number): AutomationTrack {
  return { target, points: [], defaultValue }
}

export function addPoint(track: AutomationTrack, time: number, value: number): AutomationTrack {
  const filtered = track.points.filter((p) => Math.abs(p.time - time) > 0.001)
  const newPoints = [...filtered, { time, value }].sort((a, b) => a.time - b.time)
  return { ...track, points: newPoints }
}

export function removePointAt(track: AutomationTrack, time: number): AutomationTrack {
  return { ...track, points: track.points.filter((p) => Math.abs(p.time - time) > 0.1) }
}

export function sampleTrack(track: AutomationTrack, time: number): number {
  if (track.points.length === 0) return track.defaultValue
  if (time <= track.points[0]!.time) return track.points[0]!.value
  if (time >= track.points[track.points.length - 1]!.time) return track.points[track.points.length - 1]!.value
  let lo = 0
  let hi = track.points.length - 1
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (track.points[mid]!.time <= time) lo = mid
    else hi = mid
  }
  const p0 = track.points[lo]!
  const p1 = track.points[hi]!
  const t = (time - p0.time) / (p1.time - p0.time)
  return p0.value + (p1.value - p0.value) * t
}

export class AutomationBank {
  private tracks = new Map<string, AutomationTrack>()

  get(target: AutomationTarget): AutomationTrack {
    let track = this.tracks.get(target)
    if (!track) {
      track = createTrack(target, this.defaultFor(target))
      this.tracks.set(target, track)
    }
    return track
  }

  set(target: AutomationTarget, track: AutomationTrack): void {
    this.tracks.set(target, { ...track, target })
  }

  addPoint(target: AutomationTarget, time: number, value: number): void {
    const track = this.get(target)
    this.tracks.set(target, addPoint(track, time, value))
  }

  removePoint(target: AutomationTarget, time: number): void {
    const track = this.get(target)
    this.tracks.set(target, removePointAt(track, time))
  }

  sampleAll(time: number): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [target, track] of this.tracks) {
      result[target] = sampleTrack(track, time)
    }
    return result
  }

  get activeTracks(): AutomationTrack[] {
    return Array.from(this.tracks.values()).filter((t) => t.points.length > 0)
  }

  clear(): void { this.tracks.clear() }

  serialize(): Record<string, { points: AutomationPoint[]; defaultValue: number }> {
    const result: Record<string, { points: AutomationPoint[]; defaultValue: number }> = {}
    for (const [target, track] of this.tracks) {
      if (track.points.length > 0) result[target] = { points: track.points, defaultValue: track.defaultValue }
    }
    return result
  }

  deserialize(data: Record<string, { points: AutomationPoint[]; defaultValue: number }>): void {
    this.clear()
    for (const [target, trackData] of Object.entries(data)) {
      this.tracks.set(target, {
        target,
        points: trackData.points.sort((a, b) => a.time - b.time),
        defaultValue: trackData.defaultValue,
      })
    }
  }

  private defaultFor(target: AutomationTarget): number {
    switch (target) {
      case 'masterFilter.freq': return 20000
      case 'masterFilter.Q': return 1
      case 'master.gain': return 0.85
      case 'bus.drum.gain': return 0.9
      case 'bus.music.gain': return 0.85
      case 'bus.atmos.gain': return 0.7
      case 'bus.drum.saturation': return 0
      case 'bus.music.saturation': return 0
      case 'bus.atmos.saturation': return 0
      default: return 0
    }
  }
}
