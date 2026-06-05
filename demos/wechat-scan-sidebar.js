// demos/wechat-scan-sidebar.js
// Slowly hover each y-position in the WeChat sidebar to read tooltips.
// Better than guessing icon meaning from blurry screenshots.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function snap(name, handle) {
  sp.focus(handle)
  await sleep(300)
  const wx = sp.findWindow(handle)
  const path = `./demos/wechat-${name}.png`
  await sp.snap({ path, handle: wx.handle })
  return wx
}

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)

  await sp.startOverlay({
    label: 'screenpilot · 扫描左侧栏',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.focus(wx.handle)
  await sleep(1500)

  // Sweep y from 30 to 500 in 20px steps, x fixed at 24 (sidebar centre).
  for (let vy = 30; vy <= 500; vy += 20) {
    const dx = wx.x + 24
    const dy = wx.y + vy
    sp.overlayEvent({ kind: 'custom', text: '扫描', detail: `view-y=${vy}` })
    await sp.move({ x: dx, y: dy })
    await sleep(900)        // give tooltip ~600 ms to appear
    await snap(`scan-y${String(vy).padStart(3, '0')}`, wx.handle)
  }

  console.log('\n▸ Done. 25 snapshots in demos/wechat-scan-y*.png')
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
