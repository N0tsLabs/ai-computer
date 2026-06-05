#!/usr/bin/env node
// scripts/install-overlay.js
// Copy the freshly-built overlay binary into bin/<platform>/ so that
// the locator in src/core/overlay.js finds it without a SCREENPILOT_OVERLAY
// env override. Runs after `npm run build:overlay`.

import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const platform = process.platform
const arch = process.arch
if (platform !== 'win32' || arch !== 'x64') {
  console.warn(`install-overlay: platform ${platform}-${arch} not supported yet.`)
  process.exit(0)
}

const ext = '.exe'
const src = join(root, 'overlay', 'src-tauri', 'target', 'release', `screenpilot-overlay${ext}`)
const destDir = join(root, 'bin', `${platform}-${arch}`)
const dest = join(destDir, `screenpilot-overlay${ext}`)

if (!existsSync(src)) {
  console.error(`install-overlay: source not found at ${src}`)
  console.error('  Did you run `cargo build --release` first?')
  process.exit(1)
}

mkdirSync(destDir, { recursive: true })
copyFileSync(src, dest)
console.log(`✓ Installed overlay binary to ${dest}`)
