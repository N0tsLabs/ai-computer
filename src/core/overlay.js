// src/core/overlay.js
// Lifecycle + event bus for the screenpilot-overlay subprocess.
//
// The overlay is a Tauri-based translucent window that visualises what the
// AI is doing — virtual cursor, click ripples, event feed cards. It runs
// out-of-process; we communicate via stdin (events to show) and stdout
// (events from the overlay, e.g. user Esc abort).
//
// Public surface:
//   startOverlay({ label, onEvent }) → { pid, binary, ... }
//   stopOverlay()
//   overlayEvent(ev)                   → sends one event to the overlay
//   isOverlayActive()
//   withOverlay(fn, opts)              → start, run fn, always stop
//
// Event envelope (both directions):
//   { kind, text?, x?, y?, fromX?, fromY?, toX?, toY?, detail? }
//   kinds: cursor | click | right-click | double-click | drag | type |
//          hotkey | snap | scroll | label | error | custom
//
// Parent-side events (overlay → here, surfaced via onEvent):
//   { kind: 'ready' }                   overlay finished its initial paint
//   { kind: 'aborted', by: 'user' }     user long-pressed Esc
//   { kind: 'exiting', reason? }        process is going away

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve as resolvePath } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function locateOverlayBinary() {
  if (process.env.SCREENPILOT_OVERLAY) {
    const explicit = resolvePath(process.env.SCREENPILOT_OVERLAY)
    if (existsSync(explicit)) return explicit
  }
  const ext = process.platform === 'win32' ? '.exe' : ''
  const candidates = [
    join(__dirname, '..', '..', 'overlay', 'src-tauri', 'target', 'release', `screenpilot-overlay${ext}`),
    join(__dirname, '..', '..', 'overlay', 'src-tauri', 'target', 'debug',   `screenpilot-overlay${ext}`),
    join(__dirname, '..', '..', 'bin', `screenpilot-overlay${ext}`),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

let activeChild = null
let activeBus = null

/**
 * Show the overlay. Idempotent: a second call with a new label updates the
 * label and reuses the existing process.
 *
 * @param {object} opts
 * @param {string} [opts.label]              Status pill text.
 * @param {(ev:object)=>void} [opts.onEvent] Receives parent-side events,
 *                                           especially { kind: 'aborted' }.
 */
export async function startOverlay({ label = 'AI 接管中', onEvent } = {}) {
  if (activeChild && !activeChild.killed) {
    if (label) sendEvent({ kind: 'label', text: label })
    if (onEvent) activeBus.on('event', onEvent)
    return { pid: activeChild.pid, binary: activeChild._binary, reused: true }
  }
  const binary = locateOverlayBinary()
  if (!binary) {
    throw new Error(
      'screenpilot-overlay binary not found. Build it with:\n' +
      '  cd overlay/src-tauri && cargo build --release\n' +
      'or set SCREENPILOT_OVERLAY=/path/to/screenpilot-overlay',
    )
  }
  const bus = new EventEmitter()
  if (onEvent) bus.on('event', onEvent)

  const child = spawn(binary, [label], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
    env: {
      ...process.env,
      SCREENPILOT_PARENT_PID: String(process.pid),
    },
  })
  child._binary = binary

  // Stdout — one JSON event per line.
  let stdoutBuf = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', chunk => {
    stdoutBuf += chunk
    let idx
    while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, idx).trim()
      stdoutBuf = stdoutBuf.slice(idx + 1)
      if (!line) continue
      try {
        const ev = JSON.parse(line)
        bus.emit('event', ev)
      } catch {
        // Non-JSON stderr-style noise; ignore.
      }
    }
  })

  // Surface stderr only at debug-level — quiet by default.
  let earlyErr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', d => {
    earlyErr += d
    if (process.env.SCREENPILOT_DEBUG) process.stderr.write(`[overlay] ${d}`)
  })

  child.on('exit', () => {
    if (activeChild === child) {
      activeChild = null
      activeBus = null
    }
    bus.emit('event', { kind: 'exited' })
  })

  // Wait up to 600ms for either "ready" or process death.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 600)
    bus.once('event', ev => {
      if (ev.kind === 'ready') {
        clearTimeout(timer)
        resolve()
      }
    })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code !== 0 && code != null) {
        reject(new Error(
          `screenpilot-overlay exited ${code} during startup: ${earlyErr.trim() || '(no stderr)'}`,
        ))
      } else {
        resolve()
      }
    })
  })

  activeChild = child
  activeBus = bus
  // Immediately announce: gives the user a visible "AI just took over"
  // moment before any real action lands. Otherwise the overlay can stand
  // empty for many seconds while the agent is reading docs / thinking.
  try {
    sendEvent({ kind: 'custom', text: '接管成功', detail: label })
  } catch { /* harmless */ }
  return { pid: child.pid, binary, reused: false }
}

/** Hide the overlay. Always safe (no-op if not running). */
export async function stopOverlay({ timeoutMs = 1500 } = {}) {
  const child = activeChild
  if (!child || child.killed) return { stopped: false }
  try { sendEvent({ kind: 'exit' }) } catch {}
  try { child.stdin?.end() } catch {}
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      resolve()
    }, timeoutMs)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
  activeChild = null
  activeBus = null
  return { stopped: true }
}

/** Send one event to the overlay (e.g. to show a click ripple). No-op if
 *  the overlay isn't running. Errors are swallowed deliberately —
 *  visualisation must never break automation. */
export function overlayEvent(ev) {
  return sendEvent(ev)
}

function sendEvent(ev) {
  if (!activeChild || activeChild.killed) return false
  try {
    activeChild.stdin?.write(JSON.stringify(ev) + '\n')
    return true
  } catch {
    return false
  }
}

/** Subscribe to events from the overlay (ready/aborted/exiting). */
export function onOverlayEvent(handler) {
  if (!activeBus) return () => {}
  activeBus.on('event', handler)
  return () => activeBus?.off('event', handler)
}

/** Convenience: wrap an async block with the overlay visible. */
export async function withOverlay(fn, opts = {}) {
  await startOverlay(opts)
  try {
    return await fn()
  } finally {
    await stopOverlay()
  }
}

/** Has the overlay been started by this process? */
export function isOverlayActive() {
  return !!(activeChild && !activeChild.killed)
}
