// WAV export utility — renders audio offline and exports as a downloadable WAV.
//
// Uses OfflineAudioContext to render `durationSec` seconds of audio, then
// encodes the result as a 16-bit PCM WAV file.
//
// This is the "music correctness proof" — you can record 4 bars and verify
// the output is correct.

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length * numChannels * 2 + 44
  const arrayBuffer = new ArrayBuffer(length)
  const view = new DataView(arrayBuffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, length - 8, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // audio format (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * 2, true) // byte rate
  view.setUint16(32, numChannels * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, length - 44, true)

  // Interleave channels
  let offset = 44
  const channels: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch))
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch]![i]!))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

/**
 * Render audio offline and trigger a WAV download.
 *
 * Uses MediaRecorder to capture `durationSec` of audio from the live AudioContext,
 * then decodes the resulting WebM blob and re-encodes as 16-bit PCM WAV.
 *
 * @param ctx The AudioContext whose graph to record
 * @param durationSec How many seconds to record
 * @param filename The download filename
 * @param sourceNode Optional source node to connect to the recording destination.
 *                   If provided, it will be connected at the start and disconnected at the end.
 *                   If omitted, the caller must have already connected something that
 *                   feeds `ctx.destination` (in which case the recording will be silent —
 *                   because the MediaStreamDestination is a separate sink).
 */
export async function renderAndDownloadWav(
  ctx: AudioContext,
  durationSec: number,
  filename: string,
  sourceNode?: AudioNode | null
): Promise<void> {
  const sampleRate = ctx.sampleRate
  const dest = ctx.createMediaStreamDestination()

  // Connect the source node (e.g. master gain) → dest if provided.
  if (sourceNode) {
    try {
      sourceNode.connect(dest)
    } catch (err) {
      // Already connected or other AudioNode error — log and continue.
      console.warn('[wav-export] Failed to connect sourceNode:', err)
    }
  }

  // Pick the best available mimeType.
  const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  let mimeType = ''
  for (const m of mimeCandidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) {
      mimeType = m
      break
    }
  }

  const recorder = mimeType
    ? new MediaRecorder(dest.stream, { mimeType })
    : new MediaRecorder(dest.stream)

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  try {
    return await new Promise<void>((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          const arrayBuffer = await blob.arrayBuffer()
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          const wavBlob = audioBufferToWavBlob(audioBuffer)
          triggerDownload(wavBlob, filename)
          resolve()
        } catch (err) {
          reject(err)
        }
      }

      recorder.start()
      setTimeout(() => {
        try { recorder.stop() } catch { /* already stopped */ }
      }, durationSec * 1000)
    })
  } finally {
    // Disconnect the source node from the recording destination.
    if (sourceNode) {
      try { sourceNode.disconnect(dest) } catch { /* not connected */ }
    }
    try { dest.disconnect() } catch { /* not connected */ }
  }
}

/**
 * Trigger a browser download of a Blob.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
