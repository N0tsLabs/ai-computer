// src/core/viewport.js
// Viewport — our answer to usecomputer's "coord-map".
//
// A Viewport encodes: "here's the region of desktop I screenshotted, here's
// the size the model actually sees after downscaling, and here's the DPI of
// the source display." Models hand back coordinates in *screenshot space*;
// the viewport maps them back to desktop space.
//
// Key differences from usecomputer's coord-map:
//   1) Self-describing string format with a tag prefix (`vp1:...`) so we can
//      version-bump the format later without silently breaking callers.
//   2) Optional `scale` field carries native DPI for accurate cursor placement
//      on per-monitor-DPI systems.
//   3) Round-trip aware — exposes both `toScreen()` and `toView()` so element
//      tree boxes captured in desktop coords can be drawn back into the
//      downscaled screenshot for visual debugging.

const TAG = 'vp1'

export class Viewport {
  constructor({ x, y, width, height, viewWidth, viewHeight, scale = 1 }) {
    if (width <= 0 || height <= 0 || viewWidth <= 0 || viewHeight <= 0) {
      throw new Error('Viewport: positive width/height required')
    }
    this.x = x
    this.y = y
    this.width = width
    this.height = height
    this.viewWidth = viewWidth
    this.viewHeight = viewHeight
    this.scale = scale
  }

  // Compact serialization, easy for LLMs to echo back unmodified.
  toString() {
    return [
      TAG,
      this.x, this.y,
      this.width, this.height,
      this.viewWidth, this.viewHeight,
      this.scale,
    ].join(':')
  }

  static parse(input) {
    if (input instanceof Viewport) return input
    if (!input || typeof input !== 'string') {
      throw new Error('Viewport.parse: string expected')
    }
    const parts = input.split(':')
    if (parts[0] !== TAG) {
      // Tolerate legacy 6-number form: "x,y,w,h,vw,vh"
      const csv = input.split(',').map(Number)
      if (csv.length >= 6 && csv.every(Number.isFinite)) {
        return new Viewport({
          x: csv[0], y: csv[1],
          width: csv[2], height: csv[3],
          viewWidth: csv[4], viewHeight: csv[5],
          scale: csv[6] ?? 1,
        })
      }
      throw new Error(`Viewport.parse: unknown format "${input.slice(0, 32)}"`)
    }
    const [, x, y, w, h, vw, vh, scale] = parts.map(Number)
    return new Viewport({
      x, y, width: w, height: h,
      viewWidth: vw, viewHeight: vh,
      scale: scale ?? 1,
    })
  }

  // Screenshot pixel → real desktop pixel
  toScreen({ x, y }) {
    const sx = this.viewWidth <= 1 ? 0 : (x / (this.viewWidth - 1))
    const sy = this.viewHeight <= 1 ? 0 : (y / (this.viewHeight - 1))
    return {
      x: Math.round(this.x + sx * (this.width - 1)),
      y: Math.round(this.y + sy * (this.height - 1)),
    }
  }

  // Real desktop pixel → screenshot pixel
  toView({ x, y }) {
    const fx = this.width <= 1 ? 0 : ((x - this.x) / (this.width - 1))
    const fy = this.height <= 1 ? 0 : ((y - this.y) / (this.height - 1))
    return {
      x: Math.round(Math.max(0, Math.min(this.viewWidth - 1, fx * (this.viewWidth - 1)))),
      y: Math.round(Math.max(0, Math.min(this.viewHeight - 1, fy * (this.viewHeight - 1)))),
    }
  }

  // Convert a desktop-space rect (e.g. UI element bounding box) into view space
  rectToView(r) {
    const tl = this.toView({ x: r.x, y: r.y })
    const br = this.toView({ x: r.x + r.width, y: r.y + r.height })
    return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y }
  }
}

// Compute the target view size given a source rect, capped by `maxEdge`.
// Default cap = 1568, matching what most vision models prefer.
export function planViewSize({ width, height }, maxEdge = 1568) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { viewWidth: width, viewHeight: height, scale: 1 }
  const factor = maxEdge / longest
  return {
    viewWidth: Math.max(1, Math.round(width * factor)),
    viewHeight: Math.max(1, Math.round(height * factor)),
    scale: factor,
  }
}
