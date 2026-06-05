// demos/wechat-sidebar-ruled.js
// Snapshot the WeChat sidebar with a horizontal ruler overlaid via sharp
// (draws faint tick marks every 10 px). Lets the vision model report
// "the compass icon is at y=NNN" with low ambiguity.

import { setTimeout as sleep } from 'node:timers/promises'
import sharp from 'sharp'
import * as sp from '../src/core/index.js'

const WX_HANDLE = Number(process.env.WX_HANDLE || 0)
if (!WX_HANDLE) { console.error('WX_HANDLE missing'); process.exit(1) }

async function main() {
  const wx = sp.findWindow(WX_HANDLE)
  if (!wx) throw new Error(`No window ${WX_HANDLE}`)
  sp.focus(wx.handle)
  await sleep(800)

  // 70 wide gives us 10 px of ruler gutter on the right side.
  const W = 70, H = 700
  const sidebar = { x: wx.x, y: wx.y, width: W, height: H }
  const raw = sp.raw.captureRect(sidebar)

  // Build an SVG overlay: ticks + labels every 50 px.
  const ticks = []
  for (let y = 0; y < H; y += 10) {
    const major = y % 50 === 0
    ticks.push(`<line x1="${W - (major ? 14 : 6)}" y1="${y + 0.5}" x2="${W}" y2="${y + 0.5}" stroke="${major ? '#00ffff' : '#80808080'}" stroke-width="1" />`)
    if (major) {
      ticks.push(`<text x="${W - 18}" y="${y + 4}" font-size="9" font-family="monospace" fill="#00ffff" text-anchor="end">${y}</text>`)
    }
  }
  const overlay = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${ticks.join('')}</svg>`
  )

  await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png()
    .composite([{ input: overlay, top: 0, left: 0 }])
    .toFile('./demos/wechat-sidebar-ruled.png')

  console.log(`📸 wechat-sidebar-ruled.png  ${W}x${H}  origin=(${wx.x}, ${wx.y})`)
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
