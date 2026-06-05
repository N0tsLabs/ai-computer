// demos/showcase.js
// Full showcase of screenpilot v0.2 with overlay visualization.
//
// Walks through every visual primitive (cursor move, click, double-click,
// right-click, drag, type, hotkey) so you can verify each animation works.
// Listens for Esc abort and ends gracefully when the user takes back control.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

let aborted = false

async function safeStep(label, fn) {
  if (aborted) throw new Error('aborted-by-user')
  console.log(`▸ ${label}`)
  return fn()
}

async function main() {
  console.log('▸ Starting overlay...')
  await sp.startOverlay({
    label: 'screenpilot · 演示中',
    onEvent: (ev) => {
      if (ev.kind === 'aborted') {
        console.log('\n⚠ User aborted via Esc long-press!')
        aborted = true
      }
    },
  })

  try {
    // Tiny pause so the overlay has time to paint.
    await sleep(500)

    // Open notepad to have a real target on screen.
    spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref()
    const win = await waitForWindow(w => w.className === 'Notepad' || /Notepad|记事本/i.test(w.title))
    sp.focus(win.handle)
    await sleep(500)

    // Mid-screen reference point inside the notepad window.
    const cx = win.x + Math.floor(win.width / 2)
    const cy = win.y + Math.floor(win.height / 2)

    await safeStep('Move virtual cursor', async () => {
      await sp.move({ x: cx, y: cy })
      await sleep(800)
    })

    await safeStep('Single click', async () => {
      await sp.tap({ x: cx, y: cy, text: '编辑区中心' })
      await sleep(800)
    })

    await safeStep('Type Chinese + English + emoji', async () => {
      await sp.write('Hello from screenpilot ✨\n', { delayMs: 25 })
      await sleep(400)
      await sp.write('overlay 现在能看到我在做什么了 🌊\n', { delayMs: 25 })
      await sleep(800)
    })

    await safeStep('Ctrl+A (select all)', async () => {
      await sp.hotkey('ctrl+a')
      await sleep(600)
    })

    await safeStep('Right-click for context menu', async () => {
      await sp.tap({ x: cx, y: cy, button: 'right', text: '上下文菜单' })
      await sleep(900)
      await sp.hotkey('escape') // dismiss
      await sleep(400)
    })

    await safeStep('Double-click', async () => {
      await sp.tap({ x: cx, y: cy, count: 2, text: '选中单词' })
      await sleep(600)
    })

    await safeStep('Simulated drag (visual only — cursor sweeps left-right)', async () => {
      // We do a real drag on the empty area of the title bar so nothing
      // important moves. The overlay shows the trail regardless.
      const leftX  = win.x + 50
      const rightX = win.x + Math.min(400, win.width - 50)
      const titleY = win.y + 12
      await sp.dragPath({
        fromX: leftX, fromY: titleY,
        toX: rightX,  toY: titleY,
        text: '标题栏拖拽',
      })
      await sleep(800)
    })

    await safeStep('Final hotkey: Ctrl+End', async () => {
      await sp.hotkey('ctrl+end')
      await sleep(500)
    })

    await safeStep('Closing notepad without saving', async () => {
      await sp.hotkey('alt+f4')
      await sleep(500)
      await sp.hotkey('alt+n') // "Don't Save"
      await sleep(400)
    })

    console.log('\n▸ Holding overlay 3 more seconds...')
    await sleep(3000)
  } finally {
    console.log('▸ Stopping overlay.')
    await sp.stopOverlay()
  }

  console.log(aborted ? '\n✗ Aborted by user.' : '\n✓ Showcase complete.')
}

async function waitForWindow(predicate, { timeoutMs = 8000, intervalMs = 200 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const m = sp.windows().find(predicate)
    if (m) return m
    await sleep(intervalMs)
  }
  throw new Error('waitForWindow timed out')
}

main().catch(err => {
  console.error('showcase failed:', err.message)
  sp.stopOverlay().catch(() => {})
  process.exit(1)
})
