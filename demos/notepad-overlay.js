// demos/notepad-overlay.js
// Same as demos/notepad.js but wraps the whole automation in `withOverlay()`.
// Gracefully degrades when the overlay binary hasn't been built yet — you'll
// see a console warning but the automation still runs.

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

async function waitForWindow(predicate, { timeoutMs = 8000, intervalMs = 200 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const wins = sp.windows()
    const match = wins.find(predicate)
    if (match) return match
    await sleep(intervalMs)
  }
  throw new Error('waitForWindow timed out')
}

async function maybeStartOverlay(label) {
  try {
    const r = await sp.startOverlay({ label })
    console.log(`▸ Overlay active: pid=${r.pid}`)
    return true
  } catch (e) {
    console.warn(`▸ Overlay unavailable (${e.message.split('\n')[0]}).`)
    console.warn('  Continuing without the visual overlay — automation still works.')
    return false
  }
}

async function main() {
  const haveOverlay = await maybeStartOverlay('Claude 正在为你操作记事本')

  console.log('▸ Launching Notepad...')
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref()

  console.log('▸ Waiting for Notepad...')
  const win = await waitForWindow(
    w => w.className === 'Notepad' || /记事本|Notepad/i.test(w.title),
  )
  console.log(`  found: handle=${win.handle}`)

  sp.focus(win.handle)
  await sleep(500)

  console.log('▸ Typing some lines (slowly so you can watch the glow)...')
  await sp.write('Hello from screenpilot ✨\n', { delayMs: 30 })
  await sleep(400)
  await sp.write('AI 正在驾驶你的桌面\n', { delayMs: 30 })
  await sleep(400)
  await sp.write('整个外圈应该有金属辉光在呼吸 🌊\n', { delayMs: 30 })
  await sleep(800)

  console.log('▸ Snapping result...')
  const snap = await sp.snap({ path: './demos/notepad-with-overlay.png', handle: win.handle })
  console.log(`  saved ${snap.path}`)

  if (haveOverlay) {
    console.log('▸ Holding overlay for 2s so you can admire it...')
    await sleep(2000)
    console.log('▸ Stopping overlay...')
    await sp.stopOverlay()
  }
  console.log('\n✓ Demo complete.')
}

main().catch(err => {
  console.error('demo failed:', err.message)
  sp.stopOverlay().catch(() => {})
  process.exit(1)
})
