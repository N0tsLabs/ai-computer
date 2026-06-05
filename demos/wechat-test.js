// demos/wechat-test.js
// Test driving WeChat (a DirectUI app whose UIA tree is empty)
// purely through screenshot + coordinate clicks, with the overlay
// narrating each step.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) {
  console.error('Pass WX_HANDLE=<handle> after `peek --windows` finds it.')
  process.exit(1)
}

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window with handle ${WX_HANDLE}`)
  console.log(`微信 window: (${wx.x},${wx.y}) ${wx.width}x${wx.height}`)

  await sp.startOverlay({
    label: 'screenpilot · 视觉操作微信',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.overlayEvent({ kind: 'custom', text: 'Step 1', detail: '聚焦并恢复微信窗口' })
  sp.focus(wx.handle)
  await sleep(1500)        // give WeChat a real beat to repaint after restore

  // Re-resolve geometry — the window may have moved after restore from tray.
  const wx2 = sp.findWindow(wx.handle) || wx
  console.log(`After focus, window at (${wx2.x},${wx2.y}) ${wx2.width}x${wx2.height}`)

  sp.overlayEvent({ kind: 'snap', text: '正在截图微信窗口…' })
  const before = await sp.snap({ path: './demos/wechat-before.png', handle: wx2.handle })
  console.log(`Saved ${before.path}  viewport=${before.viewport}  ${before.viewWidth}x${before.viewHeight}`)

  sp.overlayEvent({
    kind: 'custom', text: '等待用户分析',
    detail: '截图已保存,等待 AI 看图返回最近一条聊天的坐标',
  })

  // Hold the overlay so the user can watch.
  console.log('\n  Screenshot saved. Now the *vision-LLM-style* step would happen.')
  console.log('  I will analyse the screenshot externally and then come back with')
  console.log('  a target coordinate.\n')
  console.log('  Holding overlay for 25 s so you can see the state…')
  await sleep(25000)
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
