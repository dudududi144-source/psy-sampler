#!/usr/bin/env bun
/**
 * Velocity-layer + round-robin sample generator for PSY Sampler.
 *
 * Generates additional WAV samples with velocity layers (soft/hard variants)
 * and round-robin variants (multiple samples per role for humanization).
 *
 * This exercises the A2 (velocity layers) and A3 (round-robin) features in
 * SelectionPolicy — the library now has real multi-velocity sample sets instead
 * of single-velocity procedural samples.
 *
 * All generated samples are:
 *   - Mono, 44100 Hz, 16-bit PCM WAV
 *   - Procedurally synthesized (no external audio, no copyright)
 *   - Licensed: "Procedurally generated — no copyright restriction"
 *
 * Usage: bun run scripts/generate-velocity-samples.ts
 *
 * Output: writes WAVs to public/samples/ and appends entries to a JSON fragment
 * at public/samples/velocity-layers.json that gets merged into the manifest.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// @ts-ignore — import.meta.dir is a Bun runtime API
const OUTPUT_DIR = join(import.meta.dir, '..', 'public', 'samples')
const FRAGMENT_PATH = join(OUTPUT_DIR, 'velocity-layers.json')
const SAMPLE_RATE = 44100

// ─── Deterministic RNG (mulberry32) ──────────────────────────────────────────
// CRITICAL: samples must be byte-identical across runs so the manifest stays
// stable. Math.random() would produce different WAVs every run → different
// features → broken determinism. We use a FIXED seed.

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── WAV writer (16-bit PCM, mono) ───────────────────────────────────────────

function writeWav(filename: string, samples: Float32Array): void {
  const numSamples = samples.length
  const buffer = Buffer.alloc(44 + numSamples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)
  for (let i = 0; i < numSamples; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  writeFileSync(join(OUTPUT_DIR, filename), buffer)
}

// ─── DSP primitives ──────────────────────────────────────────────────────────

function expEnv(t: number, decay: number): number {
  return Math.exp(-t / decay)
}
function sine(freq: number, t: number): number {
  return Math.sin(2 * Math.PI * freq * t)
}

// Deterministic noise — takes the RNG so output is reproducible.
function noise(rng: () => number): number {
  return rng() * 2 - 1
}

// ─── Velocity-layer kick generators ──────────────────────────────────────────
//
// "Soft" kick: lower amplitude, shorter decay, warmer (less click).
// "Hard" kick: full amplitude, punchier, more click transient.
// Same fundamental pitch profile so they blend as a velocity layer pair.

function genKickSoft(rng: () => number): Float32Array {
  const dur = 0.35
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const freq = 80 * Math.exp(-t * 6) + 45
    const env = expEnv(t, 0.3) * 0.6 // softer amplitude, longer decay
    const click = i < 60 ? noise(rng) * expEnv(t, 0.003) * 0.15 : 0 // less click
    out[i] = (sine(freq, t) * env + click) * 0.6
  }
  return out
}

function genKickHard(rng: () => number): Float32Array {
  const dur = 0.3
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const freq = 120 * Math.exp(-t * 10) + 50
    const env = expEnv(t, 0.1) * 1.0 // full amplitude, punchy
    const click = i < 120 ? noise(rng) * expEnv(t, 0.002) * 0.5 : 0 // more click
    out[i] = (sine(freq, t) * env + click) * 0.95
  }
  return out
}

// ─── Velocity-layer clap generators ──────────────────────────────────────────

function genClapSoft(rng: () => number): Float32Array {
  const dur = 0.12
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const env = expEnv(t, 0.06) * 0.5
    // 2 softer bursts
    const b1 = t < 0.008 ? noise(rng) * expEnv(t, 0.004) : 0
    const b2 = t >= 0.008 ? noise(rng) * expEnv(t - 0.008, 0.05) : 0
    out[i] = (b1 + b2) * env * 0.4
  }
  return out
}

function genClapHard(rng: () => number): Float32Array {
  const dur = 0.15
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const env = expEnv(t, 0.08) * 0.9
    // 3 sharp bursts
    const b1 = t < 0.01 ? noise(rng) * expEnv(t, 0.005) : 0
    const b2 = t >= 0.01 && t < 0.02 ? noise(rng) * expEnv(t - 0.01, 0.005) : 0
    const b3 = t >= 0.02 ? noise(rng) * expEnv(t - 0.02, 0.07) : 0
    out[i] = (b1 + b2 + b3) * env * 0.7
  }
  return out
}

// ─── Round-robin hat-closed generators (3 variants) ──────────────────────────
//
// Each variant has a slightly different tonal character (different noise filter
// coefficients) so repeated 16th hats don't machine-gun. Same velocity range
// so they're true round-robin (not velocity layers).

function genHatClosedRR(rng: () => number, variant: number): Float32Array {
  const dur = 0.06
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  // Each variant uses a different HP filter coefficient for tonal variation.
  const hpCoeff = 0.02 + variant * 0.008
  let prev = 0
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const env = expEnv(t, 0.02)
    const raw = noise(rng)
    prev = prev + (raw - prev) * hpCoeff
    const hp = raw - prev
    out[i] = hp * env * 0.35
  }
  return out
}

// ─── Round-robin perc generators (3 variants) ────────────────────────────────

function genPercRR(rng: () => number, variant: number): Float32Array {
  const dur = 0.15
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  // Each variant hits a different pitch.
  const baseFreq = 180 + variant * 60
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const tone = sine(baseFreq + t * 80, t) * expEnv(t, 0.05)
    const transient = i < 150 ? noise(rng) * expEnv(t, 0.01) * 0.4 : 0
    out[i] = (tone + transient) * 0.6
  }
  return out
}

// ─── Round-robin hat-open generators (2 variants) ────────────────────────────

function genHatOpenRR(rng: () => number, variant: number): Float32Array {
  const dur = 0.25 + variant * 0.05
  const n = Math.floor(SAMPLE_RATE * dur)
  const out = new Float32Array(n)
  const hpCoeff = 0.025 + variant * 0.005
  let prev = 0
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const env = expEnv(t, 0.12 + variant * 0.02)
    const raw = noise(rng)
    prev = prev + (raw - prev) * hpCoeff
    const hp = raw - prev
    out[i] = hp * env * 0.4
  }
  return out
}

// ─── Manifest entry builder ──────────────────────────────────────────────────

interface VelocityLayerEntry {
  id: string
  file: string
  category: string
  subcategory: string
  source: string
  author: string
  license: string
  licenseUrl: string | null
  commercialUse: boolean
  attribution: string | null
  dateAcquired: string
  usageRestrictions: string
  character: string[]
  genreFit: string[]
  bpmRange: [number, number]
  rootNote: number
  verification: string
  velocityRange?: [number, number]
}

function makeEntry(
  id: string,
  file: string,
  category: string,
  velocityRange?: [number, number]
): VelocityLayerEntry {
  return {
    id,
    file: `samples/${file}`,
    category,
    subcategory: 'velocity-layer',
    source: 'psy-sampler build script (procedural — scripts/generate-velocity-samples.ts)',
    author: 'PSY Sampler',
    license: 'Procedurally generated — no copyright restriction',
    licenseUrl: null,
    commercialUse: true,
    attribution: null,
    dateAcquired: '2026-08-14',
    usageRestrictions: 'None — procedural sample, freely usable',
    character: ['velocity-layer'],
    genreFit: ['psytrance', 'techno', 'trance'],
    bpmRange: [120, 160],
    rootNote: category === 'bass' || category === 'lead' ? 33 : 60,
    verification: 'PROCEDURAL',
    velocityRange,
  }
}

// ─── Main generation ─────────────────────────────────────────────────────────

console.log('Generating velocity-layer + round-robin samples...')

// FIXED seeds — never change. Same seeds → same WAVs → same features →
// stable manifest. This is the determinism contract.
const SEED_KICK_SOFT = 1001
const SEED_KICK_HARD = 1002
const SEED_CLAP_SOFT = 1003
const SEED_CLAP_HARD = 1004
const SEED_HAT_RR = [1010, 1011, 1012]
const SEED_PERC_RR = [1020, 1021, 1022]
const SEED_HAT_OPEN_RR = [1030, 1031]

const entries: VelocityLayerEntry[] = []
const generated: Array<{ name: string; data: Float32Array }> = []

// Velocity layers: kick (soft 0-0.5, hard 0.5-1.0)
const kickSoft = genKickSoft(mulberry32(SEED_KICK_SOFT))
generated.push({ name: 'kick_soft.wav', data: kickSoft })
entries.push(makeEntry('kick-soft', 'kick_soft.wav', 'kick', [0, 0.5]))

const kickHard = genKickHard(mulberry32(SEED_KICK_HARD))
generated.push({ name: 'kick_hard.wav', data: kickHard })
entries.push(makeEntry('kick-hard', 'kick_hard.wav', 'kick', [0.5, 1.0]))

// Velocity layers: clap (soft 0-0.5, hard 0.5-1.0)
const clapSoft = genClapSoft(mulberry32(SEED_CLAP_SOFT))
generated.push({ name: 'clap_soft.wav', data: clapSoft })
entries.push(makeEntry('clap-soft', 'clap_soft.wav', 'clap', [0, 0.5]))

const clapHard = genClapHard(mulberry32(SEED_CLAP_HARD))
generated.push({ name: 'clap_hard.wav', data: clapHard })
entries.push(makeEntry('clap-hard', 'clap_hard.wav', 'clap', [0.5, 1.0]))

// Round-robin: hat-closed (3 variants, no velocity range — all eligible)
for (let v = 0; v < 3; v++) {
  const data = genHatClosedRR(mulberry32(SEED_HAT_RR[v]), v)
  const name = `hat_closed_rr${v + 1}.wav`
  generated.push({ name, data })
  entries.push(makeEntry(`hat-closed-rr-${v + 1}`, name, 'hat-closed'))
}

// Round-robin: perc (3 variants)
for (let v = 0; v < 3; v++) {
  const data = genPercRR(mulberry32(SEED_PERC_RR[v]), v)
  const name = `perc_rr${v + 1}.wav`
  generated.push({ name, data })
  entries.push(makeEntry(`perc-rr-${v + 1}`, name, 'perc'))
}

// Round-robin: hat-open (2 variants)
for (let v = 0; v < 2; v++) {
  const data = genHatOpenRR(mulberry32(SEED_HAT_OPEN_RR[v]), v)
  const name = `hat_open_rr${v + 1}.wav`
  generated.push({ name, data })
  entries.push(makeEntry(`hat-open-rr-${v + 1}`, name, 'hat-open'))
}

// Write all WAVs
for (const s of generated) {
  writeWav(s.name, s.data)
  console.log(`  generated ${s.name} (${s.data.length} samples, ${(s.data.length / SAMPLE_RATE).toFixed(3)}s)`)
}

// Write manifest fragment (to be merged into manifest.json)
const fragment = {
  version: '1.1.0-velocity-layers',
  description: 'Velocity-layer + round-robin samples generated by generate-velocity-samples.ts',
  generated: '2026-08-14',
  entries,
}
writeFileSync(FRAGMENT_PATH, JSON.stringify(fragment, null, 2))
console.log(`\nWrote ${entries.length} entries to ${FRAGMENT_PATH}`)
console.log('Merge these into public/samples/manifest.json (samples array).')
console.log(`Done. ${generated.length} WAVs generated in ${OUTPUT_DIR}`)
