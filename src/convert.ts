// Pure-ish pieces of the conversion pipeline: exact command lines per converter, reassembly of the
// base64 chunks the editor frame uploads (requests are capped at 64 KiB), and cache pruning.
import { randomUUID } from 'node:crypto'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type { OutKind } from './formats'

/** A private profile keeps a LibreOffice window the user has open from blocking the conversion. */
export function sofficeArgs(input: string, outDir: string, profileDir: string): string[] {
  return [`-env:UserInstallation=file://${profileDir}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, input]
}

/** A .blend opens as the scene; anything else is imported into an empty one by the script. */
export function blenderArgs(input: string, out: string, script: string): string[] {
  const open = input.toLowerCase().endsWith('.blend') ? [input] : []
  return ['-b', '--factory-startup', ...open, '--python', script, '--', input, out]
}

export const BLENDER_EXPORT_PY = `import bpy, sys
src, out = sys.argv[-2], sys.argv[-1]
ext = src.rsplit('.', 1)[-1].lower()
if ext != 'blend':
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == 'stl':
        bpy.ops.wm.stl_import(filepath=src)
    elif ext == 'obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif ext == 'fbx':
        bpy.ops.import_scene.fbx(filepath=src)
    elif ext == 'ply':
        bpy.ops.wm.ply_import(filepath=src)
    elif ext in ('usd', 'usdz', 'usdc', 'usda'):
        bpy.ops.wm.usd_import(filepath=src)
    elif ext == 'abc':
        bpy.ops.wm.alembic_import(filepath=src)
    else:
        raise SystemExit('unsupported ' + ext)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)
`

export function sipsArgs(input: string, out: string): string[] {
  return ['-s', 'format', 'png', input, '--out', out]
}

/** H.264 + AAC in a faststart MP4 plays in every Chromium; even dimensions keep libx264 happy. */
export function ffmpegArgs(input: string, out: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out
  ]
}

const KEYNOTE_SCRIPT = [
  'on run argv',
  'set wasRunning to application "Keynote" is running',
  'tell application "Keynote"',
  'set d to open (POSIX file (item 1 of argv))',
  'export d to (POSIX file (item 2 of argv)) as PDF',
  'close d saving no',
  'if not wasRunning then quit',
  'end tell',
  'end run'
]

/** Keynote exports its own files faithfully; LibreOffice renders them blank. */
export function keynoteArgs(input: string, out: string): string[] {
  return [...KEYNOTE_SCRIPT.flatMap((line) => ['-e', line]), input, out]
}

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
