// Live recording — capture the master output to a WAV file in real-time.
//
// Captures WHATEVER the producer plays — MIDI input, live parameter tweaks,
// improvisation, automation. Uses MediaRecorder on a MediaStreamDestination
// tapped from the master gain.

import { audioBufferToWavBlob, triggerDownload } from './wav-export'

export interface LiveRecorderOptions {
  ctx: AudioContext
  sourceNode: AudioNode
}

export class LiveRecorder {
  private readonly ctx: AudioContext
  private readonly sourceNode: AudioNode
  private dest: MediaStreamAudioDestinationNode | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private recording = false
  private startTime = 0

  constructor(opts: LiveRecorderOptions) {
    this.ctx = opts.ctx
    this.sourceNode = opts.sourceNode
  }

  get isRecording(): boolean { return this.recording }
  get elapsedMs(): number { return this.recording ? (this.ctx.currentTime - this.startTime) * 1000 : 0 }

  start(): void {
    if (this.recording) return
    if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not supported in this browser')
    this.dest = this.ctx.createMediaStreamDestination()
    this.sourceNode.connect(this.dest)
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    let mimeType = ''
    for (const mt of mimeTypes) { if (MediaRecorder.isTypeSupported(mt)) { mimeType = mt; break } }
    if (!mimeType) {
      try { this.sourceNode.disconnect(this.dest) } catch { /* */ }
      this.dest = null
      throw new Error('No supported MediaRecorder mimeType found')
    }
    this.recorder = new MediaRecorder(this.dest.stream, { mimeType })
    this.chunks = []
    this.recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) this.chunks.push(e.data) }
    this.recorder.start(100)
    this.recording = true
    this.startTime = this.ctx.currentTime
  }

  async stop(filename: string): Promise<Blob> {
    if (!this.recording || !this.recorder) throw new Error('Not recording')
    return new Promise<Blob>((resolve, reject) => {
      const recorder = this.recorder!
      const dest = this.dest
      const chunks = this.chunks
      recorder.onstop = async () => {
        try {
          if (dest) { try { this.sourceNode.disconnect(dest) } catch { /* */ } }
          const mimeType = recorder.mimeType || 'audio/webm'
          const blob = new Blob(chunks, { type: mimeType })
          const arrayBuffer = await blob.arrayBuffer()
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer)
          const wavBlob = audioBufferToWavBlob(audioBuffer)
          triggerDownload(wavBlob, `${filename}.wav`)
          this.recording = false
          this.recorder = null
          this.dest = null
          this.chunks = []
          resolve(wavBlob)
        } catch (err) {
          this.recording = false
          this.recorder = null
          this.dest = null
          this.chunks = []
          reject(err)
        }
      }
      try { recorder.stop() } catch { reject(new Error('Recorder already stopped')) }
    })
  }

  cancel(): void {
    if (!this.recording || !this.recorder) return
    try { this.recorder.stop() } catch { /* */ }
    if (this.dest) { try { this.sourceNode.disconnect(this.dest) } catch { /* */ } }
    this.recording = false
    this.recorder = null
    this.dest = null
    this.chunks = []
  }
}
