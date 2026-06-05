#!/usr/bin/env node
// src/cli/bin.js
// `screenpilot` (alias `sp`) — semantic desktop automation CLI.
//
// Verb design philosophy (intentionally distinct from `usecomputer`):
//   snap      capture screen
//   tap       click (with coords or by --text)
//   write     type text
//   hotkey    press key combo
//   wheel     scroll
//   drag      drag from→to
//   peek      list windows / dump UI tree
//   focus     bring a window to front
//
// Every command that targets coords accepts --viewport "<vp-string>" so the
// model can hand back the same view-space coordinates it saw in the snapshot.

import sade from 'sade'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import * as sp from '../core/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))

const prog = sade('screenpilot').version(pkg.version)

function out(data, json) {
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n')
  } else if (typeof data === 'string') {
    process.stdout.write(data + '\n')
  } else {
    process.stdout.write(JSON.stringify(data) + '\n')
  }
}

function dieOnError(promise) {
  promise.catch(err => {
    process.stderr.write(`screenpilot: ${err.message}\n`)
    process.exit(1)
  })
}

// ─── snap ────────────────────────────────────────────────────────
prog
  .command('snap [path]')
  .describe('Capture a screenshot. Defaults to the full virtual desktop. Pass --handle to scope to one window.')
  .option('--handle', 'Capture this window handle (decimal int). Without it, snaps every monitor.')
  .option('--max-edge', 'Long-edge limit for the output image', 1568)
  .option('--json', 'Emit JSON (path, viewport, dimensions)')
  .example('snap shot.png --json')
  .example('snap --handle 67890 -o app.png')
  .action((path, opts) => dieOnError((async () => {
    const r = await sp.snap({
      path: path || './screenpilot-shot.png',
      handle: opts.handle ? Number(opts.handle) : undefined,
      maxEdge: Number(opts['max-edge']) || 1568,
    })
    if (opts.json) {
      out(r, true)
    } else {
      out(`${r.path}  viewport=${r.viewport}`)
    }
  })()))

// ─── tap (click) ─────────────────────────────────────────────────
prog
  .command('tap')
  .describe('Click — by coordinates OR by visible text. The "smart click" entrypoint.')
  .option('-x', 'X coordinate (view-space if --viewport given, else desktop)')
  .option('-y', 'Y coordinate')
  .option('--viewport', 'Viewport string emitted by `snap`. Translates x,y back to desktop coords.')
  .option('--text', 'Click the smallest UI element whose visible name matches this text')
  .option('--role', 'Constrain --text to a specific control type (Button, Edit, ...)')
  .option('--handle', 'When using --text, search inside this window handle')
  .option('--button', 'left | right | middle', 'left')
  .option('--count', 'Click count', 1)
  .option('--mod', 'Modifier key, repeatable (e.g. --mod ctrl --mod shift)')
  .example('tap -x 400 -y 220 --viewport vp1:0:0:1920:1080:1568:882:1')
  .example('tap --text "Sign in" --role Button')
  .action((opts) => dieOnError((async () => {
    const modifiers = []
    if (opts.mod) {
      if (Array.isArray(opts.mod)) modifiers.push(...opts.mod)
      else modifiers.push(opts.mod)
    }
    if (opts.text) {
      const r = await sp.tapByText(opts.text, {
        role: opts.role,
        handle: opts.handle ? Number(opts.handle) : undefined,
        button: opts.button, count: Number(opts.count),
      })
      out({ point: r.point, target: { role: r.target.role, name: r.target.name } }, true)
      return
    }
    if (typeof opts.x === 'undefined' || typeof opts.y === 'undefined') {
      throw new Error('Pass -x/-y, or --text "Some label"')
    }
    const point = await sp.tap({
      x: Number(opts.x), y: Number(opts.y),
      viewport: opts.viewport, button: opts.button,
      count: Number(opts.count), modifiers,
    })
    out({ point }, true)
  })()))

// ─── write (type) ────────────────────────────────────────────────
prog
  .command('write <text>')
  .describe('Type unicode text (Chinese / emoji OK — uses Win32 UNICODE injection)')
  .option('--delay', 'Per-character delay in ms', 0)
  .example('write "Hello, 世界 🌍"')
  .action((text, opts) => dieOnError(sp.write(text, { delayMs: Number(opts.delay) })))

// ─── hotkey ──────────────────────────────────────────────────────
prog
  .command('hotkey <combo>')
  .describe('Press a key or chord (e.g. enter, ctrl+s, ctrl+shift+p)')
  .option('--count', 'Repeat count', 1)
  .option('--delay', 'Delay between repeats in ms', 40)
  .example('hotkey enter')
  .example('hotkey "ctrl+shift+t"')
  .action((combo, opts) => dieOnError(sp.hotkey(combo, {
    count: Number(opts.count), delayMs: Number(opts.delay),
  })))

// ─── wheel ───────────────────────────────────────────────────────
prog
  .command('wheel <direction>')
  .describe('Mouse-wheel scroll. direction = up | down | left | right')
  .option('--amount', 'Wheel clicks (each = 120 units)', 3)
  .option('-x', 'Scroll at this X (optional)')
  .option('-y', 'Scroll at this Y (optional)')
  .option('--viewport', 'Viewport string for x,y translation')
  .action((direction, opts) => dieOnError(sp.wheel({
    direction,
    amount: Number(opts.amount),
    x: typeof opts.x !== 'undefined' ? Number(opts.x) : undefined,
    y: typeof opts.y !== 'undefined' ? Number(opts.y) : undefined,
    viewport: opts.viewport,
  })))

// ─── drag ────────────────────────────────────────────────────────
prog
  .command('drag <from> <to> [control]')
  .describe('Drag from "x,y" to "x,y", optional bezier control point.')
  .option('--viewport', 'Viewport string for coordinate translation')
  .option('--button', 'left | right | middle', 'left')
  .example('drag 100,200 500,600')
  .example('drag 100,200 500,600 300,50  # curved path')
  .action((from, to, control, opts) => dieOnError((async () => {
    const [fx, fy] = from.split(',').map(Number)
    const [tx, ty] = to.split(',').map(Number)
    let cx, cy
    if (control) { [cx, cy] = control.split(',').map(Number) }
    await sp.dragPath({
      fromX: fx, fromY: fy, toX: tx, toY: ty,
      controlX: cx, controlY: cy,
      viewport: opts.viewport, button: opts.button,
    })
  })()))

// ─── peek (window list + UI tree) ────────────────────────────────
prog
  .command('peek')
  .describe('Inspect what is on the screen: window list, foreground window, or a UI element tree.')
  .option('--windows', 'List visible top-level windows')
  .option('--tree', 'Dump UI Automation element tree of a window')
  .option('--handle', 'Window handle (when using --tree). Omit to use foreground.')
  .option('--depth', 'Max tree depth', 8)
  .option('--min-size', 'Skip elements smaller than this many px', 4)
  .option('--text', 'Filter --tree results to elements whose name contains this text')
  .option('--json', 'Always emit JSON', true)
  .example('peek --windows')
  .example('peek --tree --text "Save"')
  .action((opts) => dieOnError((async () => {
    if (opts.windows || (!opts.tree && !opts.text)) {
      const wins = sp.windows()
      out(wins, true)
      return
    }
    const handle = opts.handle ? Number(opts.handle) : undefined
    if (opts.text) {
      const matches = await sp.findOnScreen(opts.text, {
        handle, maxDepth: Number(opts.depth), minSize: Number(opts['min-size']),
      })
      out(matches, true)
      return
    }
    const tree = await sp.ui.dumpTree({
      handle, foreground: !handle,
      maxDepth: Number(opts.depth), minSize: Number(opts['min-size']),
    })
    out(tree, true)
  })()))

// ─── focus ───────────────────────────────────────────────────────
prog
  .command('focus <handle>')
  .describe('Bring a window to the foreground.')
  .action((handle) => dieOnError((async () => {
    const ok = sp.focus(Number(handle))
    out({ ok })
  })()))

// ─── where (cursor / foreground) ─────────────────────────────────
prog
  .command('where')
  .describe('Print cursor position and foreground window info.')
  .option('--json', 'JSON output', true)
  .action(() => {
    const cursor = sp.raw.getCursorPosition()
    const fg = sp.foreground()
    out({ cursor, foreground: fg }, true)
  })

// ─── overlay ─────────────────────────────────────────────────────
prog
  .command('overlay <cmd>')
  .describe('Manage the breathing-glow takeover overlay. <cmd> = on | off | run')
  .option('--label', 'Status text shown in the pill', 'AI 接管中')
  .option('--duration', 'For `on`, auto-hide after N ms', 0)
  .example('overlay on                       # show until process exits')
  .example('overlay on --label "Claude is driving"')
  .example('overlay on --duration 8000      # show for 8s then hide')
  .example('overlay off                     # hide')
  .action((cmd, opts) => dieOnError((async () => {
    if (cmd === 'on') {
      const r = await sp.startOverlay({ label: opts.label })
      out(r, true)
      if (Number(opts.duration) > 0) {
        await new Promise(r => setTimeout(r, Number(opts.duration)))
        await sp.stopOverlay()
      } else {
        // Keep the CLI process alive so the overlay child stays open.
        // Ctrl+C or SIGTERM will tear both down.
        await new Promise(() => {})
      }
    } else if (cmd === 'off') {
      const r = await sp.stopOverlay()
      out(r, true)
    } else {
      throw new Error(`overlay: unknown command "${cmd}" (use on | off)`)
    }
  })()))

prog.parse(process.argv)
