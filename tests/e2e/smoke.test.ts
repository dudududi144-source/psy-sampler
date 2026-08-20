// E2E smoke tests — verify the app's golden path works end-to-end.
//
// Strategy: these tests start the dev server (or assume it's running),
// drive the UI via the agent-browser CLI (already installed), and assert
// on visible DOM state. This avoids the heavy Playwright dependency
// while still catching real user-facing regressions.
//
// Golden path coverage:
//   1. Page loads (HTTP 200)
//   2. Init overlay appears
//   3. Click "CLICK TO START" → audio engine initialized
//   4. Library shows 31 samples
//   5. Pattern editor visible
//   6. PLAY button toggles to STOP
//   7. STOP returns to PLAY
//
// Future E2E (Phase 1): slice flow, reconstruct flow, export flow.

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { execSync } from 'node:child_process'

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

/** Run an agent-browser command, return stdout (trimmed). */
function ab(args: string): string {
  try {
    return execSync(`agent-browser ${args}`, { encoding: 'utf8', timeout: 30000 }).trim()
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err)
    throw new Error(`agent-browser ${args} failed: ${stderr}`)
  }
}

/** Snapshot the page's interactive elements (compact). */
function snapshotInteractive(): string {
  return ab('snapshot -i -c')
}

/** Wait for a given ms. */
function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Check the dev server is running. */
async function ensureServerUp(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

describe('E2E smoke', async () => {
  const serverUp = await ensureServerUp()
  const maybeTest = serverUp ? test : test.skip

  beforeAll(async () => {
    if (serverUp) {
      ab('open ' + BASE_URL)
      await wait(2500)
    }
  })

  afterAll(() => {
    if (serverUp) {
      try { ab('close') } catch { /* ignore */ }
    }
  })

  maybeTest('page loads with init overlay', async () => {
    const snap = snapshotInteractive()
    expect(snap).toContain('PSY SAMPLER')
    expect(snap).toContain('CLICK TO START')
  })

  maybeTest('click start → library + pattern visible', async () => {
    const snap = snapshotInteractive()
    const match = snap.match(/button "CLICK TO START" \[ref=(e\d+)\]/)
    expect(match).not.toBeNull()
    const ref = match![1]
    ab(`click @${ref}`)
    await wait(3000)  // audio init takes ~2s

    const snap2 = snapshotInteractive()
    expect(snap2).toContain('PLAY')
    expect(snap2).toContain('LIBRARY ·')
    expect(snap2).toContain('PATTERN ·')
  })

  maybeTest('library shows 31 samples', async () => {
    const snap = snapshotInteractive()
    const match = snap.match(/LIBRARY · (\d+) SAMPLES/)
    expect(match).not.toBeNull()
    const count = parseInt(match![1], 10)
    expect(count).toBe(31)
  })

  maybeTest('PLAY toggles to STOP', async () => {
    const snap = snapshotInteractive()
    const match = snap.match(/^- button "PLAY" \[ref=(e\d+)\]/m)
    expect(match).not.toBeNull()
    const ref = match![1]
    ab(`click @${ref}`)
    await wait(1500)
    const snap2 = snapshotInteractive()
    expect(snap2).toContain('STOP')
    // Click again to stop.
    const match2 = snap2.match(/^- button "STOP" \[ref=(e\d+)\]/m)
    expect(match2).not.toBeNull()
    ab(`click @${match2![1]}`)
    await wait(500)
    const snap3 = snapshotInteractive()
    expect(snap3).toContain('PLAY')
  })

  maybeTest('mute per role works (first M button)', async () => {
    const snap = snapshotInteractive()
    const match = snap.match(/^- button "M" \[ref=(e\d+)\]/m)
    expect(match).not.toBeNull()
    const ref = match![1]
    ab(`click @${ref}`)
    await wait(500)
    // Verify the M button changed color to red (PSY red = rgb(248,81,73))
    // by checking the button's computed style.
    const result = ab(`eval "(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'M');
      if (btns.length === 0) return 'no M buttons';
      const color = getComputedStyle(btns[0]).color;
      return color;
    })()"`)
    // PSY red is rgb(248, 81, 73). When active, the M button turns red.
    expect(result).toContain('248')
    expect(result).toContain('81')
  })
})
