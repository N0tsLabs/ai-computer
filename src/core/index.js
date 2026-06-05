// src/core/index.js
// Unified high-level API. Combines screen capture, semantic targeting,
// and input synthesis into a single import surface.
//
// Three layers of targeting, in priority order:
//   1) Explicit coordinates {x, y}                 — fastest, dumbest
//   2) Element-tree lookup by text / role          — accurate when available
//   3) Coordinates handed back by a vision model   — fallback for opaque UIs
//
// Callers can mix freely: ask `findOnScreen("Save")` to try (2), then if
// nothing matches, take a screenshot and let the model pick coordinates.

import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'

import * as w32 from '../native/win32.js'
import * as tree from './ui-tree.js'
import { Viewport, planViewSize } from './viewport.js'
import { overlayEvent, isOverlayActive } from './overlay.js'

// Visualisation hook — push an event to the overlay if it's running.
// Wrapped so individual callers stay readable.
function vfx(ev) {
  if (!isOverlayActive()) return
  try { overlayEvent(ev) } catch { /* never break automation */ }
}

// Animate the virtual cursor to a desktop point before an action, so users
// see "AI is aiming" instead of an instant teleport. No-op when the overlay
// isn't active. We sleep just long enough for the WebView's CSS transition
// (260 ms) to finish before the real click lands.
async function vfxAimAt(point) {
  if (!isOverlayActive()) return
  try {
    overlayEvent({ kind: 'cursor', x: point.x, y: point.y })
    await new Promise(r => setTimeout(r, 280))
  } catch { /* never break automation */ }
}

// ─── Screen capture ──────────────────────────────────────────────

const DEFAULT_MAX_EDGE = 1568

async function ensureParentDir(p) {
  const dir = dirname(resolvePath(p))
  if (dir) await mkdir(dir, { recursive: true }).catch(() => {})
}

/**
 * Capture a screenshot. Two modes only — fullscreen (every monitor) or a
 * single window. We deliberately do NOT expose arbitrary region cropping
 * to AI callers: the "guess a small rect then re-guess" loop wastes
 * round-trips and is almost always worse than letting the model read the
 * full image and use precise (x,y) coordinates straight from it.
 *
 * Internal callers that legitimately need rectangle crops (e.g. the
 * `wechat-sidebar-ruled` debugging helper) can still call the lower-level
 * `_snapRegion()` below.
 *
 * @param {object} opts
 * @param {string} [opts.path]    Output PNG path. Defaults to ./screenpilot-shot.png
 * @param {number} [opts.handle]  Window handle to scope capture to. Without it, captures the full virtual screen.
 * @param {number} [opts.maxEdge] Long-edge cap for the output (default 1568). Set to 0 to disable downscaling.
 */
export async function snap({
  path = './screenpilot-shot.png',
  handle,
  maxEdge = DEFAULT_MAX_EDGE,
} = {}) {
  let rect
  if (handle) {
    const all = w32.listWindows({ visibleOnly: false })
    const win = all.find(w => w.handle === handle)
    if (!win) throw new Error(`snap: window handle ${handle} not found`)
    rect = { x: win.x, y: win.y, width: win.width, height: win.height }
  } else {
    // Default: full virtual screen across all monitors.
    rect = w32.getVirtualScreen()
  }
  return _snapRegion({ path, region: rect, maxEdge })
}

/**
 * Lower-level snapshot of an arbitrary desktop rectangle. Useful for tools,
 * tests, and overlay-aware debugging — not the recommended path for AI
 * agents, which should stick to `snap()` (full or windowed).
 */
export async function _snapRegion({
  path = './screenpilot-shot.png',
  region,
  maxEdge = DEFAULT_MAX_EDGE,
} = {}) {
  if (!region) throw new Error('_snapRegion: region required')
  const raw = w32.captureRect(region)
  const effectiveMax = maxEdge && maxEdge > 0 ? maxEdge : Math.max(raw.width, raw.height)
  const { viewWidth, viewHeight, scale } = planViewSize(
    { width: raw.width, height: raw.height }, effectiveMax,
  )
  await ensureParentDir(path)
  await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 4 },
  })
    .resize({ width: viewWidth, height: viewHeight, fit: 'fill' })
    .png({ compressionLevel: 6 })
    .toFile(path)

  const viewport = new Viewport({
    x: region.x, y: region.y,
    width: region.width, height: region.height,
    viewWidth, viewHeight, scale,
  })
  return {
    path,
    viewport: viewport.toString(),
    captureWidth: region.width,
    captureHeight: region.height,
    viewWidth, viewHeight,
    captureX: region.x, captureY: region.y,
  }
}

// ─── Input — explicit coords ─────────────────────────────────────

function resolvePoint({ x, y, viewport } = {}) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('Provide numeric x and y')
  }
  if (!viewport) return { x, y }
  return Viewport.parse(viewport).toScreen({ x, y })
}

export async function tap(opts = {}) {
  const pt = resolvePoint(opts)
  const flavour = (opts.count || 1) >= 2 ? 'double-click'
                : opts.button === 'right' ? 'right-click'
                : 'click'
  // Aim before clicking so the user sees where we're about to land.
  await vfxAimAt(pt)
  vfx({ kind: flavour, x: pt.x, y: pt.y, text: opts.text || '' })
  await w32.click({
    x: pt.x, y: pt.y,
    button: opts.button || 'left',
    count: opts.count || 1,
    modifiers: opts.modifiers || [],
  })
  return pt
}

export async function dragPath(opts = {}) {
  const from = resolvePoint({ x: opts.fromX, y: opts.fromY, viewport: opts.viewport })
  const to   = resolvePoint({ x: opts.toX,   y: opts.toY,   viewport: opts.viewport })
  let control
  if (typeof opts.controlX === 'number' && typeof opts.controlY === 'number') {
    control = resolvePoint({ x: opts.controlX, y: opts.controlY, viewport: opts.viewport })
  }
  // Show the cursor at the start before the drag visualisation kicks in.
  await vfxAimAt(from)
  vfx({ kind: 'drag', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, text: opts.text || '' })
  await w32.drag({ from, to, control, button: opts.button || 'left' })
  return { from, to, control }
}

export async function move(opts = {}) {
  const pt = resolvePoint(opts)
  vfx({ kind: 'cursor', x: pt.x, y: pt.y })
  w32.moveCursor(pt.x, pt.y)
  return pt
}

export async function wheel(opts = {}) {
  let at
  if (typeof opts.x === 'number' && typeof opts.y === 'number') {
    at = resolvePoint(opts)
  }
  const detail = `${opts.direction || 'down'} × ${opts.amount || 3}${at ? ` @(${at.x|0},${at.y|0})` : ''}`
  vfx({ kind: 'scroll', x: at?.x, y: at?.y, text: detail })
  await w32.scroll({
    direction: opts.direction || 'down',
    amount: opts.amount || 3,
    x: at?.x, y: at?.y,
  })
}

export async function write(text, { delayMs = 0 } = {}) {
  vfx({ kind: 'type', text })
  await w32.typeText(text, { delayMs })
}

export async function hotkey(combo, opts = {}) {
  vfx({ kind: 'hotkey', text: combo })
  await w32.pressKey(combo, opts)
}

// ─── Semantic targeting ──────────────────────────────────────────

/**
 * Find UI elements by visible text — across the foreground window by default,
 * or a specific window handle. Returns elements sorted by specificity
 * (smallest matching control first).
 *
 * @returns {Promise<Array<{role,name,rect,patterns,center:{x,y}}>>}
 */
export async function findOnScreen(text, {
  handle,
  role = null,
  maxDepth = 10,
  minSize = 4,
} = {}) {
  const ui = await tree.dumpTree({
    handle,
    foreground: !handle,
    maxDepth,
    minSize,
  })
  if (!ui) return []
  const matches = tree.findByText(ui, text, { role })
  return matches.map(el => ({
    ...el,
    center: tree.centerOf(el),
  }))
}

/**
 * High-level convenience: tap the first element matching `text`.
 * Throws if nothing matches. Returns the click point in desktop coords.
 */
export async function tapByText(text, opts = {}) {
  const matches = await findOnScreen(text, opts)
  if (matches.length === 0) throw new Error(`tapByText: no element matched "${text}"`)
  const target = matches[0]
  await w32.click({
    x: target.center.x, y: target.center.y,
    button: opts.button || 'left',
    count: opts.count || 1,
  })
  return { target, point: target.center }
}

// ─── Window queries ──────────────────────────────────────────────

export function windows(opts = {}) {
  return w32.listWindows(opts)
}

// Convenience: find one window by handle, looking in BOTH visible and
// hidden windows. WeChat / tray-minimised apps register as invisible to
// Win32 until they're brought to the foreground.
export function findWindow(handle) {
  const all = w32.listWindows({ visibleOnly: false })
  return all.find(w => w.handle === handle) || null
}

export function foreground() {
  return w32.getForegroundWindowInfo()
}

export function focus(handle) {
  return w32.focusWindow(handle)
}

// ─── Re-exports ──────────────────────────────────────────────────

export { Viewport } from './viewport.js'
export * as ui from './ui-tree.js'
export * as raw from '../native/win32.js'
export { startOverlay, stopOverlay, withOverlay, isOverlayActive,
         overlayEvent, onOverlayEvent } from './overlay.js'
