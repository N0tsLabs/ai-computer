// src/core/ui-tree.js
// Bridge to PowerShell-based UI Automation tree extraction.
// We shell out to powershell.exe rather than embedding a COM client because:
//   - PS ships with every Windows since 2009 (no install)
//   - The UIAutomationClient .NET assemblies are battle-tested
//   - Zero native compilation, zero koffi-side struct gymnastics
//
// Cost: ~300-600ms per call (PS startup). Mitigation: cache results per call,
// expose `findByText`/`findByRole` so the tree is parsed once.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCRIPT_PATH = join(__dirname, '..', 'native', 'ui-tree.ps1')

function runPs(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const argv = [
      '-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH,
      ...args,
    ]
    const ps = spawn('powershell.exe', argv, { windowsHide: true })
    // Decode as UTF-8; the PS script forces UTF-8 OutputEncoding to match.
    ps.stdout.setEncoding('utf8')
    ps.stderr.setEncoding('utf8')
    let stdout = '', stderr = ''
    const timer = setTimeout(() => {
      ps.kill('SIGTERM')
      reject(new Error(`UI tree dump timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    ps.stdout.on('data', d => { stdout += d })
    ps.stderr.on('data', d => { stderr += d })
    ps.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`PowerShell exited ${code}: ${stderr.trim()}`))
        return
      }
      try {
        if (!stdout.trim()) { resolve(null); return }
        resolve(JSON.parse(stdout))
      } catch (e) {
        reject(new Error(`Bad JSON from PS: ${e.message}\n${stdout.slice(0, 200)}`))
      }
    })
  })
}

export async function dumpTree({
  handle,
  foreground = false,
  maxDepth = 8,
  minSize = 0,
  onlyInteractive = false,
} = {}) {
  const args = ['-MaxDepth', String(maxDepth), '-MinSize', String(minSize)]
  if (foreground) args.push('-Foreground')
  else if (handle) args.push('-Hwnd', String(handle))
  else throw new Error('dumpTree: pass {handle} or {foreground:true}')
  if (onlyInteractive) args.push('-OnlyInteractive')
  return runPs(args)
}

// Flatten tree to a list of {role, name, rect, patterns, path}.
// `path` is the breadcrumb of role names — useful for disambiguating
// duplicate-labeled buttons.
export function flatten(node, path = []) {
  if (!node) return []
  const here = [...path, node.role || '?']
  const self = {
    id: node.id,
    role: node.role,
    name: node.name,
    automationId: node.automationId,
    rect: node.rect,
    patterns: node.patterns,
    path: here,
    enabled: node.enabled,
  }
  const out = [self]
  for (const ch of node.children || []) out.push(...flatten(ch, here))
  return out
}

// Find elements whose visible text matches (case-insensitive substring).
// Returns elements sorted by area ascending — the smallest match is usually
// the most specific (e.g. the actual Button, not its parent Group).
export function findByText(tree, text, { role = null } = {}) {
  const needle = String(text).toLowerCase()
  const matches = []
  for (const el of flatten(tree)) {
    if (!el.rect || el.rect.width <= 0 || el.rect.height <= 0) continue
    if (role && el.role !== role) continue
    const hay = (el.name || '').toLowerCase()
    if (hay.includes(needle)) {
      matches.push({ ...el, _area: el.rect.width * el.rect.height })
    }
  }
  matches.sort((a, b) => a._area - b._area)
  return matches
}

export function findByRole(tree, role) {
  return flatten(tree).filter(el => el.role === role)
}

// Pick the geometric center of an element's bounding box.
export function centerOf(el) {
  if (!el?.rect) return null
  return {
    x: el.rect.x + Math.floor(el.rect.width / 2),
    y: el.rect.y + Math.floor(el.rect.height / 2),
  }
}
