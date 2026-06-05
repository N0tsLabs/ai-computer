// scripts/sp-shell.js
// Long-lived screenpilot session driven by a *file watcher* instead of stdin.
// Why files: Git Bash on Windows can't reliably feed a backgrounded
// process's stdin without keeping the parent shell open, and named pipes
// don't exist there. Files are the lowest-common-denominator IPC.
//
// Wire protocol:
//   Client writes one command per line to .sp-cmd.jsonl, then increments
//   a tiny sentinel file `.sp-cmd.seq` to nudge the shell to re-scan.
//   Shell appends a result line per command to .sp-resp.jsonl.
//   Client tails .sp-resp.jsonl until it sees the matching id.
//
// Commands and replies are the same JSON envelopes as before.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sp from '../src/core/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CMD_FILE  = path.join(root, '.sp-cmd.jsonl')
const RESP_FILE = path.join(root, '.sp-resp.jsonl')

// Truncate so each session starts clean.
fs.writeFileSync(CMD_FILE,  '')
fs.writeFileSync(RESP_FILE, '')

let consumedBytes = 0
let stopping = false

function appendResp(line) {
  fs.appendFileSync(RESP_FILE, line + '\n')
}

const OPS = {
  async startOverlay(args) {
    return sp.startOverlay({
      ...args,
      onEvent: (ev) => {
        appendResp(JSON.stringify({ id: 0, ok: true, event: ev }))
      },
    })
  },
  async snap(args)         { return sp.snap(args) },
  async _snapRegion(args)  { return sp._snapRegion(args) },
  async tap(args)          { return sp.tap(args) },
  async write(args)        { return sp.write(args.text, { delayMs: args.delayMs }) },
  async hotkey(args)       { return sp.hotkey(args.combo, args) },
  async wheel(args)        { return sp.wheel(args) },
  async dragPath(args)     { return sp.dragPath(args) },
  async move(args)         { return sp.move(args) },
  async focus(args)        { return sp.focus(args.handle) },
  async findWindow(args)   { return sp.findWindow(args.handle) },
  async windows(args)      { return sp.windows(args || {}) },
  async findOnScreen(args) { return sp.findOnScreen(args.text, args) },
  async overlayEvent(args) { sp.overlayEvent(args); return true },
  async sleep(args)        { return new Promise(r => setTimeout(r, args.ms || 0)) },
  async stopOverlay()      { return sp.stopOverlay() },
  async quit()             {
    stopping = true
    await sp.stopOverlay().catch(() => {})
    setTimeout(() => process.exit(0), 80)
    return true
  },
}

async function processNew() {
  let stat
  try { stat = fs.statSync(CMD_FILE) } catch { return }
  if (stat.size <= consumedBytes) return
  const fd = fs.openSync(CMD_FILE, 'r')
  const buf = Buffer.alloc(stat.size - consumedBytes)
  fs.readSync(fd, buf, 0, buf.length, consumedBytes)
  fs.closeSync(fd)
  consumedBytes = stat.size
  const text = buf.toString('utf8')
  const lines = text.split('\n').filter(Boolean)
  for (const line of lines) {
    let msg
    try { msg = JSON.parse(line) }
    catch (e) { appendResp(JSON.stringify({ id: 0, ok: false, error: 'bad-json: ' + e.message })); continue }
    const fn = OPS[msg.op]
    if (!fn) { appendResp(JSON.stringify({ id: msg.id, ok: false, error: 'unknown-op: ' + msg.op })); continue }
    try {
      const data = await fn(msg.args || {})
      appendResp(JSON.stringify({ id: msg.id, ok: true, data }))
    } catch (e) {
      appendResp(JSON.stringify({ id: msg.id, ok: false, error: e.message }))
    }
    if (stopping) return
  }
}

// Initial heartbeat so clients know we're alive.
appendResp(JSON.stringify({ id: 0, ok: true, data: 'ready', pid: process.pid }))

// Lightweight poll loop. fs.watch isn't reliable on Windows for append-only
// growing files, so we just stat every 80 ms.
setInterval(() => { if (!stopping) processNew() }, 80)

process.on('SIGINT',  () => OPS.quit())
process.on('SIGTERM', () => OPS.quit())
