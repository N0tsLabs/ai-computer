// demos/notepad.js
// End-to-end MVP demo: launch Notepad → type text → take a screenshot.
//
// This is the smallest possible "vision LLM agent" loop, except instead of
// asking a model where to click, we drive it deterministically. The point is
// to prove the building blocks (screen capture, semantic targeting, text
// injection, hotkeys) all work together.
//
// Run with: node demos/notepad.js

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

async function main() {
  console.log('▸ Launching Notepad...')
  // detached so notepad outlives this Node process if needed
  spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref()

  console.log('▸ Waiting for Notepad window...')
  const win = await waitForWindow(
    w => w.className === 'Notepad' || /记事本|Notepad/i.test(w.title),
  )
  console.log(`  found: handle=${win.handle} title="${win.title}"`)

  // Bring it to the front and let the UI settle.
  sp.focus(win.handle)
  await sleep(500)

  console.log('▸ Snapping Notepad window...')
  const snap = await sp.snap({ path: './demos/notepad-before.png', handle: win.handle })
  console.log(`  saved ${snap.path}  viewport=${snap.viewport}`)

  console.log('▸ Typing text...')
  await sp.write('Hello from screenpilot!\n你好,世界 🌍\n')
  await sp.write('这一行是 0.5s 后通过 Unicode 注入打出来的。\n', { delayMs: 8 })

  console.log('▸ Pressing Ctrl+A to select all...')
  await sp.hotkey('ctrl+a')
  await sleep(150)

  // Walk the element tree to prove we can read what's there.
  console.log('▸ Reading Notepad element tree...')
  const matches = await sp.findOnScreen('文件', { handle: win.handle })
  if (matches.length) {
    console.log(`  Found "文件" menu at desktop (${matches[0].center.x}, ${matches[0].center.y})`)
  } else {
    // English Notepad
    const m2 = await sp.findOnScreen('File', { handle: win.handle })
    if (m2.length) console.log(`  Found "File" menu at desktop (${m2[0].center.x}, ${m2[0].center.y})`)
    else console.log('  Menu not found via UIA (Notepad uses a custom menu chrome).')
  }

  await sleep(200)
  console.log('▸ Snapping after typing...')
  const snap2 = await sp.snap({ path: './demos/notepad-after.png', handle: win.handle })
  console.log(`  saved ${snap2.path}`)

  console.log('\n✓ Demo complete. Inspect demos/notepad-before.png and demos/notepad-after.png')
}

main().catch(err => {
  console.error('demo failed:', err.message)
  console.error(err.stack)
  process.exit(1)
})
