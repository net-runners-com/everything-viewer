// Upload reassembly (the editor frame sends base64 chunks: requests are capped at 64 KiB) and
// cache pruning.
import { randomUUID } from 'node:crypto'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const IDLE_MS = 10 * 60_000
type Pending = { size: number; buf: Buffer; chunks: Map<number, number>; touched: number }

/** Upload buffers keyed by id (not hash), so one file open in two tabs never mixes chunks. */
export class Uploads {
  private pending = new Map<string, Pending>()
  constructor(private now: () => number = Date.now) {}

  get size(): number {
    return this.pending.size
  }

  begin(size: number): string {
    if (!Number.isInteger(size) || size < 0) throw new Error(`bad size ${size}`)
    // A tab closed mid-upload never finishes: drop what nobody touched for a while.
    for (const [id, p] of this.pending) if (this.now() - p.touched > IDLE_MS) this.pending.delete(id)
    const id = randomUUID()
    this.pending.set(id, { size, buf: Buffer.alloc(size), chunks: new Map(), touched: this.now() })
    return id
  }

  put(id: string, offset: number, b64: string): void {
    const p = this.pending.get(id)
    if (!p) throw new Error(`unknown upload ${id}`)
    const bytes = Buffer.from(b64, 'base64')
    if (!Number.isInteger(offset) || offset < 0 || offset + bytes.length > p.size) {
      throw new Error(`chunk ${offset}+${bytes.length} outside ${p.size}`)
    }
    bytes.copy(p.buf, offset)
    p.chunks.set(offset, bytes.length)
    p.touched = this.now()
  }

  finish(id: string): Buffer {
    const p = this.pending.get(id)
    if (!p) throw new Error(`unknown upload ${id}`)
    this.pending.delete(id)
    let got = 0
    for (const len of p.chunks.values()) got += len
    if (got !== p.size) throw new Error(`upload incomplete: ${got}/${p.size} bytes`)
    return p.buf
  }
}

const OUTPUT_RE = /^[0-9a-f]{64}\.(pdf|glb|png|mp4)$/

/** Deletes cached outputs older than maxAgeMs, then the least recently used past maxBytes. */
export function pruneCache(dir: string, opts: { maxBytes: number; maxAgeMs: number; now?: number }): string[] {
  const now = opts.now ?? Date.now()
  let files: { name: string; size: number; mtime: number }[]
  try {
    files = readdirSync(dir)
      .filter((n) => OUTPUT_RE.test(n))
      .map((name) => {
        const s = statSync(join(dir, name))
        return { name, size: s.size, mtime: s.mtimeMs }
      })
  } catch {
    return []
  }
  const removed: string[] = []
  const drop = (name: string) => {
    rmSync(join(dir, name), { force: true })
    removed.push(name)
  }
  const kept = files.filter((f) => (now - f.mtime > opts.maxAgeMs ? (drop(f.name), false) : true))
  kept.sort((a, b) => b.mtime - a.mtime) // newest first
  let total = 0
  for (const f of kept) {
    total += f.size
    if (total > opts.maxBytes) drop(f.name)
  }
  return removed
}
