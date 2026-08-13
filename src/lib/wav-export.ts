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
 * @param ctx The AudioContext whose graph to render
 * @param durationSec How many seconds to render
 * @param filename The download filename
 */
export async function renderAndDownloadWav(
  ctx: AudioContext,
  durationSec: number,
  filename: string
): Promise<void> {
  const sampleRate = ctx.sampleRate
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * durationSec), sampleRate)

  // We can't easily clone the entire audio graph to the offline context.
  // Instead, we use a MediaStreamDestination from the live context.
  // For a true offline render, the caller would need to rebuild the graph
  // on the offline context.
  //
  // For now, this is a placeholder that records from the live context's
  // destination via a MediaRecorder. This is simpler and works for demo purposes.

  const dest = ctx.createMediaStreamDestination()
  // Note: the caller must connect their master output to `dest` before calling.
  // This is a limitation — a full implementation would clone the graph.

  const recorder = new MediaRecorder(dest.stream, {
    mimeType: 'audio/webm',
  })

  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  return new Promise((resolve, reject) => {
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: 'audio/webm' })
        // For WAV export, decode the webm and re-encode as WAV.
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
    setTimeout(() => recorder.stop(), durationSec * 1000)
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
