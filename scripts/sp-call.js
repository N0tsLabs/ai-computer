// scripts/sp-call.js
// CLI wrapper to send one command to the running sp-shell and print the reply.
// Usage:
//   node scripts/sp-call.js '<json-cmd-without-id>'
// Example:
//   node scripts/sp-call.js '{"op":"snap","args":{"handle":8915056,"path":"./demos/t.png"}}'

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const CMD_FILE  = path.join(root, '.sp-cmd.jsonl')
const RESP_FILE = path.join(root, '.sp-resp.jsonl')

const raw = process.argv[2]
if (!raw) { console.error('usage: node sp-call.js \'<json>\''); process.exit(2) }
const cmd = JSON.parse(raw)
// Assign a monotonic id from current time microsecond.
const id = process.hrtime.bigint().toString().slice(-9)
cmd.id = id

const beforeSize = fs.existsSync(RESP_FILE) ? fs.statSync(RESP_FILE).size : 0
fs.appendFileSync(CMD_FILE, JSON.stringify(cmd) + '\n')

const deadline = Date.now() + 15000
let lastSize = beforeSize
;(async function waitForReply() {
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 60))
    const stat = fs.statSync(RESP_FILE)
    if (stat.size <= lastSize) continue
    const fd = fs.openSync(RESP_FILE, 'r')
    const buf = Buffer.alloc(stat.size - lastSize)
    fs.readSync(fd, buf, 0, buf.length, lastSize)
    fs.closeSync(fd)
    lastSize = stat.size
    for (const line of buf.toString('utf8').split('\n').filter(Boolean)) {
      let parsed
      try { parsed = JSON.parse(line) } catch { continue }
      if (parsed.id === id) {
        console.log(JSON.stringify(parsed))
        process.exit(parsed.ok ? 0 : 1)
      }
    }
  }
  console.error('timeout waiting for reply to id=' + id)
  process.exit(3)
})()
