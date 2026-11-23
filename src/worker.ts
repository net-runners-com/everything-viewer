// The plugin's worker: receives uploaded file bytes, runs the converters formats.json names for the
// file's suffix in background jobs, caches the output by content hash, and serves it back in chunks.
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { Uploads, pruneCache } from './convert'
import type { Converter, ExecFn } from './converters/types'
import { DOWNLOAD_CHUNK, type JobKey, type JobState, type ToolError } from './protocol'
import { createRegistry, type ConverterSpec, type OutKind, type Registry } from './registry'

export type WorkerDeps = {
  registry: Registry
  exec: ExecFn
  cacheDir: string
  /** The converter tool's path on this Mac, or null when it isn't installed. */
  locate: (converterId: string) => string | null
  /** The code of `src/converters/<id>.ts`. */
  loadConverter: (converterId: string) => Promise<Converter>
}

const HASH_RE = /^[0-9a-f]{64}$/
const CACHE_LIMITS = { maxBytes: 2 * 1024 ** 3, maxAgeMs: 30 * 86_400_000 }

class BadRequest extends Error {}
const toolError = (kind: ToolError['kind'], message: string) => Object.assign(new Error(message), { toolError: { kind, message } })

function toToolError(error: unknown): ToolError {
  const t = (error as { toolError?: ToolError })?.toolError
  if (t) return t
  if (error instanceof BadRequest) return { kind: 'bad_request', message: error.message }
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
}

export function createWorker(deps: WorkerDeps) {
  const { registry, exec, cacheDir, locate, loadConverter } = deps
  const tmpRoot = join(cacheDir, 'tmp')

  /** The stage's converters for a suffix, and the cache file their output lands in. */
  const resolve = ({ hash, ext, stage }: JobKey) => {
    if (!HASH_RE.test(hash)) throw new BadRequest('bad hash')
    if (stage !== 'convert' && stage !== 'fallback') throw new BadRequest('bad stage')
    const format = registry.formatFor(String(ext))
    const chain = format && registry.chain(format, stage)
    if (!chain) throw new BadRequest(`.${ext} has nothing to ${stage} with`)
    return { ext: String(ext).toLowerCase(), chain, out: join(cacheDir, `${hash}.${chain.output}`) }
  }

  /** Tries each converter in order; an uninstalled one is skipped, a failing one falls through. */
  async function runChain(src: string, ext: string, output: OutKind, ids: string[], dir: string): Promise<string> {
    let last: unknown = null
    for (const id of ids) {
      const tool = locate(id)
      if (!tool) continue
      const out = join(dir, `out.${output}`)
      try {
        const converter = await loadConverter(id)
        const produced = await converter.run({ src, ext, dir, out, tool, cacheDir, exec })
        if (existsSync(produced) && statSync(produced).size > 0) return produced
        last = toolError('failed', `${registry.file.converters[id].label}: 変換結果が作られませんでした (.${ext})`)
      } catch (error) {
        last = error
      }
    }
    throw last ?? toolError('not_found', registry.file.converters[ids[0]].missing)
  }

  return function activate(orca: OrcaWorkerApi): void {
    mkdirSync(cacheDir, { recursive: true })
    rmSync(tmpRoot, { recursive: true, force: true }) // leftovers of a worker killed mid-job
    pruneCache(cacheDir, CACHE_LIMITS)

    const uploads = new Uploads()
    const jobs = new Map<string, JobState>()
    // One conversion at a time: these tools are heavy and soffice dislikes concurrency.
    let queue: Promise<unknown> = Promise.resolve()

    const state = (key: JobKey): JobState => {
      const { out } = resolve(key)
      if (existsSync(out)) return { state: 'ready', size: statSync(out).size }
      return jobs.get(out) ?? { state: 'missing' }
    }

    function start(input: Buffer, key: JobKey): JobState {
      const { ext, chain, out } = resolve(key)
      const running: JobState = { state: 'running', label: chain.converters.map((id) => registry.file.converters[id].label).join(' / ') }
      jobs.set(out, running)
      const dir = join(tmpRoot, `${key.hash}-${key.stage}-${Date.now()}`)
      const work = async () => {
        mkdirSync(dir, { recursive: true })
        try {
          const src = join(dir, `in.${ext}`)
          writeFileSync(src, input)
          renameSync(await runChain(src, ext, chain.output, chain.converters, dir), out)
          jobs.delete(out)
          pruneCache(cacheDir, CACHE_LIMITS)
        } catch (error) {
          jobs.set(out, { state: 'error', error: toToolError(error) })
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      }
      queue = queue.then(work, work)
      return running
    }

    orca.panels.handle('convert.lookup', async (key) => state(key))

    orca.panels.handle('upload.begin', async ({ size }) => ({ id: uploads.begin(size) }))

    orca.panels.handle('upload.chunk', async ({ id, offset, b64 }) => {
      uploads.put(id, offset, b64)
      return { ok: true }
    })

    orca.panels.handle('upload.finish', async ({ id, ...key }) => {
      try {
        resolve(key)
        const input = uploads.finish(id)
        if (createHash('sha256').update(input).digest('hex') !== key.hash) throw new BadRequest('upload does not match its hash')
        const now = state(key)
        return now.state === 'ready' || now.state === 'running' ? now : start(input, key)
      } catch (error) {
        return { state: 'error', error: toToolError(error) }
      }
    })

    orca.panels.handle('convert.read', async ({ offset, ...key }) => {
      const { out } = resolve(key)
      const size = statSync(out).size
      const begin = Math.max(0, Math.min(offset, size))
      if (begin === 0) {
        const now = new Date()
        utimesSync(out, now, now) // pruning drops the least recently opened first
      }
      const len = Math.min(DOWNLOAD_CHUNK, size - begin)
      const buf = Buffer.alloc(len)
      const fd = openSync(out, 'r')
      try {
        readSync(fd, buf, 0, len, begin)
      } finally {
        closeSync(fd)
      }
      return { b64: buf.toString('base64'), eof: begin + len >= size }
    })
  }
}

/** First installed candidate from formats.json (`~/` is home), when everything it `requires` exists. */
export function locateFrom(spec: ConverterSpec | undefined): string | null {
  if (!spec) return null
  const expand = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
  if ((spec.requires ?? []).some((p) => !existsSync(expand(p)))) return null
  return spec.candidates.map(expand).find((p) => existsSync(p)) ?? null
}

import { runTool } from './exec'
const registry = createRegistry(JSON.parse(readFileSync(new URL('../formats.json', import.meta.url), 'utf8')))
export default createWorker({
  registry,
  exec: runTool,
  cacheDir: join(homedir(), 'Library', 'Caches', 'orca-convert-viewer'),
  locate: (id) => locateFrom(registry.file.converters[id]),
  loadConverter: async (id) => (await import(`./converters/${id}.ts`)).default as Converter
})
