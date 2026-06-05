// demos/wechat-aim.js
// Aim test against WeChat. Coordinates derived from my visual analysis
// of demos/wechat-before.png — view-space x≈180, y≈110 → desktop
// (wxX + 180, wxY + 110).

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)

  await sp.startOverlay({
    label: 'screenpilot · 微信瞄准测试',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.focus(wx.handle)
  await sleep(1500)

  // Targets in view-space (where I'm reading them from the screenshot)
  // Window viewport scale = 1 here, so view-space == window-local space.
  // Desktop coord = window origin + local.
  const targets = [
    { name: '列表第一项 (小爹宝宝爹)',  vx: 180, vy: 110 },
    { name: '当前选中 (袁驰,绿色高亮)', vx: 180, vy: 230 },
    { name: '最新消息 (可以的, 我在看)', vx: 880, vy: 1335 },
    { name: '输入框',                    vx: 880, vy: 1430 },
  ]

  for (const t of targets) {
    const dx = wx.x + t.vx
    const dy = wx.y + t.vy
    console.log(`\n▸ ${t.name}  desktop=(${dx}, ${dy})`)
    sp.overlayEvent({ kind: 'custom', text: '瞄准', detail: `${t.name} → (${dx}, ${dy})` })
    await sp.move({ x: dx, y: dy })
    await sleep(2500)         // dwell so you can compare alignment
  }

  console.log('\n▸ All targets visited. Holding overlay 8 s for last screenshot…')
  sp.overlayEvent({ kind: 'snap', text: '保留 8 秒供你截图对比' })
  await sleep(8000)
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
