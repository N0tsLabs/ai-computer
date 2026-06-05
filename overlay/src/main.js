// overlay/src/main.js
// Front-end runtime for the screenpilot overlay.
//
// Responsibilities:
//   1. Render label/cursor/feed based on events from Rust.
//   2. Handle Esc long-press → emit takeover-aborted event back to Rust.
//   3. Keep painting at idle so WebView2 doesn't skip frames.
//
// Communication contract with Rust:
//   - Rust sends events via window.__SP_EVENT__(json) using webview.eval()
//   - JS sends events to Rust via window.__TAURI__.core.invoke('on_event', {...})
//   - Both directions use the same envelope shape:
//       { kind, text?, x?, y?, fromX?, fromY?, toX?, toY?, detail? }

const elLabel    = document.getElementById('label')
const elFeed     = document.getElementById('feed')
const elCursor   = document.getElementById('vcursor')
const elProgress = document.getElementById('esc-progress')

const MAX_CARDS  = 5
const FEED_TTL   = 6000
// Press Esc once → smooth fade-out then quit. No long-press required.
const FADE_OUT_MS = 420

// ─── Rust → JS bridge ────────────────────────────────────────────
// Rust uses `webview.eval("__SP_EVENT__(...)")`, so we just expose the fn.
// Each overlay window is pinned to one monitor; events arrive in *desktop*
// PHYSICAL pixel coordinates. We convert them to this window's local CSS
// pixel space by:
//   1. subtracting the window's physical top-left (injected as __SP_VIEWPORT__)
//   2. dividing by the monitor's DPI scale factor
// Using window.screenX/Y here would be wrong on multi-DPI setups because
// Chromium reports them in scaled logical pixels relative to a unified
// "virtual screen origin" that doesn't match Tauri's physical coordinates.
function toLocal({ x, y }) {
  if (typeof x !== 'number' || typeof y !== 'number') return { x, y }
  const vp = window.__SP_VIEWPORT__
  if (!vp) {
    // Fallback for dev preview without Rust injection.
    return { x: x - window.screenX, y: y - window.screenY }
  }
  return {
    x: Math.round((x - vp.x) / vp.scale),
    y: Math.round((y - vp.y) / vp.scale),
  }
}

window.__SP_EVENT__ = (json) => {
  try {
    const ev = typeof json === 'string' ? JSON.parse(json) : json
    // Normalise coords for every position-bearing event before dispatch.
    if (ev) {
      if (typeof ev.x === 'number' && typeof ev.y === 'number') {
        const l = toLocal({ x: ev.x, y: ev.y })
        ev.x = l.x; ev.y = l.y
      }
      if (typeof ev.fromX === 'number' && typeof ev.fromY === 'number') {
        const l = toLocal({ x: ev.fromX, y: ev.fromY })
        ev.fromX = l.x; ev.fromY = l.y
      }
      if (typeof ev.toX === 'number' && typeof ev.toY === 'number') {
        const l = toLocal({ x: ev.toX, y: ev.toY })
        ev.toX = l.x; ev.toY = l.y
      }
    }
    handle(ev)
  } catch (e) {
    console.warn('__SP_EVENT__ bad payload:', e, json)
  }
}

// Convenience for hand-testing in dev console.
window.__sp_test = () => {
  handle({ kind: 'click', x: 400, y: 300, text: 'TEST click' })
  setTimeout(() => handle({ kind: 'type', text: 'hello world' }), 400)
  setTimeout(() => handle({ kind: 'hotkey', text: 'ctrl+s' }), 900)
}

// ─── Initial label fetch ────────────────────────────────────────
async function hydrateLabel() {
  const tauri = window.__TAURI__
  if (!tauri?.core?.invoke) return
  try {
    const t = await tauri.core.invoke('label_text')
    if (t) elLabel.textContent = t
  } catch (e) {
    console.warn('label_text failed:', e)
  }
}

// ─── Event handler ──────────────────────────────────────────────
function handle(ev) {
  if (!ev || typeof ev !== 'object') return
  switch (ev.kind) {
    case 'cursor':       moveCursor(ev); break
    case 'click':        clickAt(ev, 'left');   break
    case 'right-click':  clickAt(ev, 'right');  break
    case 'double-click': clickAt(ev, 'double'); break
    case 'drag':         dragPath(ev); break
    case 'type':         typingFeed(ev); break
    case 'hotkey':       hotkeyFeed(ev); break
    case 'snap':         snapFeed(ev);   break
    case 'scroll':       scrollFeed(ev); break
    case 'label':        if (ev.text) elLabel.textContent = ev.text; break
    case 'error':        addCard('error', ev.text || 'error', ev.detail || ''); break
    default:             addCard('custom', ev.text || ev.kind, ev.detail || '')
  }
}

// ─── Cursor animations ──────────────────────────────────────────
function moveCursor({ x, y, mode = 'idle' }) {
  if (typeof x !== 'number' || typeof y !== 'number') return
  showCursor()
  elCursor.style.left = `${x}px`
  elCursor.style.top  = `${y}px`
  elCursor.dataset.mode = mode
}

function clickAt(ev, flavour) {
  if (typeof ev.x === 'number' && typeof ev.y === 'number') {
    moveCursor({ x: ev.x, y: ev.y, mode: 'idle' })
    spawnRipple(ev.x, ev.y, flavour)
  }
  const label = flavour === 'right'  ? '右键' :
                flavour === 'double' ? '双击' : '点击'
  addCard('click', label, formatCoord(ev))
}

function spawnRipple(x, y, flavour) {
  const r = document.createElement('div')
  r.className = `ripple ripple--${flavour}`
  r.style.left = `${x}px`
  r.style.top  = `${y}px`
  document.body.appendChild(r)
  setTimeout(() => r.remove(), 700)
}

// Hide the virtual cursor by default; it appears only after the first
// `cursor`/`click`/`drag` event arrives. This avoids "two cursors at screen
// centre" on multi-monitor startups, where every overlay window would
// otherwise paint its own idle cursor.
elCursor.style.opacity = '0'
const showCursor = () => { elCursor.style.opacity = '1' }

function dragPath({ fromX, fromY, toX, toY, text }) {
  if ([fromX, fromY, toX, toY].some(v => typeof v !== 'number')) return
  moveCursor({ x: fromX, y: fromY, mode: 'drag' })
  // After a beat, animate the cursor to the destination.
  setTimeout(() => moveCursor({ x: toX, y: toY, mode: 'drag' }), 220)
  // Sprinkle trail dots along the line.
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const px = fromX + (toX - fromX) * t
    const py = fromY + (toY - fromY) * t
    setTimeout(() => {
      const dot = document.createElement('div')
      dot.className = 'trail-dot'
      dot.style.left = `${px}px`
      dot.style.top  = `${py}px`
      document.body.appendChild(dot)
      setTimeout(() => dot.remove(), 1000)
    }, i * 24)
  }
  // Reset cursor mode after the drag visualisation finishes.
  setTimeout(() => { elCursor.dataset.mode = 'idle' }, 480)
  addCard('drag', '拖拽', `(${fromX|0},${fromY|0}) → (${toX|0},${toY|0}) ${text || ''}`)
}

function typingFeed({ text }) {
  const preview = (text || '').length > 60 ? text.slice(0, 57) + '…' : (text || '')
  elCursor.dataset.mode = 'type'
  setTimeout(() => { elCursor.dataset.mode = 'idle' }, 600)
  addCard('type', '输入', `"${preview}"`)
}

function hotkeyFeed({ text }) {
  addCard('hotkey', '快捷键', text || '')
}

function snapFeed({ text }) {
  addCard('snap', '截图', text || '')
}

function scrollFeed({ x, y, text }) {
  if (typeof x === 'number' && typeof y === 'number') moveCursor({ x, y, mode: 'idle' })
  addCard('scroll', '滚动', text || '')
}

function formatCoord(ev) {
  if (typeof ev.x === 'number' && typeof ev.y === 'number') return `(${ev.x|0}, ${ev.y|0})`
  return ''
}

// ─── Event feed cards ───────────────────────────────────────────
function addCard(kind, title, detail) {
  const card = document.createElement('div')
  card.className = 'feed__card'
  card.dataset.kind = kind
  card.innerHTML = `
    <span class="feed__icon">${iconFor(kind)}</span>
    <span class="feed__title">${escapeHtml(title)}</span>
    ${detail ? `<span class="feed__detail">${escapeHtml(detail)}</span>` : ''}
  `
  elFeed.appendChild(card)
  setTimeout(() => card.remove(), FEED_TTL)
  while (elFeed.children.length > MAX_CARDS) {
    elFeed.firstElementChild.remove()
  }
}

function iconFor(kind) {
  return {
    click: '·',
    drag: '↗',
    type: 'T',
    hotkey: '⌘',
    snap: '◉',
    scroll: '↕',
    error: '!',
    custom: '?',
  }[kind] || '·'
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ─── Esc → smooth fade-out then abort ───────────────────────────
let escFiring = false

function fadeOutAndAbort() {
  if (escFiring) return
  escFiring = true
  // Visualise immediately so the user gets feedback.
  addCard('error', '收回控制中…', '正在关闭 overlay')
  document.body.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`
  document.body.style.opacity = '0'
  // After the fade completes, ask Rust to exit. Rust will print
  // {"kind":"aborted","by":"user"} on stdout for the parent to read.
  setTimeout(() => {
    const tauri = window.__TAURI__
    if (tauri?.core?.invoke) {
      tauri.core.invoke('user_abort').catch(() => {})
    }
  }, FADE_OUT_MS)
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    fadeOutAndAbort()
  }
})

// ─── Boot ──────────────────────────────────────────────────────
hydrateLabel()

// Keep a 1-second heartbeat so WebView2 keeps composing frames even when
// nothing else is happening.
setInterval(() => { /* tick */ }, 1000)
