// scripts/debug-overlay.js
// Run the overlay binary directly with stderr forwarded.  This bypasses our
// Node wrapper so we can see any panic / WebView errors the Rust side might
// be eating silently.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bin = join(__dirname, '..', 'overlay', 'src-tauri', 'target', 'release', 'screenpilot-overlay.exe')

console.log('Launching', bin)
const child = spawn(bin, ['DEBUG TEST LABEL'], { stdio: ['pipe', 'inherit', 'inherit'] })
console.log('PID', child.pid, '— close this Node process to kill the overlay.')

setTimeout(() => {
  console.log('Killing after 10s')
  child.kill()
  process.exit(0)
}, 10000)
