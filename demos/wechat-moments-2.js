// demos/wechat-moments-2.js
// Step 2 — click my best guess for the 朋友圈 icon, snap, see what happens.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function snap(name, handle) {
  sp.focus(handle)
  await sleep(500)
  const wx = sp.findWindow(handle)
  if (!wx) throw new Error('window vanished')
  const path = `./demos/wechat-${name}.png`
  const r = await sp.snap({ path, handle: wx.handle })
  console.log(`  📸 ${path}  ${r.viewWidth}x${r.viewHeight}  win=(${wx.x},${wx.y})`)
  return { ...r, win: wx }
}

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)

  await sp.startOverlay({
    label: 'screenpilot · 找朋友圈',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.focus(wx.handle)
  await sleep(1500)

  // My best guess: left sidebar icon, x≈24 (sidebar centre), y≈210.
  const vx = 24
  const vy = 210
  const dx = wx.x + vx
  const dy = wx.y + vy
  console.log(`▸ Clicking guess for 朋友圈: view=(${vx}, ${vy})  desktop=(${dx}, ${dy})`)
  sp.overlayEvent({ kind: 'custom', text: '猜测', detail: `朋友圈 ?  → desktop (${dx}, ${dy})` })

  await sp.tap({ x: dx, y: dy, text: '朋友圈 (guess)' })
  await sleep(2000)

  await snap('01-after-click', wx.handle)

  // Look for a possible popup-window (Moments often opens in a new Qt window)
  const wins = sp.windows()
  const candidates = wins.filter(w =>
    /Qt5/.test(w.className) &&
    w.handle !== wx.handle &&
    (w.title.includes('朋友圈') || w.title.includes('Moments'))
  )
  if (candidates.length) {
    console.log(`▸ Found Moments popup: ${candidates[0].handle}  "${candidates[0].title}"  ${candidates[0].width}x${candidates[0].height}`)
    await snap('02-moments-popup', candidates[0].handle)
  } else {
    console.log('▸ No separate Moments window — staying with main view')
  }

  console.log('\n▸ Holding 10 s so you can inspect…')
  await sleep(10000)
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
