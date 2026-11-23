// Moves file bytes from the editor frame to the worker and the converted file back. Requests carry
// JSON only (inputs ≤ 64 KiB, answers ≤ 1 MiB), so bytes travel as base64 chunks.
import type { OutKind } from '../src/formats'
import type { JobState, ToolError } from '../src/protocol'

type ToolErrorKind = ToolError['kind']

export type RequestFn = (method: string, input: unknown, opts?: { timeoutMs?: number }) => Promise<any>
export type Phase = 'upload' | 'convert' | 'download'

const UPLOAD_CHUNK = 45_000
const PARALLEL = 6

export class ConvertError extends Error {
  kind: ToolErrorKind
  constructor(kind: ToolErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Orca budgets frame→worker requests; a `rate_limited` call says when to try again. */
export function retrying(request: RequestFn, maxRetries = 600): RequestFn {
  return async (method, input, opts) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(method, input, opts)
      } catch (error) {
        const e = error as { code?: string; retryAfterMs?: number }
        if (e?.code !== 'rate_limited' || attempt >= maxRetries) throw error
        await sleep(Math.max(20, e.retryAfterMs ?? 250))
      }
    }
  }
}

const POLL_MS = 400

/** Converts `bytes` (a file ending in `ext`) to `kind` through the worker and returns the result. */
export async function convertBytes(
  bytes: ArrayBuffer,
  ext: string,
  kind: OutKind,
  request: RequestFn,
  onProgress?: (phase: Phase, ratio: number) => void
): Promise<Uint8Array> {
  request = retrying(request)
  const hash = await sha256Hex(bytes)
  let job: JobState = await request('convert.lookup', { hash, kind })

  if (job.state === 'missing' || job.state === 'error') {
    const src = new Uint8Array(bytes)
    const { id } = await request('upload.begin', { size: src.length })
    const offsets: number[] = []
    for (let o = 0; o < src.length; o += UPLOAD_CHUNK) offsets.push(o)
    let sent = 0
    const lane = async () => {
      for (let o = offsets.shift(); o !== undefined; o = offsets.shift()) {
        await request('upload.chunk', { id, offset: o, b64: toBase64(src.subarray(o, o + UPLOAD_CHUNK)) })
        sent += Math.min(UPLOAD_CHUNK, src.length - o)
        onProgress?.('upload', src.length ? sent / src.length : 1)
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, lane))
    job = await request('upload.finish', { id, hash, ext, kind })
  }

  if (job.state === 'running') onProgress?.('convert', 0)
  while (job.state === 'running') {
    await sleep(POLL_MS)
    job = await request('convert.lookup', { hash, kind })
  }
  if (job.state === 'error') throw new ConvertError(job.error.kind, job.error.message)
  if (job.state !== 'ready') throw new ConvertError('failed', 'conversion vanished')

  const size = job.size
  const data = new Uint8Array(size)
  let offset = 0
  for (;;) {
    const { b64, eof } = await request('convert.read', { hash, kind, offset })
    const part = fromBase64(b64)
    data.set(part, offset)
    offset += part.length
    onProgress?.('download', size ? offset / size : 1)
    if (eof || part.length === 0) break
  }
  return data
}
