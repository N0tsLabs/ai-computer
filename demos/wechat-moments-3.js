// demos/wechat-moments-3.js
// Click 朋友圈 (compass icon, 5th in sidebar) — coords derived from the
// zoomed sidebar crop. Snapshot before+after, look for the Moments window.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function snap(name, handle) {
  sp.focus(handle)
  await sleep(400)
  const wx = sp.findWindow(handle)
  const path = `./demos/wechat-${name}.png`
  const r = await sp.snap({ path, handle: wx.handle })
  console.log(`  📸 ${path}  win=(${wx.x},${wx.y}) ${wx.width}x${wx.height}`)
  return { ...r, win: wx }
}

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)

  await sp.startOverlay({
    label: 'screenpilot · 打开朋友圈',
    onEvent: ev => { if (ev.kind === 'aborted') process.exit(0) },
  })
  await sleep(400)

  sp.focus(wx.handle)
  await sleep(1500)

  // 朋友圈 = compass icon, 5th in the sidebar. Refined from the ruled
  // sidebar capture (wechat-sidebar-ruled.png): the icon centre sits at
  // approximately view-y = 465, view-x = 30 (sidebar centre).
  const vx = 30
  const vy = 465
  const dx = wx.x + vx
  const dy = wx.y + vy
  console.log(`▸ Clicking 朋友圈: view=(${vx}, ${vy})  desktop=(${dx}, ${dy})`)
  sp.overlayEvent({ kind: 'custom', text: '点击', detail: `朋友圈 (compass icon)` })

  await sp.tap({ x: dx, y: dy, text: '朋友圈' })
  await sleep(2500)         // give Moments time to open

  await snap('moments-after-click', wx.handle)

  // WeChat opens Moments in a separate Qt popup window most of the time.
  const wins = sp.windows()
  const popups = wins.filter(w =>
    /Qt5/.test(w.className) &&
    w.handle !== wx.handle &&
    !/侧边栏|sidebar/i.test(w.title)
  )
  console.log(`▸ Found ${popups.length} extra Qt windows after click:`)
  popups.forEach(w => console.log(`   ${w.handle}  "${w.title}"  ${w.width}x${w.height}  cls=${w.className}`))

  // If a likely Moments popup exists, snap that too.
  const moments = popups.find(w => /朋友圈|Moments/i.test(w.title)) || popups[0]
  if (moments) {
    console.log(`▸ Snapping presumed Moments window: ${moments.handle}`)
    await snap('moments-window', moments.handle)
  }

  console.log('\n▸ Holding overlay 12 s for inspection / Esc test')
  await sleep(12000)
  await sp.stopOverlay()
}

main().catch(async e => {
  console.error('FAIL:', e.message)
  await sp.stopOverlay().catch(() => {})
  process.exit(1)
})
