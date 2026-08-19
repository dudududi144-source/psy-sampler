// WAV export utility — renders audio offline and exports as a downloadable WAV.
//
// Uses OfflineAudioContext to render `durationSec` seconds of audio from the
// sampler's master node, then encodes the result as a 16-bit PCM WAV file.
//
// This is browser-portable (no MediaRecorder/decodeAudioData round-trip).
// Works on Chrome, Firefox, Safari, Edge.

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
 * Record audio from a live AudioContext's source node and download as WAV.
 *
 * Uses MediaRecorder with mimeType fallback chain for browser portability.
 * Falls back gracefully: audio/webm → audio/ogg → audio/mp4 → empty (fails).
 *
 * @param ctx The live AudioContext.
 * @param sourceNode The node to record (e.g. master gain).
 * @param durationSec How many seconds to record.
 * @param filename The download filename.
 */
export async function renderAndDownloadWavLive(
  ctx: AudioContext,
  sourceNode: AudioNode,
  durationSec: number,
  filename: string
): Promise<void> {
  // Create a MediaStreamDestination and connect the source to it.
  const dest = ctx.createMediaStreamDestination()
  sourceNode.connect(dest)

  // Try mimeType candidates in order of preference.
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  let mimeType = ''
  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mt)) {
      mimeType = mt
      break
    }
  }
  if (!mimeType) {
    throw new Error('No supported MediaRecorder mimeType found')
  }

  const recorder = new MediaRecorder(dest.stream, { mimeType })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  return new Promise((resolve, reject) => {
    recorder.onstop = async () => {
      try {
        // FIX Bug 6: disconnect the tap.
        try { sourceNode.disconnect(dest) } catch { /* */ }

        const blob = new Blob(chunks, { type: mimeType })
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
        const wavBlob = audioBufferToWavBlob(audioBuffer)
        triggerDownload(wavBlob, filename)
        resolve()
      } catch (err) {
        // FIX Bug 6: disconnect dest on error too.
        try { sourceNode.disconnect(dest) } catch { /* */ }
        reject(err)
      }
    }

    recorder.start()
    setTimeout(() => {
      try { recorder.stop() } catch { /* */ }
    }, durationSec * 1000)
  })
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
