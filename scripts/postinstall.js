#!/usr/bin/env node
// scripts/postinstall.js
// Runs after `npm install`. Verifies that the prebuilt overlay binary for
// this platform is present; if not, prints clear guidance instead of
// blowing up the install.

import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const platform = process.platform
const arch = process.arch

if (platform !== 'win32') {
  console.log('screenpilot currently supports Windows only. macOS/Linux planned.')
  process.exit(0)
}

const ext = platform === 'win32' ? '.exe' : ''
const binary = join(__dirname, '..', 'bin', `${platform}-${arch}`, `screenpilot-overlay${ext}`)

if (existsSync(binary)) {
  console.log(`✓ screenpilot overlay ready at ${binary}`)
} else {
  console.log()
  console.log('⚠ screenpilot overlay binary not bundled for this platform.')
  console.log('  Build it locally:')
  console.log('    cd node_modules/screenpilot && npm run build:overlay')
  console.log('  (requires Rust + MSVC C++ Build Tools)')
  console.log()
}
