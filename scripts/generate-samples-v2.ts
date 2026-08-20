#!/usr/bin/env bun
/**
 * Procedural sample generator v2 — improved DSP.
 *
 * Replaces the original generate-samples.ts + generate-velocity-samples.ts
 * with a single unified generator that produces all 31 procedural samples
 * using professional synthesis techniques:
 *
 *   - Biquad filters (LP / HP / BP / notch, RBJ-style)
 *   - Multi-segment envelopes (attack / decay / release)
 *   - Soft saturation (tanh) for warmth
 *   - Pink noise (Voss-McCartney) for percussive transients
 *   - Supersaw (multiple detuned sawtooths) for leads
 *   - 909-style kicks (fundamental + harmonics + sub tail + click)
 *   - 909-style claps (4-burst noise + tail)
 *   - Metallic hats (inharmonic sines + ring mod + 6-pole BP)
 *
 * All output:
 *   - Mono, 44100 Hz, 16-bit PCM WAV
 *   - Procedurally synthesized (no external audio, no copyright)
 *
 * Usage: bun run scripts/generate-samples-v2.ts
 */

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const SR = 44100

// @ts-ignore — import.meta.dir is a Bun runtime API
const OUTPUT_DIR = join(import.meta.dir, '..', 'public', 'samples')

// ─── WAV writer (16-bit PCM, mono) ───────────────────────────────────────────

function writeWav(filename: string, samples: Float32Array): void {
  // Normalise to -0.95..0.95 peak to avoid inter-sample clipping on playback.
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  const norm = peak > 0 ? Math.min(1, 0.95 / peak) : 1
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * norm))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  writeFileSync(join(OUTPUT_DIR, filename), buf)
  console.log(`  ${filename}  ${n} samples  ${(n / SR).toFixed(3)}s  peak=${peak.toFixed(3)}`)
}

// ─── DSP primitives ──────────────────────────────────────────────────────────

/** Soft saturation (musical, preserves transients). */
function softClip(x: number, drive = 1.5): number {
  return Math.tanh(x * drive) / Math.tanh(drive)
}

/** Sine wave (cached phase for efficiency). */
function sine(freq: number, t: number): number {
  return Math.sin(2 * Math.PI * freq * t)
}

/** Sawtooth (band-limited via 8 partials, basic but cleaner than naive). */
function saw(freq: number, t: number, partials = 8): number {
  let s = 0
  for (let k = 1; k <= partials; k++) {
    s += Math.sin(2 * Math.PI * freq * k * t) / k
  }
  return s * (2 / Math.PI) // normalise to ~-1..1
}

/** Pink noise via Voss-McCartney algorithm (warmer than white noise). */
class PinkNoise {
  private b0 = 0
  private b1 = 0
  private b2 = 0
  private b3 = 0
  private b4 = 0
  private b5 = 0
  private b6 = 0
  next(): number {
    const white = Math.random() * 2 - 1
    this.b0 = 0.99886 * this.b0 + white * 0.0555179
    this.b1 = 0.99332 * this.b1 + white * 0.0750759
    this.b2 = 0.969 * this.b2 + white * 0.153852
    this.b3 = 0.8665 * this.b3 + white * 0.3104856
    this.b4 = 0.55 * this.b4 + white * 0.5329522
    this.b5 = -0.2318 * this.b5 + white * 0.016898
    this.b6 = 0.115926 * this.b6 - this.b5 * 0.0590585 + white * 0.153846
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + white * 0.5
    return pink * 0.1 // ~-1..1
  }
}

/**
 * Biquad filter (RBJ cookbook). One instance per filter, run sample-by-sample.
 * Type: 'lp' | 'hp' | 'bp' | 'notch' | 'ap'
 */
class Biquad {
  private a0 = 1
  private a1 = 0
  private a2 = 0
  private b1 = 0
  private b2 = 0
  private z1 = 0
  private z2 = 0

  constructor(
    public type: 'lp' | 'hp' | 'bp' | 'notch' | 'ap',
    public freq: number,
    public Q: number = 0.707,
  ) {
    this.recompute()
  }

  private recompute() {
    const w0 = (2 * Math.PI * this.freq) / SR
    const cosw = Math.cos(w0)
    const sinw = Math.sin(w0)
    const alpha = sinw / (2 * this.Q)
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
    switch (this.type) {
      case 'lp':
        b0 = (1 - cosw) / 2
        b1 = 1 - cosw
        b2 = (1 - cosw) / 2
        a0 = 1 + alpha
        a1 = -2 * cosw
        a2 = 1 - alpha
        break
      case 'hp':
        b0 = (1 + cosw) / 2
        b1 = -(1 + cosw)
        b2 = (1 + cosw) / 2
        a0 = 1 + alpha
        a1 = -2 * cosw
        a2 = 1 - alpha
        break
      case 'bp':
        b0 = alpha
        b1 = 0
        b2 = -alpha
        a0 = 1 + alpha
        a1 = -2 * cosw
        a2 = 1 - alpha
        break
      case 'notch':
        b0 = 1
        b1 = -2 * cosw
        b2 = 1
        a0 = 1 + alpha
        a1 = -2 * cosw
        a2 = 1 - alpha
        break
      case 'ap':
        b0 = 1 - alpha
        b1 = -2 * cosw
        b2 = 1 + alpha
        a0 = 1 + alpha
        a1 = -2 * cosw
        a2 = 1 - alpha
        break
    }
    this.a0 = a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
  }

  /** Process one sample in-place (Direct Form I). */
  process(x: number): number {
    const y = (1 / this.a0) * x + this.b1 * this.z1 + this.b2 * this.z2 - this.a1 * this.z1 - this.a2 * this.z2
    this.z2 = this.z1
    this.z1 = y
    return y
  }

  /** Update filter frequency (for sweeps). */
  setFreq(f: number) {
    this.freq = f
    this.recompute()
  }
}

/**
 * Multi-segment envelope:
 *   attack (0→1 over attackT)
 *   decay (1→sustain over decayT)
 *   release (sustain→0 over releaseT starting at releaseT-ago)
 * Total duration = attackT + decayT + releaseT.
 */
function adsr(t: number, attackT: number, decayT: number, sustain: number, releaseT: number): number {
  if (t < attackT) return t / Math.max(0.0001, attackT)
  if (t < attackT + decayT) {
    const p = (t - attackT) / Math.max(0.0001, decayT)
    return 1 + (sustain - 1) * p
  }
  // Release phase from sustain
  const relStart = attackT + decayT
  if (t < relStart + releaseT) {
    const p = (t - relStart) / Math.max(0.0001, releaseT)
    return sustain * (1 - p)
  }
  return 0
}

/** One-pole allpass — for metallic ringing (comb-like). */
class Allpass {
  private buffer: Float32Array
  private idx = 0
  constructor(private delay: number) {
    this.buffer = new Float32Array(Math.max(1, Math.floor(delay)))
  }
  process(x: number): number {
    const delayed = this.buffer[this.idx]
    this.buffer[this.idx] = x + delayed * 0.5
    this.idx = (this.idx + 1) % this.buffer.length
    return delayed
  }
}

// ─── KICK (909-style: click + body + sub tail + saturation) ───────────────────

interface KickParams {
  /** Fundamental start frequency (Hz). */
  startFreq: number
  /** Fundamental end frequency (Hz). */
  endFreq: number
  /** Pitch envelope time constant (s). */
  pitchDecay: number
  /** Body amplitude decay (s). */
  bodyDecay: number
  /** Sub tail duration (s). */
  tailDur: number
  /** Sub tail frequency (Hz). */
  tailFreq: number
  /** Click amplitude (0..1). */
  clickAmp: number
  /** Saturation drive. */
  drive: number
}

function genKick(p: KickParams, variantSeed = 0): Float32Array {
  const dur = p.tailDur + 0.05
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pinkClick = new PinkNoise()
  const clickBp = new Biquad('bp', 1800 + variantSeed * 200, 0.8)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // Pitch envelope: exponential drop from startFreq to endFreq.
    const freq = p.endFreq + (p.startFreq - p.endFreq) * Math.exp(-t / p.pitchDecay)
    // Fundamental + 2nd harmonic (909-style body).
    const body = sine(freq, t) + 0.25 * sine(freq * 2, t)
    const bodyEnv = Math.exp(-t / p.bodyDecay)
    // Sub tail (extends beyond body decay).
    const tailEnv = Math.max(0, 1 - t / p.tailDur) * 0.4
    const tail = sine(p.tailFreq, t) * tailEnv
    // Click transient (2 ms).
    const clickEnv = t < 0.002 ? Math.exp(-t / 0.0006) : 0
    const click = clickBp.process(pinkClick.next()) * clickEnv * p.clickAmp
    // Mix + saturate.
    const mixed = (body * bodyEnv + tail) * 0.8 + click
    out[i] = softClip(mixed, p.drive)
  }
  return out
}

function genKickDeep() {
  return genKick({
    startFreq: 130, endFreq: 45, pitchDecay: 0.025,
    bodyDecay: 0.20, tailDur: 0.40, tailFreq: 45,
    clickAmp: 0.35, drive: 1.6,
  })
}

function genKickPunchy() {
  return genKick({
    startFreq: 170, endFreq: 55, pitchDecay: 0.018,
    bodyDecay: 0.13, tailDur: 0.20, tailFreq: 55,
    clickAmp: 0.45, drive: 2.0,
  })
}

function genKickSoft() {
  return genKick({
    startFreq: 110, endFreq: 40, pitchDecay: 0.030,
    bodyDecay: 0.25, tailDur: 0.35, tailFreq: 40,
    clickAmp: 0.20, drive: 1.2,
  })
}

function genKickHard() {
  return genKick({
    startFreq: 200, endFreq: 60, pitchDecay: 0.015,
    bodyDecay: 0.10, tailDur: 0.25, tailFreq: 60,
    clickAmp: 0.55, drive: 2.5,
  })
}

// Original "kick" alias = deep variant
function genKickMain() {
  return genKick({
    startFreq: 150, endFreq: 50, pitchDecay: 0.022,
    bodyDecay: 0.18, tailDur: 0.30, tailFreq: 50,
    clickAmp: 0.40, drive: 1.8,
  })
}

// ─── SNARE (tone body + filtered noise + snare wires) ─────────────────────────

interface SnareParams {
  /** Tonal body frequencies (Hz). */
  bodyFreqs: number[]
  /** Body decay (s). */
  bodyDecay: number
  /** Noise decay (s). */
  noiseDecay: number
  /** Noise band center (Hz). */
  noiseCenter: number
  /** Noise Q. */
  noiseQ: number
  /** Snare wire amplitude. */
  wireAmp: number
}

function genSnare(p: SnareParams, variantSeed = 0): Float32Array {
  const dur = Math.max(p.bodyDecay, p.noiseDecay) + 0.05
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const noiseBp = new Biquad('bp', p.noiseCenter, p.noiseQ)
  const wireHp = new Biquad('hp', 4000, 0.5)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // Tonal body (sum of sines).
    let body = 0
    for (const f of p.bodyFreqs) body += sine(f, t)
    body /= p.bodyFreqs.length
    body *= Math.exp(-t / p.bodyDecay)
    // Noise burst (band-passed pink).
    const noiseEnv = Math.exp(-t / p.noiseDecay)
    const noise = noiseBp.process(pink.next()) * noiseEnv
    // Snare wires (high-frequency ringing).
    const wireEnv = Math.exp(-t / (p.noiseDecay * 0.3))
    const wire = wireHp.process(pink.next()) * wireEnv * p.wireAmp
    out[i] = softClip((body * 0.7 + noise * 1.0 + wire * 0.6) * 0.7 + variantSeed * 0.001, 1.3)
  }
  return out
}

function genSnareMain() {
  return genSnare({
    bodyFreqs: [180, 330], bodyDecay: 0.10,
    noiseDecay: 0.18, noiseCenter: 1800, noiseQ: 0.8,
    wireAmp: 0.5,
  })
}

// ─── CLAP (4-burst noise + tail, 909-style) ───────────────────────────────────

interface ClapParams {
  /** Number of bursts. */
  bursts: number
  /** Time between burst onsets (s). */
  burstSpacing: number
  /** Burst duration (s). */
  burstDur: number
  /** Tail decay (s). */
  tailDecay: number
  /** Noise band center (Hz). */
  center: number
  /** Noise Q. */
  Q: number
}

function genClap(p: ClapParams): Float32Array {
  const dur = (p.bursts - 1) * p.burstSpacing + p.burstDur + p.tailDecay
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const bp = new Biquad('bp', p.center, p.Q)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let total = 0
    // Sum burst envelopes.
    for (let b = 0; b < p.bursts; b++) {
      const burstT = t - b * p.burstSpacing
      if (burstT >= 0 && burstT < p.burstDur) {
        const env = Math.exp(-burstT / (p.burstDur * 0.3))
        total += env
      }
    }
    // Tail after last burst.
    const lastBurstEnd = (p.bursts - 1) * p.burstSpacing + p.burstDur
    if (t > lastBurstEnd) {
      const tailT = t - lastBurstEnd
      total += Math.exp(-tailT / p.tailDecay) * 0.4
    }
    out[i] = bp.process(pink.next()) * total * 0.6
  }
  return out
}

function genClapMain() {
  return genClap({
    bursts: 4, burstSpacing: 0.010, burstDur: 0.010,
    tailDecay: 0.20, center: 1000, Q: 1.2,
  })
}

function genClapSoft() {
  return genClap({
    bursts: 3, burstSpacing: 0.012, burstDur: 0.012,
    tailDecay: 0.15, center: 800, Q: 1.0,
  })
}

function genClapHard() {
  return genClap({
    bursts: 4, burstSpacing: 0.008, burstDur: 0.008,
    tailDecay: 0.18, center: 1200, Q: 1.5,
  })
}

function genClapVariant() {
  return genClap({
    bursts: 5, burstSpacing: 0.009, burstDur: 0.009,
    tailDecay: 0.22, center: 900, Q: 1.3,
  })
}

// ─── HATS (metallic via inharmonic sines + ring mod + 6-pole BP) ──────────────

interface HatParams {
  /** Decay time (s). */
  decay: number
  /** Band center (Hz). */
  center: number
  /** Band Q. */
  Q: number
  /** Shimmer amplitude (0..1). */
  shimmer: number
}

/**
 * Metallic source: 6 sines at inharmonic ratios (golden-ratio detune),
 * ring-modulated against each other for shimmer.
 */
function metallicSource(t: number): number {
  const base = 660 // Hz
  const ratios = [1, 1.618, 2.414, 3.732, 5.0, 7.0] // golden-ratio-ish
  let s = 0
  for (const r of ratios) s += sine(base * r, t)
  s /= ratios.length
  // Ring mod with self for extra harmonics.
  const ring = s * sine(base * 0.5, t) * 0.3
  return s + ring
}

function genHat(p: HatParams, variantSeed = 0): Float32Array {
  const dur = p.decay + 0.02
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const bp1 = new Biquad('bp', p.center, p.Q)
  const bp2 = new Biquad('bp', p.center * 1.3, p.Q)
  const bp3 = new Biquad('bp', p.center * 0.7, p.Q)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.exp(-t / p.decay)
    // Metallic source + pink noise mixed.
    const source = (metallicSource(t) * 0.5 + pink.next() * 0.5) * env
    // 3-stage BP for sharper 6-pole response.
    const filtered = bp3.process(bp2.process(bp1.process(source)))
    // Shimmer via HP on the output.
    const shimmer = p.shimmer * Math.sin(2 * Math.PI * 8000 * t + Math.sin(2 * Math.PI * 7 * t) * 0.5) * 0.15 * env
    out[i] = softClip((filtered + shimmer) * 0.8 + variantSeed * 0.001, 1.4)
  }
  return out
}

function genHatClosed() {
  return genHat({ decay: 0.06, center: 7000, Q: 0.8, shimmer: 0.3 })
}

function genHatOpen() {
  return genHat({ decay: 0.30, center: 6000, Q: 0.7, shimmer: 0.5 })
}

// Round-robin variants: slightly different center/Q/decay.
function genHatClosedRR(n: number) {
  const seed = n * 0.05
  return genHat({
    decay: 0.06 + seed * 0.005,
    center: 7000 + n * 200,
    Q: 0.8 + n * 0.05,
    shimmer: 0.3 + n * 0.05,
  }, n)
}

function genHatOpenRR(n: number) {
  const seed = n * 0.05
  return genHat({
    decay: 0.28 + seed * 0.02,
    center: 6000 + n * 150,
    Q: 0.7 + n * 0.04,
    shimmer: 0.5 + n * 0.05,
  }, n)
}

function genOpenHatGen() {
  return genHat({ decay: 0.32, center: 5500, Q: 0.65, shimmer: 0.6 })
}

// ─── BASS (detuned saws + sub + filter envelope) ─────────────────────────────

interface BassParams {
  /** Fundamental frequency (Hz). */
  freq: number
  /** Total duration (s). */
  dur: number
  /** Detune amount (semitones). */
  detune: number
  /** Filter cutoff start (Hz). */
  filterStart: number
  /** Filter cutoff end (Hz). */
  filterEnd: number
  /** Filter Q. */
  Q: number
}

function genBass(p: BassParams): Float32Array {
  const n = Math.floor(SR * p.dur)
  const out = new Float32Array(n)
  // 2 detuned saws (in cents).
  const semis = [p.detune, -p.detune]
  const lp = new Biquad('lp', p.filterStart, p.Q)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // ADSR amp envelope.
    const env = adsr(t, 0.005, 0.05, 0.6, p.dur - 0.06)
    // 2 detuned saws.
    let s = 0
    for (const semi of semis) {
      const f = p.freq * Math.pow(2, semi / 12)
      s += saw(f, t)
    }
    s /= semis.length
    // Sub sine one octave below.
    const sub = sine(p.freq / 2, t) * 0.4
    // Filter sweep.
    const filterT = t / p.dur
    const cutoff = p.filterStart + (p.filterEnd - p.filterStart) * filterT
    lp.setFreq(cutoff)
    const filtered = lp.process(s + sub)
    out[i] = softClip(filtered * env * 0.7, 1.3)
  }
  return out
}

function genBassA() {
  // A1 = 55 Hz
  return genBass({
    freq: 55, dur: 0.50, detune: 0.07,
    filterStart: 200, filterEnd: 800, Q: 2,
  })
}

function genBassDeep() {
  return genBass({
    freq: 41, dur: 0.60, detune: 0.05,
    filterStart: 150, filterEnd: 500, Q: 2.5,
  })
}

// ─── LEAD (supersaw: 5 detuned saws + filter envelope) ───────────────────────

interface LeadParams {
  /** Fundamental frequency (Hz). */
  freq: number
  /** Duration (s). */
  dur: number
  /** Detune in cents. */
  detune: number
  /** Filter cutoff start. */
  filterStart: number
  /** Filter cutoff end. */
  filterEnd: number
  /** Filter Q. */
  Q: number
}

function genLead(p: LeadParams): Float32Array {
  const n = Math.floor(SR * p.dur)
  const out = new Float32Array(n)
  // 5-voice supersaw (Roland JP-8000 style).
  const cents = [0, p.detune, -p.detune, p.detune * 2, -p.detune * 2]
  const lp = new Biquad('lp', p.filterStart, p.Q)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = adsr(t, 0.010, 0.10, 0.5, p.dur - 0.11)
    let s = 0
    for (const c of cents) {
      const f = p.freq * Math.pow(2, c / 1200)
      s += saw(f, t)
    }
    s /= cents.length
    // Filter sweep: start open, close.
    const filterT = t / p.dur
    const cutoff = p.filterStart + (p.filterEnd - p.filterStart) * filterT
    lp.setFreq(cutoff)
    const filtered = lp.process(s)
    out[i] = softClip(filtered * env * 0.6, 1.4)
  }
  return out
}

function genLeadMain() {
  // A3 = 220 Hz
  return genLead({
    freq: 220, dur: 0.50, detune: 8,
    filterStart: 4000, filterEnd: 1500, Q: 1.5,
  })
}

// ─── PERC (short tonal hits + noise transient) ────────────────────────────────

interface PercParams {
  /** Tonal frequency (Hz). */
  freq: number
  /** Duration (s). */
  dur: number
  /** Decay (s). */
  decay: number
  /** Transient amp. */
  transientAmp: number
  /** Noise center. */
  noiseCenter: number
}

function genPerc(p: PercParams, variantSeed = 0): Float32Array {
  const n = Math.floor(SR * p.dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const bp = new Biquad('bp', p.noiseCenter, 1.5)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.exp(-t / p.decay)
    const tone = sine(p.freq, t) * env
    const transientEnv = t < 0.01 ? Math.exp(-t / 0.003) : 0
    const transient = bp.process(pink.next()) * transientEnv * p.transientAmp
    out[i] = softClip((tone * 0.7 + transient * 0.8) * 0.7, 1.3)
  }
  return out
}

function genPerc1() {
  return genPerc({ freq: 200, dur: 0.15, decay: 0.05, transientAmp: 0.5, noiseCenter: 1500 })
}

function genPerc2() {
  return genPerc({ freq: 440, dur: 0.18, decay: 0.04, transientAmp: 0.4, noiseCenter: 2000 })
}

function genPercRR(n: number) {
  const freqs = [330, 392, 523, 587, 659]
  return genPerc(
    {
      freq: freqs[n % freqs.length],
      dur: 0.16,
      decay: 0.045,
      transientAmp: 0.45,
      noiseCenter: 1800 + n * 100,
    },
    n,
  )
}

// ─── TEXTURE (filtered noise + drones + LFO) ──────────────────────────────────

function genTexturePad(): Float32Array {
  const dur = 2.0
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const lp = new Biquad('lp', 800, 0.7)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // Slow LFO on amplitude (3-second cycle).
    const lfo = 0.5 + 0.5 * sine(1 / 3, t)
    // Attack-decay envelope (swell).
    const env = Math.min(1, t / 0.4) * Math.exp(-t / 1.6)
    // Filter sweep (opening).
    lp.setFreq(400 + 600 * (t / dur))
    // 3 drones at low octaves.
    const drone = (sine(55, t) + sine(82.5, t) * 0.6 + sine(110, t) * 0.3) / 1.9
    const filtered = lp.process(pink.next() * 0.5 + drone)
    out[i] = softClip(filtered * env * lfo * 0.5, 1.1)
  }
  return out
}

// ─── FX (filter sweep + noise) ───────────────────────────────────────────────

function genFxSweep(): Float32Array {
  const dur = 1.0
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.15) * Math.exp(-t / 0.7)
    // Rising filter cutoff from 200 Hz → 8000 Hz.
    const cutoff = 200 + (t / dur) * 7800
    const lp = new Biquad('lp', cutoff, 1.0)
    // We can't reuse the biquad per-sample efficiently with recompute, so
    // simulate with a one-pole here for cheapness.
    const raw = pink.next() + sine(220, t) * 0.2 + sine(330, t) * 0.1
    out[i] = lp.process(raw) * env * 0.5
  }
  return out
}

// ─── TOM (pitched drum) ──────────────────────────────────────────────────────

function genTom(): Float32Array {
  const dur = 0.30
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const clickBp = new Biquad('bp', 1500, 0.8)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // Pitch drop from 280 to 150 Hz.
    const freq = 150 + 130 * Math.exp(-t / 0.04)
    const body = sine(freq, t) + 0.2 * sine(freq * 2, t)
    const env = Math.exp(-t / 0.13)
    const clickEnv = t < 0.005 ? Math.exp(-t / 0.001) : 0
    const click = clickBp.process(pink.next()) * clickEnv * 0.3
    out[i] = softClip((body * env + click) * 0.8, 1.3)
  }
  return out
}

// ─── RIDE (metallic sustained) ────────────────────────────────────────────────

function genRide(): Float32Array {
  const dur = 0.50
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const bp1 = new Biquad('bp', 6000, 1.0)
  const bp2 = new Biquad('bp', 9000, 1.2)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const env = Math.exp(-t / 0.30)
    const metallic = metallicSource(t) * 0.6
    const filtered = bp2.process(bp1.process(metallic))
    out[i] = softClip(filtered * env * 0.4, 1.2)
  }
  return out
}

// ─── SHAKER (filtered noise, soft) ───────────────────────────────────────────

function genShaker(): Float32Array {
  const dur = 0.08
  const n = Math.floor(SR * dur)
  const out = new Float32Array(n)
  const pink = new PinkNoise()
  const bp = new Biquad('bp', 6500, 0.6)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    // Asymmetric env: quick rise, slow fall.
    const attack = t < 0.005 ? t / 0.005 : 1
    const decay = Math.exp(-(t - 0.005) / 0.025)
    const env = attack * decay
    out[i] = bp.process(pink.next()) * env * 0.5
  }
  return out
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

console.log('Generating improved procedural samples (v2)...')

const samples: Array<{ name: string; gen: () => Float32Array }> = [
  // Kicks (5 variants)
  { name: 'kick.wav', gen: genKickMain },
  { name: 'kick_deep.wav', gen: genKickDeep },
  { name: 'kick_punchy.wav', gen: genKickPunchy },
  { name: 'kick_soft.wav', gen: genKickSoft },
  { name: 'kick_hard.wav', gen: genKickHard },

  // Snare
  { name: 'snare.wav', gen: genSnareMain },

  // Claps (4 variants)
  { name: 'clap.wav', gen: genClapMain },
  { name: 'clap_soft.wav', gen: genClapSoft },
  { name: 'clap_hard.wav', gen: genClapHard },
  { name: 'clap_variant.wav', gen: genClapVariant },

  // Hats
  { name: 'hat_closed.wav', gen: genHatClosed },
  { name: 'hat_open.wav', gen: genHatOpen },
  { name: 'hat_closed_rr1.wav', gen: () => genHatClosedRR(1) },
  { name: 'hat_closed_rr2.wav', gen: () => genHatClosedRR(2) },
  { name: 'hat_closed_rr3.wav', gen: () => genHatClosedRR(3) },
  { name: 'hat_open_rr1.wav', gen: () => genHatOpenRR(1) },
  { name: 'hat_open_rr2.wav', gen: () => genHatOpenRR(2) },
  { name: 'open_hat_gen.wav', gen: genOpenHatGen },

  // Bass + Lead
  { name: 'bass_A.wav', gen: genBassA },
  { name: 'bass_deep.wav', gen: genBassDeep },
  { name: 'lead.wav', gen: genLeadMain },

  // Perc
  { name: 'perc_1.wav', gen: genPerc1 },
  { name: 'perc_2.wav', gen: genPerc2 },
  { name: 'perc_rr1.wav', gen: () => genPercRR(0) },
  { name: 'perc_rr2.wav', gen: () => genPercRR(1) },
  { name: 'perc_rr3.wav', gen: () => genPercRR(2) },

  // Tonal drums
  { name: 'tom.wav', gen: genTom },
  { name: 'ride.wav', gen: genRide },
  { name: 'shaker.wav', gen: genShaker },

  // FX + texture
  { name: 'fx_sweep.wav', gen: genFxSweep },
  { name: 'texture_pad.wav', gen: genTexturePad },
]

let totalSamples = 0
for (const s of samples) {
  const data = s.gen()
  writeWav(s.name, data)
  totalSamples += data.length
}

console.log(`Done. ${samples.length} samples, ${totalSamples} total samples (${(totalSamples / SR).toFixed(1)}s total audio)`)
