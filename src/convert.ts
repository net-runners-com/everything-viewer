// Pure pieces of the conversion pipeline: which converter a file needs, the exact command lines,
// and reassembly of base64 chunks the editor frame uploads (requests are capped at 64 KiB).
import { randomUUID } from 'node:crypto'

export type OutKind = 'pdf' | 'glb'

/** Formats LibreOffice turns into PDF that no installed viewer already covers. */
export const DOC_EXTS = [
  'doc', 'dot', 'ppt', 'pps', 'pot',
  'odt', 'ott', 'odp', 'otp', 'odg', 'otg',
  'vsd', 'vsdx', 'pub', 'wpd', 'wps',
  'key', 'pages', 'numbers'
]
export const BLEND_EXTS = ['blend']

export function outKindFor(ext: string): OutKind | null {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (DOC_EXTS.includes(e)) return 'pdf'
  if (BLEND_EXTS.includes(e)) return 'glb'
  return null
}

/** A private profile keeps a LibreOffice window the user has open from blocking the conversion. */
export function sofficeArgs(input: string, outDir: string, profileDir: string): string[] {
  return [`-env:UserInstallation=file://${profileDir}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, input]
}

export function blenderArgs(input: string, out: string, script: string): string[] {
  return ['-b', '--factory-startup', input, '--python', script, '--', out]
}

export const BLENDER_EXPORT_PY = `import bpy, sys
bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format='GLB', export_apply=True)
`

type Pending = { size: number; buf: Buffer; chunks: Map<number, number> }

/** Upload buffers keyed by id (not hash), so one file open in two tabs never mixes chunks. */
export class Uploads {
  private pending = new Map<string, Pending>()

  begin(size: number): string {
    if (!Number.isInteger(size) || size < 0) throw new Error(`bad size ${size}`)
    const id = randomUUID()
    this.pending.set(id, { size, buf: Buffer.alloc(size), chunks: new Map() })
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
