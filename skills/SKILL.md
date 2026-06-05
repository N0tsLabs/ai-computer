---
name: screenpilot
description: >
  Semantic desktop automation for vision LLMs (Claude, GPT-4V, Gemini,
  Qwen-VL). Provides screenshot + UI element tree + Unicode input + a
  translucent breathing-glow overlay that shows the user where you (the
  AI) are clicking and typing in real time, with one-press Esc takeback.
  Use this skill whenever you need to control a real Windows desktop on
  the user's behalf, especially when the user wants to *see* what you're
  doing as you do it.
---

# screenpilot

`screenpilot` is two things at once:

1. A **headless automation toolkit** that lets you click, type, drag,
   screenshot, and read accessibility trees on Windows from Node.js.
2. A **takeover UI** — when you call `startOverlay()`, every screen gets
   a softly breathing glow around its edge, a small status pill at top
   centre ("AI 接管中 · 按 Esc 收回控制"), a virtual cursor that mirrors
   the position you're clicking, and a bottom-centre feed of cards
   describing each action ("点击", "输入", "拖拽", "快捷键", "截图"…).

The user can take control back at any moment with a single Esc keypress;
the overlay fades out, your script receives an `aborted` event, and you
must stop further actions immediately.

## Always start with --help

```bash
screenpilot --help
screenpilot snap --help
screenpilot tap --help
screenpilot overlay --help
```

Aliases: `sp` works as a shortcut for `screenpilot`.

## Install

```bash
npm install -g @n0ts123/screenpilot
```

Requirements:
- **Windows 10/11**
- **Node 18+**
- **WebView2 Runtime** (preinstalled on Windows 10 1809+ and all Win11)

A prebuilt overlay binary ships in the package; no Rust/MSVC needed at
install time. If you want to rebuild the overlay locally:

```bash
npm run build:overlay   # needs Rust + MSVC C++ Build Tools
```

## Use it as an MCP server (recommended)

The fastest way for any MCP-aware agent (Claude Desktop, Claude Code,
Cursor, Continue…) to drive the desktop is to plug `screenpilot-mcp`
directly into your MCP config:

```jsonc
{
  "mcpServers": {
    "screenpilot": {
      "command": "npx",
      "args": ["-y", "@n0ts123/screenpilot", "screenpilot-mcp"]
    }
  }
}
```

After restart, your agent gets these tools (each is one MCP tool call,
nothing else to wire up):

| Tool | What it does |
|---|---|
| `snap` | Full desktop or window screenshot. Returns both JSON metadata and the inline PNG so the agent reads pixels in the same turn. |
| `windows` | List visible top-level windows (handle, title, className, pid, rect). |
| `focus` | Bring a window to the foreground / restore from tray. |
| `tap` | Click at a desktop `(x, y)`. Virtual cursor flies to the target first, then the real click lands. |
| `write` | Type Unicode text into the focused field (no IME involvement). |
| `hotkey` | Press a chord like `ctrl+s` or `enter`. |
| `wheel` | Mouse-wheel scroll. |
| `drag` | Drag from one point to another, optional bezier curve. |
| `findOnScreen` | Look up UI elements by visible text (UI Automation tree). Returns 0 hits on Qt/Electron/canvas apps — fall back to vision. |
| `startOverlay` / `stopOverlay` | Show / hide the takeover overlay. |
| `overlayEvent` | Push a narration card (思考/决策/error/...) onto the overlay. |
| `where` | Current cursor + foreground window — quick sanity check. |

Default ReAct loop (what your agent should do every session):

1. `startOverlay({ label: "Claude · 正在 …" })` — first tool call, gives
   the user instant visual confirmation.
2. `windows()` → pick the handle of the app you need.
3. `focus({ handle })` → make sure that app is in front.
4. `snap({ handle })` → get the inline image.
5. Read coordinates from the image, optionally narrate via
   `overlayEvent({ kind: "custom", text: "思考", detail: "..." })`.
6. `tap` / `write` / `hotkey` / etc.
7. Re-snap and loop.
8. `stopOverlay()` when done.

## Three targeting strategies — pick the cheapest that works

| Strategy | When | Cost |
|---|---|---|
| **Visible text** — `sp.tapByText("Sign in")` | App exposes UI tree (Office, Edge, native Win32) | Zero image tokens |
| **UI tree** — `sp.findOnScreen("Save")` | Same, but you want all matches with bounds | Zero image tokens |
| **Vision coords** — `sp.tap({x, y, viewport})` | DirectUI / Canvas / WeChat-style opaque apps | Image tokens |

Mix freely. If text lookup returns no results, fall back to screenshot +
vision model.

## The takeover overlay

### Showing it

```js
import * as sp from 'screenpilot'

await sp.startOverlay({
  label: 'Claude · 正在打开浏览器并登录',
  onEvent: (ev) => {
    if (ev.kind === 'aborted') {
      // User pressed Esc — stop immediately, do not run more actions.
      throw new Error('user-aborted')
    }
  },
})
```

After `startOverlay()`, every `sp.tap/write/hotkey/dragPath/wheel` you
call **automatically** sends a matching event to the overlay — virtual
cursor flies to the target first (so the user sees you aim before you
click), ripples appear at the click point, cards stream in at the bottom.
You don't need to send visual events by hand.

### ⚠️ How to be a "good agent" on this overlay

Users find your work much more legible if you treat the overlay as a
*narration channel*, not just a side-effect. Concrete rules:

1. **Call `startOverlay()` as the very first thing you do** in any
   automation task — even before reading the rest of your prompt. The
   overlay's own "接管成功" card gives the user immediate visual
   confirmation that you're alive and working.

2. **Emit a thought card before every meaningful step**:

   ```js
   sp.overlayEvent({ kind: 'custom', text: '思考', detail: '需要先截图主窗口找朋友圈入口' })
   ```

   The user can't read your inner monologue, only what you push here.
   Don't be silent for more than a few seconds.

3. **Emit a snap card before each screenshot**:

   ```js
   sp.overlayEvent({ kind: 'snap', text: '正在截图微信主窗口' })
   const shot = await sp.snap({ handle: wx.handle, path: './step.png' })
   ```

4. **When you read a screenshot and decide what to click, emit a decision
   card with the reason** — not just "click button":

   ```js
   sp.overlayEvent({ kind: 'custom', text: '决策',
     detail: '左侧栏第 5 个图标(指南针)是朋友圈,view (30, 465)' })
   await sp.tap({ x: wx.x + 30, y: wx.y + 465 })
   ```

5. **If something looks wrong, say so**: emit an `error` kind card with
   the surprise, take another screenshot, decide what to do, narrate it.

The goal: a user watching your overlay alone (no terminal, no chat
window) can follow what you're doing and trust you. If they can't,
that's a bug in your narration, not in the overlay.

### Updating the label mid-session

```js
sp.overlayEvent({ kind: 'label', text: 'Claude · 正在阅读邮件' })
```

### Pushing custom log cards (decisions, thoughts)

```js
sp.overlayEvent({
  kind: 'custom',
  text: '决策',
  detail: '登录页已加载,准备填入凭据',
})
```

Other built-in card kinds for direct use: `click`, `right-click`,
`double-click`, `drag`, `type`, `hotkey`, `snap`, `scroll`, `error`.

### Hiding it

```js
await sp.stopOverlay()
```

Or wrap a whole session with `withOverlay()`:

```js
await sp.withOverlay(async () => {
  await sp.tapByText('Sign in')
  await sp.write('alice@example.com')
  // …
}, { label: 'Claude · 接管中' })
```

### Esc abort

When the user presses Esc once, the overlay fades out smoothly (~0.4 s)
and emits `{kind:'aborted', by:'user'}` via `onEvent`. Treat this as a
hard stop: **do not execute any more automation actions** after seeing
this event. Your wrapper code should also tear down any in-flight loops.

### Multi-monitor

The overlay automatically spans every connected display, with DPI-aware
coordinate translation. You don't need to do anything — coordinates you
pass to `sp.tap/move/etc.` are in desktop space and land correctly even
when monitors have different scale factors or sit at negative virtual
coordinates.

## The semantic action loop

```
goal "click Sign in"
  → screenpilot.tapByText("Sign in")
     → vfx: virtual cursor flies to the button, ripple, "点击" card
     → real cursor moves and clicks
  → screenpilot.snap() to verify
  → repeat
```

If `tapByText` returns no matches, fall back to:

```js
const shot = await sp.snap({ path: './step.png' })
// send shot.path to your vision model, get back e.g. (740, 320)
await sp.tap({ x: 740, y: 320, viewport: shot.viewport })
```

## Viewport — what the `vp1:` string is

Every `snap` emits a string like
`vp1:0:0:2880:1800:1568:980:0.544`:

```
vp1 : captureX : captureY : captureWidth : captureHeight : viewWidth : viewHeight : scale
```

`viewWidth/Height` are the dimensions of the PNG the model actually
sees (long edge capped at 1568 by default). When you pass
`--viewport <string>` to `tap`/`drag`/`wheel`/`move`, view-space
coordinates get translated back to real desktop pixels.

**Always pass the viewport from the same snap the model analysed.**
Stale viewport = clicks land in the wrong place — the most common bug.

## CLI in one screen

```bash
# Capture
screenpilot snap shot.png --json
screenpilot snap --handle 67890 --json
screenpilot snap --full --json                 # all monitors stitched

# Semantic / coord clicks
screenpilot tap --text "Save"
screenpilot tap --text "用户名" --role Edit
screenpilot tap -x 400 -y 220 --viewport "vp1:..."
screenpilot tap -x 400 -y 220 --button right --count 2

# Keyboard
screenpilot write "hello, 世界 🌍"            # Unicode-safe, no IME
screenpilot hotkey "ctrl+s"
screenpilot hotkey "ctrl+shift+t" --count 3

# Scroll & drag
screenpilot wheel down --amount 5
screenpilot drag 100,200 500,600              # straight
screenpilot drag 100,200 500,600 300,50       # curved (bezier)

# Inspect
screenpilot peek --windows                    # JSON list of top windows
screenpilot peek --tree --handle 67890        # full UI tree
screenpilot peek --text "Save"                # find by text → coords
screenpilot where                             # cursor + foreground

# Takeover overlay
screenpilot overlay on --label "Claude · 接管中"
screenpilot overlay on --duration 8000        # auto-hide after 8 s
screenpilot overlay off

# Misc
screenpilot focus 79825004                    # bring window to front
```

Every command has `--help`. `sp` is the short alias.

## Window-scoped capture (less noise → better targeting)

```bash
# 1. Find the window
screenpilot peek --windows
# → [{ "handle": 79825004, "title": "...Microsoft Edge", ... }, ...]

# 2. Capture just that window
screenpilot snap edge.png --handle 79825004 --json

# 3. Click using the viewport from step 2
screenpilot tap -x 400 -y 220 --viewport "<vp1 from step 2>"
```

The viewport carries the window's desktop offset, so coordinates land
correctly even though the screenshot only shows one app.

## When the UI tree is empty

Some apps (older WeChat windows, parts of Electron apps, custom-drawn
graphics editors) hide their internals from UI Automation. `findOnScreen`
returns 0 matches reliably; branch your agent:

```js
const matches = await sp.findOnScreen('登录')
if (matches.length === 0) {
  // Fall back to vision
  const shot = await sp.snap({ handle: win.handle, path: './login.png' })
  // …feed shot to a vision model and use the returned coords
}
```

## Typing — Unicode safe

`sp.write` injects UTF-16 code units via Win32 `SendInput` with
`KEYEVENTF_UNICODE`. Chinese, emoji, RTL — all work without depending
on the active IME.

For long text (paragraphs, code), use the clipboard instead via
`sp.hotkey('ctrl+v')` after putting text in the clipboard.

## Tips for accurate clicks

- **Always pass the viewport from the most recent `snap`.**
- **Prefer window-scoped snaps** — smaller image, more focused tokens.
- **Try `findOnScreen` first.** It's deterministic and free of image tokens.
- **Show the overlay during real-user-facing automation.** Users tolerate
  AI driving their screen far better when they can see what's about to
  happen, and they always have Esc as the panic button.
- **Stop on `aborted` event.** Honour user takeback — don't fight it.

## Troubleshooting

1. **`SendInput failed — desktop may be locked`** — Windows blocks input
   synthesis when the secure desktop is up (login screen, UAC). Wait.

2. **`screenpilot-overlay binary not found`** — Either install via npm
   (which bundles the binary) or run `npm run build:overlay` in the repo.
   Requires Rust + MSVC.

3. **Clicks land slightly off** — viewport mismatch. Re-snap, take the
   fresh viewport, retry.

4. **Multi-monitor coordinates look negative** — that's correct. Windows
   places secondary monitors at negative virtual-screen coordinates. The
   viewport encodes the offset, you don't have to think about it.

5. **Empty UI tree on WeChat / certain Electron apps** — expected. Use
   the screenshot+vision path.

6. **Overlay disappears when window loses focus** — by design, `Esc` is
   only captured when the WebView has focus, but the visual overlay
   continues to render regardless of focus. If Esc isn't working,
   click anywhere on the overlay's invisible surface (it's click-through
   for desktop apps but still focuses on the next interaction with the
   WebView's own keyboard accelerator).
