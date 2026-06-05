// demos/aim-check.js
// Aim check: prove the virtual cursor lands on the same pixel as the real
// cursor. Steps:
//   1. Launch Notepad and locate it.
//   2. Use the UI Automation tree to find the window's Close button.
//   3. Send both real-mouse `move` and overlay `cursor` events to that
//      coordinate (no click).
//   4. Take a screenshot via screenpilot.
//   5. Save it so we can eyeball the alignment.

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
  console.log(`Notepad found: handle=${win.handle} bounds=(${win.x},${win.y} ${win.width}x${win.height})`)
  sp.focus(win.handle)
  await sleep(500)

  // The new Notepad on Win11 hides controls behind WinUI; fall back to
  // the geometric "Close" position — the X button sits roughly 22 px from
  // the right edge of the title bar, 22 px down from the top.
  console.log('Searching for "关闭" / Close button in element tree...')
  let close = (await sp.findOnScreen('关闭', { handle: win.handle, role: '按钮' }))[0]
    ?? (await sp.findOnScreen('Close', { handle: win.handle, role: 'Button' }))[0]
    ?? (await sp.findOnScreen('关闭', { handle: win.handle }))[0]
    ?? (await sp.findOnScreen('Close', { handle: win.handle }))[0]

  let targetX, targetY, targetLabel
  if (close) {
    targetX = close.center.x
    targetY = close.center.y
    targetLabel = `Close button (UIA-found) "${close.name}"`
  } else {
    targetX = win.x + win.width - 22
    targetY = win.y + 22
    targetLabel = 'Close button (geometric, WinUI fallback)'
  }
  console.log(`Target: (${targetX}, ${targetY})  — ${targetLabel}`)

  console.log('Starting overlay...')
  await sp.startOverlay({ label: 'AIM CHECK · 鼠标对齐验证' })
  await sleep(700)

  console.log('Moving REAL mouse to Close button (no click)...')
  await sp.move({ x: targetX, y: targetY })
  sp.overlayEvent({ kind: 'cursor', x: targetX, y: targetY })
  sp.overlayEvent({ kind: 'custom', text: '瞄准', detail: `${targetLabel} (${targetX}, ${targetY})` })

  console.log('Holding 1.5 s for animation to settle...')
  await sleep(1500)

  console.log('Snapping the screen (including overlay)...')
  const shot = await sp.snap({ path: './demos/aim-check.png', fullVirtual: true })
  console.log(`Saved: ${shot.path}  viewport=${shot.viewport}`)

  await sleep(800)
  await sp.stopOverlay()

  // Tear down notepad without saving.
  await sp.hotkey('alt+f4')
  await sleep(300)
  await sp.hotkey('alt+n').catch(() => {}) // English: Don't save
  await sp.hotkey('alt+w').catch(() => {}) // Chinese: 不保存
  console.log('\n✓ Done. Inspect demos/aim-check.png.')
}

main().catch(async err => {
  console.error('FAIL:', err.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
