// src/native/win32.js
// Direct Win32 API bindings via koffi. No native compilation needed.
// Covers: screenshot (GDI), mouse (SendInput), keyboard (Unicode SendInput),
//         cursor (SetCursorPos), DPI awareness, monitor enumeration.
//
// Design note vs. usecomputer:
//   usecomputer compiles a Zig binary per-platform and ships ~1MB exe.
//   We use koffi to call the same Win32 APIs from pure Node — no binary
//   shipping, no platform-specific install steps. Works wherever Node runs.

import koffi from 'koffi'

// ─── Library handles ─────────────────────────────────────────────
const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')
const kernel32 = koffi.load('kernel32.dll')
const shcore = (() => {
  try { return koffi.load('shcore.dll') } catch { return null }
})()

// ─── Struct definitions ──────────────────────────────────────────
const POINT = koffi.struct('POINT', { x: 'long', y: 'long' })
const RECT = koffi.struct('RECT', {
  left: 'long', top: 'long', right: 'long', bottom: 'long',
})

const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
  dx: 'long', dy: 'long',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t',
})
const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr_t',
})
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', {
  uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16',
})
const INPUT_UNION = koffi.union('INPUT_UNION', {
  mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT,
})
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION })

const BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER', {
  biSize: 'uint32',
  biWidth: 'int32', biHeight: 'int32',
  biPlanes: 'uint16', biBitCount: 'uint16',
  biCompression: 'uint32', biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32', biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32', biClrImportant: 'uint32',
})
const BITMAPINFO = koffi.struct('BITMAPINFO', {
  bmiHeader: BITMAPINFOHEADER,
  bmiColors: koffi.array('uint32', 1),
})

// ─── Function bindings ───────────────────────────────────────────
const SetCursorPos = user32.func('int __stdcall SetCursorPos(int X, int Y)')
const GetCursorPos = user32.func('int __stdcall GetCursorPos(_Out_ POINT *lpPoint)')
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)')
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int nIndex)')
const GetDesktopWindow = user32.func('void* __stdcall GetDesktopWindow()')
const GetDC = user32.func('void* __stdcall GetDC(void *hWnd)')
const ReleaseDC = user32.func('int __stdcall ReleaseDC(void *hWnd, void *hDC)')
const SetProcessDPIAware = user32.func('int __stdcall SetProcessDPIAware()')
const EnumWindows = user32.func('int __stdcall EnumWindows(void *lpEnumFunc, intptr_t lParam)')
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hWnd, _Out_ char16_t *lpString, int nMaxCount)')
const GetWindowRect = user32.func('int __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)')
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(void *hWnd)')
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()')
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hWnd)')
const SetForegroundWindowByHandle = user32.func('int __stdcall SetForegroundWindow(intptr_t hWnd)')
const ShowWindow = user32.func('int __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)')
const AttachThreadInput = user32.func('int __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)')
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()')
const GetForegroundWindowH = user32.func('intptr_t __stdcall GetForegroundWindow()')
const GetWindowThreadProcessIdH = user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32 *lpdwProcessId)')
const BringWindowToTop = user32.func('int __stdcall BringWindowToTop(intptr_t hWnd)')
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)')
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void *hWnd, _Out_ char16_t *lpClassName, int nMaxCount)')

const CreateCompatibleDC = gdi32.func('void* __stdcall CreateCompatibleDC(void *hdc)')
const CreateCompatibleBitmap = gdi32.func('void* __stdcall CreateCompatibleBitmap(void *hdc, int cx, int cy)')
const SelectObject = gdi32.func('void* __stdcall SelectObject(void *hdc, void *h)')
const BitBlt = gdi32.func('int __stdcall BitBlt(void *hdcDest, int xDest, int yDest, int cx, int cy, void *hdcSrc, int x1, int y1, uint32 rop)')
const GetDIBits = gdi32.func('int __stdcall GetDIBits(void *hdc, void *hbm, uint32 start, uint32 cLines, _Out_ void *lpvBits, BITMAPINFO *lpbmi, uint32 usage)')
const DeleteDC = gdi32.func('int __stdcall DeleteDC(void *hdc)')
const DeleteObject = gdi32.func('int __stdcall DeleteObject(void *ho)')

let _dpiAwareCalled = false
function ensureDpiAware() {
  if (_dpiAwareCalled) return
  _dpiAwareCalled = true
  if (shcore) {
    try {
      // 2 = PROCESS_PER_MONITOR_DPI_AWARE
      const setDpi = shcore.func('int __stdcall SetProcessDpiAwareness(int value)')
      setDpi(2)
      return
    } catch { /* fall through */ }
  }
  SetProcessDPIAware()
}

// ─── Constants ───────────────────────────────────────────────────
const SM_XVIRTUALSCREEN = 76
const SM_YVIRTUALSCREEN = 77
const SM_CXVIRTUALSCREEN = 78
const SM_CYVIRTUALSCREEN = 79
const SM_CXSCREEN = 0
const SM_CYSCREEN = 1

const SRCCOPY = 0x00CC0020
const CAPTUREBLT = 0x40000000
const DIB_RGB_COLORS = 0
const BI_RGB = 0

const INPUT_MOUSE = 0
const INPUT_KEYBOARD = 1

const MOUSEEVENTF_MOVE = 0x0001
const MOUSEEVENTF_LEFTDOWN = 0x0002
const MOUSEEVENTF_LEFTUP = 0x0004
const MOUSEEVENTF_RIGHTDOWN = 0x0008
const MOUSEEVENTF_RIGHTUP = 0x0010
const MOUSEEVENTF_MIDDLEDOWN = 0x0020
const MOUSEEVENTF_MIDDLEUP = 0x0040
const MOUSEEVENTF_WHEEL = 0x0800
const MOUSEEVENTF_HWHEEL = 0x1000
const MOUSEEVENTF_ABSOLUTE = 0x8000

const KEYEVENTF_KEYUP = 0x0002
const KEYEVENTF_UNICODE = 0x0004
const KEYEVENTF_EXTENDEDKEY = 0x0001

const WHEEL_DELTA = 120

// ─── Helpers ─────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function readU16String(buf, len) {
  let s = ''
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(i * 2)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

// ─── Public: cursor / mouse ──────────────────────────────────────
export function moveCursor(x, y) {
  ensureDpiAware()
  SetCursorPos(Math.round(x), Math.round(y))
}

export function getCursorPosition() {
  ensureDpiAware()
  const p = { x: 0, y: 0 }
  GetCursorPos(p)
  return p
}

function makeMouseInput(flags, dx = 0, dy = 0, data = 0) {
  return {
    type: INPUT_MOUSE,
    u: { mi: { dx, dy, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
  }
}

const BUTTON_FLAGS = {
  left:   { down: MOUSEEVENTF_LEFTDOWN,   up: MOUSEEVENTF_LEFTUP },
  right:  { down: MOUSEEVENTF_RIGHTDOWN,  up: MOUSEEVENTF_RIGHTUP },
  middle: { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP },
}

export async function click({ x, y, button = 'left', count = 1, modifiers = [] } = {}) {
  ensureDpiAware()
  if (typeof x === 'number' && typeof y === 'number') moveCursor(x, y)
  const flags = BUTTON_FLAGS[button] || BUTTON_FLAGS.left

  pressModifiers(modifiers, true)
  try {
    for (let i = 0; i < count; i++) {
      const inputs = [
        makeMouseInput(flags.down),
        makeMouseInput(flags.up),
      ]
      sendInputs(inputs)
      if (i + 1 < count) await sleep(60)
    }
  } finally {
    pressModifiers(modifiers, false)
  }
}

export function mouseDown(button = 'left') {
  const flags = BUTTON_FLAGS[button] || BUTTON_FLAGS.left
  sendInputs([makeMouseInput(flags.down)])
}
export function mouseUp(button = 'left') {
  const flags = BUTTON_FLAGS[button] || BUTTON_FLAGS.left
  sendInputs([makeMouseInput(flags.up)])
}

export async function scroll({ direction = 'down', amount = 3, x, y } = {}) {
  ensureDpiAware()
  if (typeof x === 'number' && typeof y === 'number') moveCursor(x, y)
  const horizontal = direction === 'left' || direction === 'right'
  const sign = (direction === 'up' || direction === 'right') ? 1 : -1
  const flag = horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL
  for (let i = 0; i < amount; i++) {
    sendInputs([makeMouseInput(flag, 0, 0, sign * WHEEL_DELTA)])
    await sleep(15)
  }
}

export async function drag({ from, to, control, button = 'left', steps = 24 } = {}) {
  ensureDpiAware()
  moveCursor(from.x, from.y)
  await sleep(20)
  mouseDown(button)
  try {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      let px, py
      if (control) {
        const mt = 1 - t
        px = mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x
        py = mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y
      } else {
        px = from.x + (to.x - from.x) * t
        py = from.y + (to.y - from.y) * t
      }
      moveCursor(px, py)
      await sleep(8)
    }
  } finally {
    mouseUp(button)
  }
}

// ─── Public: keyboard ────────────────────────────────────────────

// Type ANY unicode text — including Chinese / emoji — without depending on
// the active IME. We inject UTF-16 code units via KEYEVENTF_UNICODE.
export async function typeText(text, { delayMs = 0 } = {}) {
  for (const ch of text) {
    const code = ch.codePointAt(0)
    const units = []
    if (code <= 0xFFFF) {
      units.push(code)
    } else {
      const c = code - 0x10000
      units.push(0xD800 + (c >> 10))
      units.push(0xDC00 + (c & 0x3FF))
    }
    for (const u of units) {
      sendInputs([
        makeKeyInput(0, u, KEYEVENTF_UNICODE),
        makeKeyInput(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
      ])
    }
    if (delayMs > 0) await sleep(delayMs)
  }
}

function makeKeyInput(vk, scan, flags) {
  return {
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
  }
}

// Symbolic name → Virtual-Key code
const VK_MAP = {
  enter: 0x0D, return: 0x0D, tab: 0x09, space: 0x20, esc: 0x1B, escape: 0x1B,
  backspace: 0x08, delete: 0x2E, insert: 0x2D,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
  shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, win: 0x5B, cmd: 0x5B, meta: 0x5B,
  capslock: 0x14,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75,
  f7: 0x76, f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
}

function vkFor(token) {
  const t = token.toLowerCase()
  if (VK_MAP[t] !== undefined) return VK_MAP[t]
  if (t.length === 1) {
    const c = t.charCodeAt(0)
    if (c >= 97 && c <= 122) return c - 32 // a..z -> 0x41..0x5A
    if (c >= 48 && c <= 57) return c       // 0..9
  }
  throw new Error(`Unknown key: ${token}`)
}

const MODIFIER_NAMES = new Set(['shift', 'ctrl', 'control', 'alt', 'win', 'cmd', 'meta'])

function pressModifiers(mods, down) {
  if (!mods || mods.length === 0) return
  const order = down ? mods : [...mods].reverse()
  for (const m of order) {
    const vk = vkFor(m)
    sendInputs([makeKeyInput(vk, 0, down ? 0 : KEYEVENTF_KEYUP)])
  }
}

// Press a chord like "ctrl+shift+s" or just "enter"
export async function pressKey(combo, { count = 1, delayMs = 40 } = {}) {
  const tokens = combo.split('+').map(s => s.trim()).filter(Boolean)
  const mods = []
  let mainKey = null
  for (const t of tokens) {
    if (MODIFIER_NAMES.has(t.toLowerCase())) mods.push(t)
    else mainKey = t
  }
  if (!mainKey) throw new Error(`No primary key in combo "${combo}"`)
  const vk = vkFor(mainKey)

  for (let i = 0; i < count; i++) {
    pressModifiers(mods, true)
    sendInputs([
      makeKeyInput(vk, 0, 0),
      makeKeyInput(vk, 0, KEYEVENTF_KEYUP),
    ])
    pressModifiers(mods, false)
    if (i + 1 < count) await sleep(delayMs)
  }
}

// ─── SendInput batch helper ──────────────────────────────────────
function sendInputs(inputs) {
  const arr = koffi.alloc(INPUT, inputs.length)
  for (let i = 0; i < inputs.length; i++) {
    koffi.encode(arr, i * koffi.sizeof(INPUT), INPUT, inputs[i])
  }
  const n = SendInput(inputs.length, arr, koffi.sizeof(INPUT))
  if (n === 0) throw new Error('SendInput failed — desktop may be locked')
}

// ─── Public: screen / display ────────────────────────────────────
export function getVirtualScreen() {
  ensureDpiAware()
  return {
    x: GetSystemMetrics(SM_XVIRTUALSCREEN),
    y: GetSystemMetrics(SM_YVIRTUALSCREEN),
    width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
    height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
  }
}

export function getPrimaryScreen() {
  ensureDpiAware()
  return {
    x: 0, y: 0,
    width: GetSystemMetrics(SM_CXSCREEN),
    height: GetSystemMetrics(SM_CYSCREEN),
  }
}

// Capture a desktop rectangle and return raw BGRA buffer (no PNG encoding here).
// Caller is responsible for downstream encoding via sharp.
export function captureRect({ x, y, width, height }) {
  ensureDpiAware()
  if (width <= 0 || height <= 0) throw new Error('captureRect: bad size')

  const desk = GetDesktopWindow()
  const screenDC = GetDC(desk)
  if (!screenDC) throw new Error('GetDC(desktop) failed')
  try {
    const memDC = CreateCompatibleDC(screenDC)
    if (!memDC) throw new Error('CreateCompatibleDC failed')
    try {
      const bitmap = CreateCompatibleBitmap(screenDC, width, height)
      if (!bitmap) throw new Error('CreateCompatibleBitmap failed')
      try {
        const prev = SelectObject(memDC, bitmap)
        try {
          const ok = BitBlt(memDC, 0, 0, width, height, screenDC, x, y, SRCCOPY | CAPTUREBLT)
          if (!ok) throw new Error('BitBlt failed')

          const bmi = {
            bmiHeader: {
              biSize: koffi.sizeof(BITMAPINFOHEADER),
              biWidth: width,
              biHeight: -height, // top-down
              biPlanes: 1,
              biBitCount: 32,
              biCompression: BI_RGB,
              biSizeImage: 0,
              biXPelsPerMeter: 0, biYPelsPerMeter: 0,
              biClrUsed: 0, biClrImportant: 0,
            },
            bmiColors: [0],
          }
          const pixelBytes = width * height * 4
          const pixels = Buffer.alloc(pixelBytes)
          const n = GetDIBits(memDC, bitmap, 0, height, pixels, bmi, DIB_RGB_COLORS)
          if (!n) throw new Error('GetDIBits failed')

          return { width, height, channels: 4, data: pixels } // BGRA8
        } finally {
          SelectObject(memDC, prev)
        }
      } finally {
        DeleteObject(bitmap)
      }
    } finally {
      DeleteDC(memDC)
    }
  } finally {
    ReleaseDC(desk, screenDC)
  }
}

// ─── Public: windows ─────────────────────────────────────────────

// Define the callback signature once at module load — koffi.proto refuses
// to register the same type name twice.
const ENUM_WND_PROC = koffi.proto('int __stdcall EnumWndProc(void *hWnd, intptr_t lParam)')

export function listWindows({ visibleOnly = true } = {}) {
  ensureDpiAware()
  const results = []
  const cb = koffi.register(
    (hWnd) => {
      if (visibleOnly && !IsWindowVisible(hWnd)) return 1
      const titleBuf = Buffer.alloc(512)
      const titleLen = GetWindowTextW(hWnd, titleBuf, 256)
      const classBuf = Buffer.alloc(512)
      const classLen = GetClassNameW(hWnd, classBuf, 256)
      const rect = { left: 0, top: 0, right: 0, bottom: 0 }
      GetWindowRect(hWnd, rect)
      const pidBuf = [0]
      GetWindowThreadProcessId(hWnd, pidBuf)
      const title = readU16String(titleBuf, titleLen)
      const className = readU16String(classBuf, classLen)
      const w = rect.right - rect.left
      const h = rect.bottom - rect.top
      if (visibleOnly && (!title || w < 10 || h < 10)) return 1
      results.push({
        handle: Number(koffi.address(hWnd) ?? 0),
        title, className,
        pid: pidBuf[0],
        x: rect.left, y: rect.top, width: w, height: h,
      })
      return 1
    },
    koffi.pointer(ENUM_WND_PROC),
  )
  try {
    EnumWindows(cb, 0)
  } finally {
    koffi.unregister(cb)
  }
  return results
}

export function getForegroundWindowInfo() {
  ensureDpiAware()
  const h = GetForegroundWindow()
  if (!h) return null
  const titleBuf = Buffer.alloc(512)
  const titleLen = GetWindowTextW(h, titleBuf, 256)
  const rect = { left: 0, top: 0, right: 0, bottom: 0 }
  GetWindowRect(h, rect)
  return {
    handle: Number(koffi.address(h) ?? 0),
    title: readU16String(titleBuf, titleLen),
    x: rect.left, y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  }
}

export function focusWindow(handle) {
  ensureDpiAware()
  // SW_RESTORE — bring it back if minimised to taskbar/tray.
  ShowWindow(handle, 9)

  // The robust focus-stealing workaround used by AutoHotkey and others:
  // attach our input thread to the current foreground window's thread,
  // then SetForegroundWindow succeeds because Windows now thinks we're
  // the "owner" of the foreground input queue. Detach right after.
  // See: https://docs.microsoft.com/.../setforegroundwindow Remarks.
  const fg = GetForegroundWindowH()
  const ourTid = GetCurrentThreadId()
  let attached = false
  let theirTid = 0
  if (fg && fg !== 0n) {
    const pidBuf = [0]
    theirTid = GetWindowThreadProcessIdH(fg, pidBuf)
    if (theirTid && theirTid !== ourTid) {
      attached = AttachThreadInput(ourTid, theirTid, 1) !== 0
    }
  }
  // Also do the Alt-tap trick — defence in depth on locked-down systems.
  try {
    sendInputs([
      makeKeyInput(0x12 /* VK_MENU */, 0, 0),
      makeKeyInput(0x12, 0, KEYEVENTF_KEYUP),
    ])
  } catch { /* benign */ }

  BringWindowToTop(handle)
  const ok = SetForegroundWindowByHandle(handle) !== 0

  if (attached) AttachThreadInput(ourTid, theirTid, 0)
  return ok
}

export const constants = {
  WHEEL_DELTA,
}
