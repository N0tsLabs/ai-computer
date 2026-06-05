# screenpilot

> **Semantic desktop automation for vision LLMs**, with a beautiful
> takeover overlay that shows the user where the AI is clicking and lets
> them press **Esc to take back control** at any time.

```bash
npm install -g @n0ts123/screenpilot
```

## Drop into your MCP-aware AI (one config line)

For Claude Desktop / Claude Code / Cursor / Continue, add:

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

Or with Claude Code CLI:

```bash
claude mcp add screenpilot --scope user --transport stdio -- npx -y @n0ts123/screenpilot screenpilot-mcp
```

The AI gets `snap` / `windows` / `focus` / `tap` / `write` / `hotkey` /
`wheel` / `drag` / `findOnScreen` / `startOverlay` / `stopOverlay` /
`overlayEvent` / `where` as native tool calls. See [`skills/SKILL.md`](./skills/SKILL.md)
for the full per-tool contract.

![hero](docs/hero.png)
<!-- The hero image is what you would publish — for now run
     `node demos/visual-only.js` to see the actual overlay live. -->

---

## 🤖 Copy-paste this to your AI assistant to set it up for you

> **For Claude Code / Cursor / Codex / any agentic coding tool.** Paste
> this block as your first message after cloning the repo — the AI will
> install, build, and verify everything on its own.

````markdown
Please set up the `screenpilot` desktop-automation toolkit on this Windows
machine. Follow these steps exactly:

1. **Check the environment** — Node 18+, Rust, MSVC C++ Build Tools,
   WebView2 Runtime. If anything is missing, point me to the install link
   instead of pushing past it.

   ```bash
   node scripts/check-toolchain.js
   ```

2. **Install Node dependencies.**

   ```bash
   npm install
   ```

3. **Build the overlay binary** (Tauri/Rust → produces a ~3 MB
   `screenpilot-overlay.exe`). The first build downloads ~400 crates,
   so expect 3–5 minutes. Use PowerShell, NOT Git Bash, to avoid the
   GNU `link.exe` clash on PATH.

   ```bash
   npm run build:overlay
   ```

4. **Verify everything works** by running the visual-only demo
   (touches nothing on the desktop — only animates the overlay).

   ```bash
   node demos/visual-only.js
   ```

   I should see, on every monitor:
   - a soft cyan glow breathing around the screen edge
   - a glowing virtual cursor flying through the four corners and centre
   - click ripples / drag trails
   - a stream of cards at bottom-centre describing each action
   - a top-centre pill that says "screenpilot · 演示中  · 按 Esc 收回控制"

5. **Reply with a one-sentence summary** of how it went, and the path
   to the built binary (`bin/win32-x64/screenpilot-overlay.exe`).

If any step fails, STOP and tell me the exact error. Don't paper over it.
````

---

## What it is

`screenpilot` lets a vision LLM (Claude, GPT-4V, Gemini, Qwen-VL…)
drive a real Windows desktop, with two big wins over screenshot-only
alternatives:

| Win | How |
|---|---|
| **Cheaper** | Instead of "screenshot → model picks (x,y) → click" every step, you can ask `screenpilot` "where is the *Sign in* button?" and get exact desktop coords back from Windows UI Automation in <50 ms — no image tokens needed. |
| **Less scary for users** | When AI takes over the desktop, the user sees a softly breathing glow around every screen, a virtual cursor that mirrors the AI's moves, a feed of action cards ("点击 (420, 180)" / "输入 \"hello\"" / "快捷键 ctrl+s") at bottom-centre, and a clear "press Esc to take back control" affordance at top. |

When the UI tree comes up empty (DirectUI apps, custom-drawn canvases),
the screenshot+vision path is still right there.

## The three targeting strategies

| Strategy | When to use | Cost |
|---|---|---|
| **Visible text** — `sp.tapByText("Sign in")` | Mainstream apps with accessible UI (Office, Edge, native Win32) | Zero image tokens |
| **UI tree** — `sp.findOnScreen("Save")` | Same, but you want all matches with bounds | Zero image tokens |
| **Vision + coords** — `sp.tap({x, y, viewport})` | DirectUI / Canvas / WeChat-style opaque apps | Image tokens |

You're free to mix in the same agent loop.

## The takeover overlay

When you call `sp.startOverlay()`, every connected monitor gets:

- A breathing **cyan glow** around its perimeter (DPI-aware, fits the screen edge perfectly)
- A **status pill** at top centre: `● AI 接管中 · 按 Esc 收回控制`
- A **virtual cursor** that mirrors every `tap/move/drag` you call
- Click **ripples** colour-coded by button (cyan for left, orange for right, purple for double)
- A **drag trail** of fading dots
- A **bottom-centre card feed** describing each action — last 5 cards visible, oldest fades out
- One-press **Esc → smooth fade-out → `aborted` event** sent back to your code

The overlay is **click-through** — the user can keep using their desktop
normally while it's visible. The AI's mouse/keyboard injection sits
underneath. The overlay only intercepts the Esc key.

```js
import * as sp from 'screenpilot'

await sp.withOverlay(async () => {
  await sp.tapByText('Sign in')
  await sp.write('alice@example.com')
  await sp.hotkey('tab')
  await sp.write('hunter2')
  await sp.hotkey('enter')
}, {
  label: 'Claude · 正在登录',
  onEvent: (ev) => {
    if (ev.kind === 'aborted') throw new Error('user-aborted')
  },
})
```

## Minimal agent in 30 lines

```js
import * as sp from 'screenpilot'
import Anthropic from '@anthropic-ai/sdk'

const claude = new Anthropic()

await sp.withOverlay(async () => {
  // Try the cheap path first.
  let matches = await sp.findOnScreen('Sign in')
  if (matches.length === 1) {
    await sp.tap({ x: matches[0].center.x, y: matches[0].center.y })
    return
  }
  // Fall back to vision.
  const shot = await sp.snap({ path: './step.png' })
  const msg = await claude.messages.create({
    model: 'claude-opus-4-8',
    tools: [{ type: 'computer_20251124', name: 'computer',
              display_width_px: shot.viewWidth,
              display_height_px: shot.viewHeight }],
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64',
        media_type: 'image/png',
        data: await readFile(shot.path, 'base64') } },
      { type: 'text', text: 'Click Sign in.' },
    ]}],
  })
  const action = msg.content.find(c => c.type === 'tool_use').input
  await sp.tap({ x: action.coordinate[0], y: action.coordinate[1],
                 viewport: shot.viewport })
}, { label: 'Claude · 自动登录中' })
```

## CLI in one screen

```bash
screenpilot snap shot.png --json
screenpilot snap --handle 67890 --json
screenpilot snap --full --json                 # all monitors stitched

screenpilot tap --text "Save"                  # by visible label
screenpilot tap --text "用户名" --role Edit
screenpilot tap -x 400 -y 220 --viewport "vp1:..."

screenpilot write "hello, 世界 🌍"             # Unicode (no IME needed)
screenpilot hotkey "ctrl+s"
screenpilot wheel down --amount 5
screenpilot drag 100,200 500,600

screenpilot peek --windows                     # list windows
screenpilot peek --tree --depth 6              # UIA tree
screenpilot peek --text "Save"                 # find by text → coords

screenpilot overlay on --label "Claude · 接管中"
screenpilot overlay on --duration 8000         # auto-hide after 8 s
screenpilot overlay off

screenpilot where                              # cursor + foreground
screenpilot focus 79825004                     # bring window to front
```

`sp` is the short alias. Every command has `--help`.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  CLI / Library API (src/cli, src/index.js)             │
└────────────────────────────────────────────────────────┘
                       │
       ┌───────────────┼────────────────┬──────────────┐
       ▼               ▼                ▼              ▼
┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Viewport   │ │ UI Tree      │ │ Win32 FFI    │ │ Overlay      │
│ (vp1:)     │ │ (PS + UIA)   │ │ (koffi)      │ │ (Tauri exe)  │
└────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                       │                │              │
                       ▼                ▼              ▼
              ┌──────────────┐ ┌─────────────────┐ ┌──────────────┐
              │ PowerShell + │ │ user32/gdi32/   │ │ WebView2 +   │
              │ .NET UIA     │ │ shcore          │ │ CSS animation│
              └──────────────┘ └─────────────────┘ └──────────────┘
```

`koffi` calls Win32 directly — no native compilation for the JS side.
The Tauri overlay is one ~3 MB exe per platform, prebuilt and bundled
into the npm package.

## How this differs from alternatives

| Project | Approach | Strength | Limitation |
|---|---|---|---|
| `usecomputer` (npm) | Native Zig binary, screenshot-only | Single small executable | Vision tokens every step, no UI tree, no takeover overlay |
| `pyautogui` | Python, screenshot + image-match | Mature, scriptable | No accessibility tree, no Unicode input, no overlay |
| `robotjs` | Node native addon | Native speed | Needs `node-gyp`, no UI tree, no overlay |
| **`screenpilot`** | Node + koffi + UIA tree + Tauri overlay | Three-tier targeting, beautiful user-facing overlay, multi-monitor + DPI aware, no compilation needed at install | Windows-only in 0.2.x |

## What's intentionally not here yet

- **macOS / Linux backends** — design is platform-agnostic but Windows
  ships first in 0.2.x.
- **OCR fallback** — planned for 0.3 (RapidOCR via ONNX Runtime), so
  even DirectUI apps that hide their tree become text-clickable.
- **MCP server mode** — planned for 0.3 so Claude Desktop / Cursor /
  Continue can invoke it without writing any glue code.
- **Recording & replay** — planned for 0.4; capture a session, replay
  it deterministically to skip vision tokens entirely.

## Demos

```bash
node demos/visual-only.js      # pure overlay animation, touches nothing
node demos/showcase.js         # full real-app automation with overlay
node demos/aim-hold.js         # holds cursor + overlay so you can screenshot
node demos/notepad.js          # minimal: open notepad, type, snapshot
```

## License

MIT
