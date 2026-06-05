#!/usr/bin/env node
// scripts/check-toolchain.js
// Verify the developer's machine can build screenpilot-overlay.
// Run via: node scripts/check-toolchain.js
//
// Checks (in order — fails fast):
//   1. Node version ≥ 18
//   2. Rust toolchain installed (rustc + cargo on PATH)
//   3. MSVC linker reachable (Windows only)
//   4. WebView2 runtime present (Windows only)

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const lines = []
let ok = true
function check(label, fn) {
  try {
    const res = fn()
    lines.push(`  ✓ ${label}${res ? ': ' + res : ''}`)
  } catch (e) {
    ok = false
    lines.push(`  ✗ ${label}: ${e.message}`)
  }
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts })
  if (r.error) throw new Error(`${cmd} not found on PATH`)
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`)
  return (r.stdout || r.stderr || '').trim()
}

check('Node version', () => {
  const [maj] = process.versions.node.split('.').map(Number)
  if (maj < 18) throw new Error(`got ${process.versions.node}, need ≥ 18`)
  return process.versions.node
})

check('Rust (rustc)', () => run('rustc', ['--version']))
check('Cargo', () => run('cargo', ['--version']))

if (process.platform === 'win32') {
  check('MSVC linker (link.exe)', () => {
    // Probe via vswhere — it's the canonical way to find a valid VS install.
    const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe'
    if (!existsSync(vswhere)) throw new Error('vswhere not found — install Visual Studio Installer')
    const path = run(vswhere, [
      '-latest', '-products', '*',
      '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ])
    if (!path) throw new Error('VC++ Build Tools workload not installed — open VS Installer → Modify → check "Desktop development with C++"')
    return path
  })

  check('WebView2 Runtime', () => {
    // Looking at HKLM is the cheapest, but we can also fall back to the user
    // hive. Either signals the runtime is installed.
    const r = spawnSync('reg', [
      'query',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
      '/v', 'pv',
    ], { encoding: 'utf8' })
    if (r.status === 0) {
      const m = r.stdout.match(/pv\s+REG_SZ\s+(\S+)/)
      return m ? m[1] : 'installed'
    }
    throw new Error('WebView2 runtime not found — install from https://go.microsoft.com/fwlink/p/?LinkId=2124703')
  })
}

console.log('screenpilot toolchain check:\n' + lines.join('\n'))
process.exit(ok ? 0 : 1)
