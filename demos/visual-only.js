// demos/visual-only.js
// Pure visualization demo — does NOT touch real apps. Only sends overlay
// events so you can see the breathing glow, virtual cursor, ripples,
// drag trail, and card feed.
//
// Coordinates use the *virtual screen* (all monitors stitched together).
// On a multi-monitor setup the cursor flies across both screens, proving
// the overlay is painted on every display.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

async function main() {
  // Real desktop extent — covers every monitor.
  const vs = sp.raw.getVirtualScreen()
  console.log(`Virtual screen: ${vs.width}x${vs.height} at (${vs.x}, ${vs.y})`)
  const cx = vs.x + Math.round(vs.width  / 2)
  const cy = vs.y + Math.round(vs.height / 2)

  // Distribute visit points evenly across the whole virtual screen.
  const padX = Math.round(vs.width  * 0.1)
  const padY = Math.round(vs.height * 0.15)
  const points = [
    { x: vs.x + padX,            y: vs.y + padY,            label: '左上角附近' },
    { x: vs.x + vs.width - padX, y: vs.y + padY,            label: '右上角附近' },
    { x: vs.x + vs.width - padX, y: vs.y + vs.height - padY,label: '右下角附近' },
    { x: vs.x + padX,            y: vs.y + vs.height - padY,label: '左下角附近' },
    { x: cx,                     y: cy,                     label: '正中心' },
  ]

  console.log('Starting overlay (covering all monitors)…')
  console.log('Press Esc to fade out and quit.')
  console.log()

  await sp.startOverlay({
    label: 'screenpilot · 演示中',
    onEvent: (ev) => {
      if (ev.kind === 'aborted') console.log('▸ User pressed Esc — fading out')
      if (ev.kind === 'exiting') console.log('▸ Overlay closing')
    },
  })
  await sleep(700)

  // Send events directly (NOT calling sp.tap etc) so the real mouse isn't
  // touched — only the visualisation moves.
  async function fly(x, y, dwell = 700) {
    sp.overlayEvent({ kind: 'cursor', x, y })
    await sleep(dwell)
  }
  async function tapVis(x, y, label, flavour = 'click') {
    sp.overlayEvent({ kind: 'cursor', x, y })
    await sleep(220)
    sp.overlayEvent({ kind: flavour, x, y, text: label })
    await sleep(800)
  }

  console.log('▸ Tour all four corners + centre (proves multi-monitor coverage)')
  for (const p of points) {
    console.log(`  → ${p.label} (${p.x}, ${p.y})`)
    await fly(p.x, p.y, 900)
  }

  console.log('▸ Single click near top-left')
  await tapVis(points[0].x, points[0].y, '左上按钮')

  console.log('▸ Double-click upper-right')
  await tapVis(points[1].x, points[1].y, '选中区域', 'double-click')

  console.log('▸ Right-click bottom-right')
  await tapVis(points[2].x, points[2].y, '上下文菜单', 'right-click')

  console.log('▸ Type into a notional field at centre')
  sp.overlayEvent({ kind: 'cursor', x: cx, y: cy })
  await sleep(200)
  sp.overlayEvent({ kind: 'type', text: '你好,世界 ✨ — 这是从 AI 注入的字符' })
  await sleep(1200)

  console.log('▸ Hotkey ctrl+shift+p')
  sp.overlayEvent({ kind: 'hotkey', text: 'ctrl+shift+p' })
  await sleep(900)

  console.log('▸ Long horizontal drag across most of the virtual screen')
  sp.overlayEvent({
    kind: 'drag',
    fromX: vs.x + padX, fromY: cy,
    toX:   vs.x + vs.width - padX, toY: cy,
    text: '跨屏拖拽',
  })
  await sleep(1800)

  console.log('▸ Scroll feedback')
  sp.overlayEvent({ kind: 'scroll', x: cx, y: cy + 100, text: 'down × 5' })
  await sleep(800)

  console.log('▸ Snap event card')
  sp.overlayEvent({ kind: 'snap', text: 'desktop → screenpilot-shot.png' })
  await sleep(800)

  console.log('▸ Custom event card')
  sp.overlayEvent({ kind: 'custom', text: '决策', detail: '登录框已就绪, 准备填入凭据' })
  await sleep(1400)

  console.log('▸ Idle circle around centre for 10 s')
  const r = Math.min(vs.width, vs.height) * 0.25
  for (let i = 0; i < 8; i++) {
    const t = i / 8 * Math.PI * 2
    await fly(cx + Math.cos(t) * r, cy + Math.sin(t) * r, 1100)
  }

  console.log('▸ Stopping overlay (press Esc earlier if you wanted to)')
  await sleep(800)
  await sp.stopOverlay()
  console.log('\n✓ Done.')
}

main().catch(async err => {
  console.error('FAIL:', err.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
