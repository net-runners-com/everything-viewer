// The plugin's worker: receives uploaded file bytes, converts them with LibreOffice or Blender
// into a content-hash cache, and serves the result back in chunks.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { BLENDER_EXPORT_PY, Uploads, blenderArgs, outKindFor, sofficeArgs, type OutKind } from './convert'
import { DOWNLOAD_CHUNK, type FinishResult, type ToolError } from './protocol'

export type ExecFn = (cmd: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<{ stdout: string }>
export type Tools = { soffice: () => string | null; blender: () => string | null }
export type WorkerDeps = { exec: ExecFn; cacheDir: string; tools: Tools }

const HASH_RE = /^[0-9a-f]{64}$/
const INSTALL_HINT = {
  pdf: 'LibreOffice が見つかりません。`brew install --cask libreoffice` で入れてください。',
  glb: 'Blender が見つかりません。/Applications に Blender を入れてください。'
}

class BadRequest extends Error {}

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
    if (kind !== 'pdf' && kind !== 'glb') throw new BadRequest('bad kind')
    return join(cacheDir, `${hash}.${kind}`)
  }

  return function activate(orca: OrcaWorkerApi): void {
    const uploads = new Uploads()
    // One conversion at a time: LibreOffice and Blender are heavy and soffice dislikes concurrency.
    let queue: Promise<unknown> = Promise.resolve()
    const serial = <T>(job: () => Promise<T>): Promise<T> => {
      const run = queue.then(job, job)
      queue = run.catch(() => undefined)
      return run
    }

    async function convert(input: Buffer, hash: string, ext: string, signal?: AbortSignal): Promise<FinishResult> {
      const kind = outKindFor(ext)
      if (!kind) throw new BadRequest(`.${ext} is not a format this viewer converts`)
      const target = outPath(hash, kind)
      if (existsSync(target)) return { ready: true, size: statSync(target).size }
      const tool = kind === 'pdf' ? tools.soffice() : tools.blender()
      if (!tool) return { error: { kind: 'not_found', message: INSTALL_HINT[kind] } }

      const job = join(tmpRoot, `${hash}-${Date.now()}`)
      mkdirSync(job, { recursive: true })
      try {
        const src = join(job, `in.${ext.toLowerCase()}`)
        writeFileSync(src, input)
        const produced = join(job, `in.${kind}`)
        if (kind === 'pdf') {
          await exec(tool, sofficeArgs(src, job, join(cacheDir, 'lo-profile')), { timeoutMs: 110_000, signal })
        } else {
          const script = join(job, 'export.py')
          writeFileSync(script, BLENDER_EXPORT_PY)
          await exec(tool, blenderArgs(src, produced, script), { timeoutMs: 110_000, signal })
        }
        if (!existsSync(produced) || statSync(produced).size === 0) {
          return { error: { kind: 'failed', message: `変換結果が作られませんでした (.${ext})` } }
        }
        renameSync(produced, target)
        return { ready: true, size: statSync(target).size }
      } finally {
        rmSync(job, { recursive: true, force: true })
      }
    }

    orca.panels.handle('convert.lookup', async ({ hash, kind }) => {
      const p = outPath(hash, kind)
      return existsSync(p) ? { ready: true, size: statSync(p).size } : { ready: false }
    })

    orca.panels.handle('upload.begin', async ({ size }) => ({ id: uploads.begin(size) }))

    orca.panels.handle('upload.chunk', async ({ id, offset, b64 }) => {
      uploads.put(id, offset, b64)
      return { ok: true }
    })

    orca.panels.handle('upload.finish', async ({ id, hash, ext }, ctx) => {
      try {
        const input = uploads.finish(id)
        if (createHash('sha256').update(input).digest('hex') !== hash) throw new BadRequest('upload does not match its hash')
        return await serial(() => convert(input, hash, ext, ctx.signal))
      } catch (error) {
        return { error: toToolError(error) }
      }
    })

    orca.panels.handle('convert.read', async ({ hash, kind, offset }) => {
      const p = outPath(hash, kind)
      const size = statSync(p).size
      const start = Math.max(0, Math.min(offset, size))
      const len = Math.min(DOWNLOAD_CHUNK, size - start)
      const buf = Buffer.alloc(len)
      const fd = openSync(p, 'r')
      try {
        readSync(fd, buf, 0, len, start)
      } finally {
        closeSync(fd)
      }
      return { b64: buf.toString('base64'), eof: start + len >= size }
    })
  }
}

import { macTools, runTool } from './exec'
export default createWorker({
  exec: runTool,
  cacheDir: join(homedir(), 'Library', 'Caches', 'orca-convert-viewer'),
  tools: macTools
})
