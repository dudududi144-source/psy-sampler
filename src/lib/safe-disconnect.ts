// safe-disconnect — Web Audio API cleanup helper.
//
// Web Audio's `node.disconnect()` can throw if:
//   - The node was never connected to anything
//   - The node is already disconnected
//   - The AudioContext is in a 'closed' state
//   - The node was created by a different (now-closed) context
//
// In cleanup / dispose paths, we want to disconnect gracefully without
// crashing the app. This helper encapsulates that pattern with proper
// documentation. Previously these were inline `try { x.disconnect() }
// catch { /* */ }` calls scattered across 6 files (18 occurrences)
// with no documentation of WHY they're silent.
//
// This is NOT a general-purpose error swallower. It's specifically for
// Web Audio cleanup where the API contract allows throwing on already-
// disconnected nodes. All other error handling MUST log to console.

/**
 * Disconnect a Web Audio node, ignoring "already disconnected" errors.
 * Use ONLY in cleanup/dispose paths where the node may already be in a
 * bad state and we want to degrade gracefully.
 *
 * @param node The AudioNode to disconnect (may be null/undefined —
 *             the call is a no-op in that case).
 */
export function safeDisconnect(node: AudioNode | null | undefined): void {
  if (!node) return
  try {
    node.disconnect()
  } catch (err) {
    // Expected: InvalidStateError if node was never connected, or if the
    // owning AudioContext is closed. Log at debug level (not warn) since
    // this is routine cleanup, not an actual error.
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[psy-sampler] safeDisconnect: node already disconnected or context closed:', err)
    }
  }
}

/**
 * Stop a MediaRecorder / AudioScheduledSourceNode, ignoring "already
 * stopped" errors. Use ONLY in cleanup paths.
 *
 * @param node The recorder or source node to stop (may be null/undefined).
 */
export function safeStop(node: { stop: () => void } | null | undefined): void {
  if (!node) return
  try {
    node.stop()
  } catch (err) {
    // Expected: InvalidStateError if already stopped. Debug-level log.
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[psy-sampler] safeStop: node already stopped:', err)
    }
  }
}
