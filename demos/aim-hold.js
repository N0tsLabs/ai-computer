// demos/aim-hold.js
// Aim check with user-controlled snapshot. Launches Notepad, aims both
// real and virtual cursors at the Close button area, then HOLDS for 60
// seconds so the user can screenshot at leisure. Press Esc on the overlay
// (or Ctrl+C in the terminal) to release.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

async function waitForWindow(predicate, { timeoutMs = 8000, intervalMs = 200 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const m = sp.windows().find(predicate)
    if (m) return m
    await sleep(intervalMs)
  }
  throw new Error('waitForWindow timed out')
}

async function main() {
  console.log('Launching Notepad...')
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref()
  const win = await waitForWindow(w => w.className === 'Notepad' || /Notepad|记事本/i.test(w.title))
  console.log(`Notepad bounds: (${win.x},${win.y}) ${win.width}x${win.height}`)
  sp.focus(win.handle)
  await sleep(500)

  // Win11 Notepad hides its chrome from UIA — use geometry.
  const targetX = win.x + win.width - 22
  const targetY = win.y + 22
  console.log(`Target: (${targetX}, ${targetY})  [Notepad Close button — geometric]`)

  console.log('Starting overlay…')
  let aborted = false
  await sp.startOverlay({
    label: 'AIM CHECK · 真实鼠标 vs 虚拟鼠标',
    onEvent: (ev) => {
      if (ev.kind === 'aborted') {
        console.log('▸ User pressed Esc, releasing.')
        aborted = true
      }
    },
  })
  await sleep(800)

  console.log('Moving REAL mouse to target (no click)…')
  await sp.move({ x: targetX, y: targetY })
  sp.overlayEvent({ kind: 'cursor', x: targetX, y: targetY })
  sp.overlayEvent({
    kind: 'custom',
    text: '瞄准',
    detail: `关闭按钮 (${targetX}, ${targetY}) — 比较真实鼠标和虚拟鼠标位置是否重合`,
  })

  console.log('')
  console.log('=========================================================')
  console.log('  HOLDING — 截好图后按 Esc 或 Ctrl+C 让我退出')
  console.log('  最长保持 120 秒')
  console.log('=========================================================')

  const start = Date.now()
  while (!aborted && Date.now() - start < 120000) {
    // Periodically re-assert position in case anything bumped the cursor.
    sp.overlayEvent({ kind: 'cursor', x: targetX, y: targetY })
    await sleep(2000)
  }

  console.log('Releasing overlay…')
  await sp.stopOverlay()
  // Close Notepad without saving.
  await sp.hotkey('alt+f4')
  await sleep(300)
  await sp.hotkey('alt+n').catch(() => {})
  await sp.hotkey('alt+w').catch(() => {})
  console.log('\n✓ Done.')
}

process.on('SIGINT', async () => {
  console.log('\n▸ SIGINT received, releasing overlay…')
  await sp.stopOverlay().catch(() => {})
  process.exit(0)
})

main().catch(async err => {
  console.error('FAIL:', err.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
