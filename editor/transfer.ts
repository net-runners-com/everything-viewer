// Moves file bytes from the editor frame to the worker and the converted file back. Requests carry
// JSON only (inputs ≤ 64 KiB, answers ≤ 1 MiB), so bytes travel as base64 chunks.
import type { OutKind, ToolErrorKind } from './types'

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

export function kindForExt(ext: string): OutKind {
  return ext.toLowerCase() === 'blend' ? 'glb' : 'pdf'
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

export async function convertBytes(
  bytes: ArrayBuffer,
  ext: string,
  request: RequestFn,
  onProgress?: (phase: Phase, ratio: number) => void
): Promise<{ kind: OutKind; data: Uint8Array }> {
  const kind = kindForExt(ext)
  const hash = await sha256Hex(bytes)
  let found = await request('convert.lookup', { hash, kind })

  if (!found.ready) {
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
    onProgress?.('convert', 0)
    found = await request('upload.finish', { id, hash, ext }, { timeoutMs: 120_000 })
    if ('error' in found) throw new ConvertError(found.error.kind, found.error.message)
  }

  const size: number = found.size
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
  return { kind, data }
}
