#!/usr/bin/env node
// src/mcp/server.js
// MCP server wrapping the screenpilot toolkit so that any MCP-aware AI
// (Claude Code, Claude Desktop, Cursor, etc.) can drive the desktop with
// ReAct-style step-by-step tool calls.
//
// Design choices:
//   • snap returns BOTH a text summary (path + viewport) and an embedded
//     image, so the calling LLM can see the screenshot inline in the same
//     turn without a separate file-read round-trip.
//   • All tools are SAFE-BY-DEFAULT: nothing destructive runs without an
//     explicit call; the overlay must be started before any input action
//     unless the user opted into a quiet-mode session.
//   • Coordinate inputs are always desktop coordinates. There is no
//     `region` snap; the model uses full / windowed snaps and reads pixels
//     directly. This is the simplification we committed to in 0.0.2.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFileSync } from 'node:fs'

import * as sp from '../core/index.js'

const server = new McpServer({
  name: 'screenpilot',
  version: '0.0.1',
})

// ─── helpers ─────────────────────────────────────────────────────

/** Wrap any value into a CallToolResult with one text block. */
function text(obj) {
  return {
    content: [{
      type: 'text',
      text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2),
    }],
  }
}

/** Snapshot output → text block (json) + image block (base64 png). */
function snapResult(r) {
  const png = readFileSync(r.path)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          path: r.path,
          viewport: r.viewport,
          captureWidth: r.captureWidth,
          captureHeight: r.captureHeight,
          viewWidth: r.viewWidth,
          viewHeight: r.viewHeight,
          captureX: r.captureX,
          captureY: r.captureY,
        }, null, 2),
      },
      {
        type: 'image',
        data: png.toString('base64'),
        mimeType: 'image/png',
      },
    ],
  }
}

// ─── snap ────────────────────────────────────────────────────────
server.registerTool('snap', {
  title: 'Take a screenshot',
  description: [
    'Capture a screenshot. Returns BOTH a JSON descriptor (path, viewport, dimensions) and an inline image so you can read pixels immediately.',
    '',
    'Two modes only:',
    '  • Default (no handle): full virtual desktop across all monitors.',
    '  • With handle: just that window. Use this once you know which app to focus on.',
    '',
    'Coordinates you read from the image are in DESKTOP coordinates (the captureX/Y/W/H tell you the region this image covers). Click those coordinates directly with the `tap` tool.',
    '',
    'Always prefer window-scoped snapshots once you know which window to drive — they remove visual noise and let you reason about a single app.',
  ].join('\n'),
  inputSchema: {
    handle: z.number().optional().describe('Decimal window handle. Omit for fullscreen.'),
    path: z.string().optional().describe('Output PNG path (default: ./screenpilot-shot.png).'),
  },
}, async ({ handle, path }) => {
  const r = await sp.snap({ handle, path })
  return snapResult(r)
})

// ─── windows ─────────────────────────────────────────────────────
server.registerTool('windows', {
  title: 'List visible windows',
  description: 'Return every top-level window: handle, title, className, pid, and bounds. Use this to find the handle you want to scope `snap` and other tools to.',
  inputSchema: {
    includeHidden: z.boolean().optional().describe('Include hidden / minimised-to-tray windows. Default false.'),
  },
}, async ({ includeHidden = false }) => {
  return text(sp.windows({ visibleOnly: !includeHidden }))
})

// ─── focus ───────────────────────────────────────────────────────
server.registerTool('focus', {
  title: 'Bring a window to the foreground',
  description: 'Bring the given window to the foreground and restore it from the tray if needed. Always do this before clicking inside an app you suspect is buried.',
  inputSchema: {
    handle: z.number().describe('Window handle from `windows`.'),
  },
}, async ({ handle }) => {
  const ok = sp.focus(handle)
  return text({ ok })
})

// ─── tap (click) ─────────────────────────────────────────────────
server.registerTool('tap', {
  title: 'Click at a desktop coordinate',
  description: [
    'Click at a desktop (x, y). The virtual cursor flies to the target with a brief aim-animation, then the real click lands.',
    '',
    'Coordinates are DESKTOP coordinates — read them straight off the image returned by `snap`. Do NOT pre-translate.',
    '',
    'Use `count: 2` for double click, `button: "right"` for context menus.',
  ].join('\n'),
  inputSchema: {
    x: z.number().describe('Desktop X.'),
    y: z.number().describe('Desktop Y.'),
    button: z.enum(['left', 'right', 'middle']).optional(),
    count: z.number().int().optional().describe('1 = single, 2 = double.'),
    text: z.string().optional().describe('A short label shown on the overlay card, e.g. "登录按钮".'),
  },
}, async ({ x, y, button, count, text: label }) => {
  const pt = await sp.tap({ x, y, button, count, text: label })
  return text({ clicked: pt })
})

// ─── write (type) ────────────────────────────────────────────────
server.registerTool('write', {
  title: 'Type unicode text into the focused field',
  description: 'Type the given text into whatever input is focused right now. Uses Win32 Unicode injection — Chinese, emoji, RTL all work without depending on the active IME. Does NOT press Enter.',
  inputSchema: {
    text: z.string().describe('Literal text to type. Newlines become real Enter presses, so omit them unless you intend to break the line / submit.'),
    delayMs: z.number().int().optional().describe('Per-character delay in ms. Default 0 (as fast as possible).'),
  },
}, async ({ text: t, delayMs }) => {
  await sp.write(t, { delayMs })
  return text({ typed: t })
})

// ─── hotkey ──────────────────────────────────────────────────────
server.registerTool('hotkey', {
  title: 'Press a key or chord',
  description: 'Press a key or chord like "enter", "ctrl+s", "ctrl+shift+t". Modifier aliases: ctrl/control, shift, alt, win/cmd/meta.',
  inputSchema: {
    combo: z.string().describe('Chord, e.g. "ctrl+s".'),
    count: z.number().int().optional(),
    delayMs: z.number().int().optional(),
  },
}, async ({ combo, count, delayMs }) => {
  await sp.hotkey(combo, { count, delayMs })
  return text({ pressed: combo, count: count ?? 1 })
})

// ─── wheel ───────────────────────────────────────────────────────
server.registerTool('wheel', {
  title: 'Mouse-wheel scroll',
  description: 'Scroll the mouse wheel. Provide x,y to scroll at a specific point; otherwise scrolls under the current cursor.',
  inputSchema: {
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().int().optional().describe('Wheel clicks. Default 3.'),
    x: z.number().optional(),
    y: z.number().optional(),
  },
}, async ({ direction, amount, x, y }) => {
  await sp.wheel({ direction, amount, x, y })
  return text({ scrolled: direction, amount: amount ?? 3 })
})

// ─── drag ────────────────────────────────────────────────────────
server.registerTool('drag', {
  title: 'Drag from one point to another',
  description: 'Press the mouse at (fromX, fromY) and release at (toX, toY), animating the trajectory. Optional bezier control point for curved paths.',
  inputSchema: {
    fromX: z.number(), fromY: z.number(),
    toX: z.number(),   toY: z.number(),
    controlX: z.number().optional(), controlY: z.number().optional(),
    button: z.enum(['left', 'right', 'middle']).optional(),
    text: z.string().optional().describe('Label on the overlay card.'),
  },
}, async (args) => {
  const r = await sp.dragPath(args)
  return text({ dragged: r })
})

// ─── findOnScreen ────────────────────────────────────────────────
server.registerTool('findOnScreen', {
  title: 'Find UI elements by visible text (UI Automation)',
  description: [
    'Search Windows UI Automation for elements whose visible name contains the given text. Returns a list with bounding rects and centre points (desktop coordinates).',
    '',
    'This is the cheap, deterministic targeting path. Try it before falling back to vision-based clicks.',
    '',
    'Returns 0 results on apps that do not expose UIA (WeChat, parts of Electron, custom-drawn graphics). In those cases, snap and read pixels.',
  ].join('\n'),
  inputSchema: {
    text: z.string().describe('Substring to match (case-insensitive).'),
    handle: z.number().optional().describe('Scope search to this window. Defaults to foreground.'),
    role: z.string().optional().describe('Filter to a specific control type like "按钮"/"Button".'),
    maxDepth: z.number().int().optional(),
    minSize: z.number().int().optional(),
  },
}, async (args) => {
  const matches = await sp.findOnScreen(args.text, args)
  return text(matches.map(m => ({
    role: m.role, name: m.name, rect: m.rect, center: m.center,
  })))
})

// ─── overlay control ────────────────────────────────────────────
server.registerTool('startOverlay', {
  title: 'Show the takeover overlay',
  description: 'Show the breathing-glow overlay across every monitor, with a status pill saying you have taken over. Call this FIRST in any automation session so the user immediately sees AI is alive and working. Idempotent.',
  inputSchema: {
    label: z.string().optional().describe('Status pill text. e.g. "Claude · 正在打开浏览器".'),
  },
}, async ({ label }) => {
  const r = await sp.startOverlay({ label })
  return text(r)
})

server.registerTool('stopOverlay', {
  title: 'Hide the takeover overlay',
  description: 'Fade out and remove the overlay. Call this when the task is done so the user knows you have released control.',
  inputSchema: {},
}, async () => {
  const r = await sp.stopOverlay()
  return text(r)
})

server.registerTool('overlayEvent', {
  title: 'Push a card / cursor / log event onto the overlay',
  description: [
    'Surface a card on the overlay so the user can follow your reasoning in real time. Use this LIBERALLY between actions.',
    '',
    'Common kinds:',
    '  • custom — generic card with `text` (the title) and optional `detail`. Use for "思考"/"决策" narration.',
    '  • snap — annotate a screenshot you are about to take.',
    '  • error — flag something unexpected.',
    '',
    'You almost never need to send `click`/`type`/`hotkey`/`drag` manually — the corresponding `tap`/`write`/`hotkey`/`drag` tools emit those automatically.',
  ].join('\n'),
  inputSchema: {
    kind: z.string().describe('e.g. "custom", "snap", "error", "click".'),
    text: z.string().optional(),
    detail: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  },
}, async (args) => {
  sp.overlayEvent(args)
  return text({ posted: args.kind })
})

// ─── where / focus diagnostics ───────────────────────────────────
server.registerTool('where', {
  title: 'Where is the cursor / what window is in front',
  description: 'Return current cursor position and the foreground window. Quick sanity check between actions.',
  inputSchema: {},
}, async () => {
  return text({
    cursor: sp.raw.getCursorPosition(),
    foreground: sp.foreground(),
  })
})

// ─── main ────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  // stderr is fine — MCP stdio reserves stdout for the protocol itself.
  process.stderr.write(`screenpilot-mcp fatal: ${err.message}\n${err.stack}\n`)
  process.exit(1)
})
