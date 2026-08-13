// Shared Web Worker timer source string.
//
// Used by both RealizationScheduler and DemoDirector to avoid duplication.
// The worker fires postMessage('tick') every `ms` milliseconds when started.

export const TIMER_WORKER_SRC = `let iv=null;self.onmessage=function(e){const d=e.data;if(d.cmd==='start'){if(iv)clearInterval(iv);iv=setInterval(()=>self.postMessage('tick'),d.ms)}else if(d.cmd==='stop'){if(iv)clearInterval(iv);iv=null}};`

export interface TimerHandle {
  stop: () => void
}

/**
 * Create a Blob-URL Web Worker timer that fires `onTick` every `ms` milliseconds.
 * Falls back to setInterval if Worker is unavailable.
 * Sets onerror handler for diagnostics.
 */
export function createTimerWorker(onTick: () => void, ms: number): TimerHandle {
  try {
    const blob = new Blob([TIMER_WORKER_SRC], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)
    worker.onmessage = () => onTick()
    worker.onerror = (e) => {
      console.error('[timer-worker] Worker error:', e.message ?? e)
    }
    worker.postMessage({ cmd: 'start', ms })
    return {
      stop: () => {
        try {
          worker.postMessage({ cmd: 'stop' })
          worker.terminate()
        } catch {
          // already terminated
        }
        URL.revokeObjectURL(url)
      },
    }
  } catch {
    // Worker unavailable — fall back to setInterval.
    const id = setInterval(onTick, ms)
    return { stop: () => clearInterval(id) }
  }
}
