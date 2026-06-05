// demos/capture-overlay.js
// Meta demo: start the overlay, screenshot the screen so you can SEE the
// glow without having to be in front of the monitor at the right moment.

import { setTimeout as sleep } from 'node:timers/promises'
import * as sp from '../src/core/index.js'

async function main() {
  console.log('▸ Starting overlay (label: "Claude 正在驾驶你的桌面")...')
  await sp.startOverlay({ label: 'Claude 正在驾驶你的桌面' })

  // Give the WebView time to lay out the gradients + start the orbit animation.
  await sleep(1500)

  console.log('▸ Snapping desktop with overlay visible...')
  const r = await sp.snap({ path: './demos/overlay-proof.png', fullVirtual: true })
  console.log(`  saved ${r.path}  ${r.viewWidth}x${r.viewHeight}`)

  await sleep(500)
  console.log('▸ Stopping overlay.')
  await sp.stopOverlay()

  console.log('\n✓ Look at demos/overlay-proof.png to see the glow.')
}

main().catch(async e => {
  await sp.stopOverlay().catch(() => {})
  console.error('FAIL:', e.message)
  process.exit(1)
})
