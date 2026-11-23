// The plugin's worker: receives uploaded file bytes, converts them in background jobs with the Mac's
// own tools (LibreOffice, Keynote, Blender, sips, ffmpeg) into a content-hash cache, and serves the
// result back in chunks.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { BLENDER_EXPORT_PY, Uploads, blenderArgs, ffmpegArgs, keynoteArgs, pruneCache, sipsArgs, sofficeArgs } from './convert'
import { canConvert, type OutKind } from './formats'
import { DOWNLOAD_CHUNK, type JobState, type ToolError } from './protocol'

export type ExecFn = (cmd: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<{ stdout: string }>
type Find = () => string | null
export type Tools = { soffice: Find; blender: Find; ffmpeg: Find; sips: Find; keynote: Find }
export type WorkerDeps = { exec: ExecFn; cacheDir: string; tools: Tools }

const HASH_RE = /^[0-9a-f]{64}$/
const KINDS: OutKind[] = ['pdf', 'glb', 'png', 'mp4']
const CACHE_LIMITS = { maxBytes: 2 * 1024 ** 3, maxAgeMs: 30 * 86_400_000 }
const MIN = 60_000

const MISSING: Record<string, string> = {
  soffice: 'LibreOffice が見つかりません。`brew install --cask libreoffice` で入れてください。',
  blender: 'Blender が見つかりません。/Applications に Blender を入れてください。',
  ffmpeg: 'ffmpeg が見つかりません。`brew install ffmpeg` で入れてください。',
  sips: 'sips が見つかりません（macOS 標準のツールです）。'
}

class BadRequest extends Error {}
class Missing extends Error {
  toolError: ToolError
  constructor(tool: keyof typeof MISSING) {
    super(MISSING[tool])
    this.toolError = { kind: 'not_found', message: MISSING[tool] }
  }
}

function toToolError(error: unknown): ToolError {
  const t = (error as { toolError?: ToolError })?.toolError
  if (t) return t
  if (error instanceof BadRequest) return { kind: 'bad_request', message: error.message }
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
}

export function createWorker(deps: WorkerDeps) {
  const { exec, cacheDir, tools } = deps
  const tmpRoot = join(cacheDir, 'tmp')
  const outPath = (hash: string, kind: OutKind) => {
    if (!HASH_RE.test(hash)) throw new BadRequest('bad hash')
    if (!KINDS.includes(kind)) throw new BadRequest('bad kind')
    return join(cacheDir, `${hash}.${kind}`)
  }
  const need = (tool: keyof typeof MISSING): string => {
    const path = tools[tool as keyof Tools]()
    if (!path) throw new Missing(tool)
    return path
  }

  /** Runs the right tool; resolves with the file it produced inside `job`. */
  async function run(src: string, ext: string, kind: OutKind, job: string): Promise<string> {
    const produced = join(job, `out.${kind}`)
    if (kind === 'pdf') {
      if (ext === 'key' && tools.keynote()) {
        try {
          await exec(tools.keynote()!, keynoteArgs(src, produced), { timeoutMs: 2 * MIN })
          if (existsSync(produced)) return produced
        } catch {
          // No Automation permission or Keynote failed: LibreOffice is the fallback.
        }
      }
      await exec(need('soffice'), sofficeArgs(src, job, join(cacheDir, 'lo-profile')), { timeoutMs: 2 * MIN })
      return join(job, 'in.pdf')
    }
    if (kind === 'glb') {
      const script = join(job, 'export.py')
      writeFileSync(script, BLENDER_EXPORT_PY)
      await exec(need('blender'), blenderArgs(src, produced, script), { timeoutMs: 5 * MIN })
      return produced
    }
    if (kind === 'png') {
      await exec(need('sips'), sipsArgs(src, produced), { timeoutMs: MIN })
      return produced
    }
    await exec(need('ffmpeg'), ffmpegArgs(src, produced), { timeoutMs: 30 * MIN })
    return produced
  }

  return function activate(orca: OrcaWorkerApi): void {
    mkdirSync(cacheDir, { recursive: true })
    rmSync(tmpRoot, { recursive: true, force: true }) // leftovers of a worker that was killed mid-job
    pruneCache(cacheDir, CACHE_LIMITS)

    const uploads = new Uploads()
    const jobs = new Map<string, JobState>()
    // One conversion at a time: these tools are heavy and soffice dislikes concurrency.
    let queue: Promise<unknown> = Promise.resolve()

    const state = (hash: string, kind: OutKind): JobState => {
      const p = outPath(hash, kind)
      if (existsSync(p)) return { state: 'ready', size: statSync(p).size }
      return jobs.get(`${hash}.${kind}`) ?? { state: 'missing' }
    }

    function start(input: Buffer, hash: string, ext: string, kind: OutKind): void {
      const key = `${hash}.${kind}`
      jobs.set(key, { state: 'running' })
      const job = join(tmpRoot, `${hash}-${kind}-${Date.now()}`)
      const work = async () => {
        mkdirSync(job, { recursive: true })
        try {
          const src = join(job, `in.${ext}`)
          writeFileSync(src, input)
          const produced = await run(src, ext, kind, job)
          if (!existsSync(produced) || statSync(produced).size === 0) {
            throw Object.assign(new Error(), { toolError: { kind: 'failed', message: `変換結果が作られませんでした (.${ext})` } })
          }
          renameSync(produced, outPath(hash, kind))
          jobs.delete(key)
          pruneCache(cacheDir, CACHE_LIMITS)
        } catch (error) {
          jobs.set(key, { state: 'error', error: toToolError(error) })
        } finally {
          rmSync(job, { recursive: true, force: true })
        }
      }
      queue = queue.then(work, work)
    }

    orca.panels.handle('convert.lookup', async ({ hash, kind }) => state(hash, kind))

    orca.panels.handle('upload.begin', async ({ size }) => ({ id: uploads.begin(size) }))

    orca.panels.handle('upload.chunk', async ({ id, offset, b64 }) => {
      uploads.put(id, offset, b64)
      return { ok: true }
    })

    orca.panels.handle('upload.finish', async ({ id, hash, ext, kind }) => {
      try {
        const e = String(ext).toLowerCase()
        if (!canConvert(e, kind)) throw new BadRequest(`.${e} is not converted to ${kind}`)
        const input = uploads.finish(id)
        if (createHash('sha256').update(input).digest('hex') !== hash) throw new BadRequest('upload does not match its hash')
        const now = state(hash, kind)
        if (now.state === 'ready' || now.state === 'running') return now
        start(input, hash, e, kind)
        return { state: 'running' }
      } catch (error) {
        return { state: 'error', error: toToolError(error) }
      }
    })

    orca.panels.handle('convert.read', async ({ hash, kind, offset }) => {
      const p = outPath(hash, kind)
      const size = statSync(p).size
      const begin = Math.max(0, Math.min(offset, size))
      if (begin === 0) {
        const now = new Date()
        utimesSync(p, now, now) // pruning drops the least recently opened first
      }
      const len = Math.min(DOWNLOAD_CHUNK, size - begin)
      const buf = Buffer.alloc(len)
      const fd = openSync(p, 'r')
      try {
        readSync(fd, buf, 0, len, begin)
      } finally {
        closeSync(fd)
      }
      return { b64: buf.toString('base64'), eof: begin + len >= size }
    })
  }
}

import { macTools, runTool } from './exec'
export default createWorker({
  exec: runTool,
  cacheDir: join(homedir(), 'Library', 'Caches', 'orca-convert-viewer'),
  tools: macTools
})
