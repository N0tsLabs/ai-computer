// demos/wechat-sidebar-zoom.js
// Crop just the WeChat left sidebar so the vision model can see each icon
// clearly. Same idea as `usecomputer`'s window-scoped screenshots, taken
// one step further — scope to the *region* inside a window.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)
  console.log(`微信 window: (${wx.x},${wx.y}) ${wx.width}x${wx.height}`)

  await sp.startOverlay({
    label: 'screenpilot · 放大左侧栏',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.focus(wx.handle)
  await sleep(1500)

  // Snapshot the sidebar with extra margins so even small icons read well.
  // Earlier crops at 60×700 came back too compressed for downstream vision
  // to count individual icons (Claude's image preprocessor downscales to
  // ~336×400). 100×800 keeps each icon ~80×80 even after preview.
  const sidebar = {
    x: wx.x,
    y: wx.y,
    width: 100,
    height: 800,
  }
  console.log(`Cropping sidebar region: (${sidebar.x}, ${sidebar.y}) ${sidebar.width}x${sidebar.height}`)

  // maxEdge huge → don't downscale, keep native pixels for max clarity.
  const r = await sp.snap({
    path: './demos/wechat-sidebar.png',
    region: sidebar,
    maxEdge: 4096,
  })
  console.log(`  📸 ${r.path}  view=${r.viewWidth}x${r.viewHeight}  viewport=${r.viewport}`)

  sp.overlayEvent({ kind: 'snap', text: '左侧栏特写已保存,等待视觉读图' })
  await sleep(5000)
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
