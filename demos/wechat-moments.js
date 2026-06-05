// demos/wechat-moments.js
// Drive WeChat to open Moments (朋友圈) and browse recent posts.
// Pure screenshot + click loop — WeChat exposes nothing via UIA.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function snap(name) {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error('WeChat window vanished')
  // Re-focus before each snapshot — WeChat may have moved focus to a popup
  sp.focus(wx.handle)
  await sleep(500)
  const path = `./demos/wechat-${name}.png`
  const wx2 = sp.findWindow(wx.handle) || wx
  const r = await sp.snap({ path, handle: wx2.handle })
  console.log(`  📸 ${path}  ${r.viewWidth}x${r.viewHeight}  win=(${wx2.x},${wx2.y})`)
  return { ...r, win: wx2 }
}

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)

  await sp.startOverlay({
    label: 'screenpilot · 浏览朋友圈',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.focus(wx.handle)
  await sleep(1500)

  sp.overlayEvent({ kind: 'custom', text: 'Step 1', detail: '截图主界面,查找朋友圈入口' })
  await snap('00-main')

  // Best guess for "朋友圈" sidebar icon (left column, ~y=300 zone)
  // Actual offset will be tuned after looking at 00-main.
  console.log('\n  (Waiting for your read of wechat-00-main.png to refine coords)')
  console.log('  Holding overlay 90 s — Ctrl+C when you want to feed me the coord')
  for (let i = 0; i < 45; i++) {
    if (sp.isOverlayActive()) sp.overlayEvent({ kind: 'cursor', x: wx.x + 28, y: wx.y + 300 })
    await sleep(2000)
  }
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
