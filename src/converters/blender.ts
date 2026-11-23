// Blender: opens .blend scenes, imports other 3D formats into an empty scene, exports GLB.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIN, type Converter } from './types'

/** Import operator per suffix; anything not listed is opened as a .blend scene. */
const IMPORTERS: Record<string, string> = {
  stl: 'bpy.ops.wm.stl_import',
  obj: 'bpy.ops.wm.obj_import',
  fbx: 'bpy.ops.import_scene.fbx',
  ply: 'bpy.ops.wm.ply_import',
  usd: 'bpy.ops.wm.usd_import',
  usdz: 'bpy.ops.wm.usd_import',
  usdc: 'bpy.ops.wm.usd_import',
  usda: 'bpy.ops.wm.usd_import',
  abc: 'bpy.ops.wm.alembic_import'
}

export function exportScript(ext: string): string {
  const importer = IMPORTERS[ext]
  return [
    'import bpy, sys',
    'src, out = sys.argv[-2], sys.argv[-1]',
    ...(importer ? ['bpy.ops.wm.read_factory_settings(use_empty=True)', `${importer}(filepath=src)`] : []),
    "bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True)",
    ''
  ].join('\n')
}

/** A .blend opens as the scene; anything else is imported by the script. */
export function blenderArgs(input: string, out: string, script: string, opensScene: boolean): string[] {
  return ['-b', '--factory-startup', ...(opensScene ? [input] : []), '--python', script, '--', input, out]
}

const converter: Converter = {
  async run({ src, ext, dir, out, tool, exec }) {
    const script = join(dir, 'export.py')
    writeFileSync(script, exportScript(ext))
    await exec(tool, blenderArgs(src, out, script, !(ext in IMPORTERS)), { timeoutMs: 5 * MIN })
    return out
  }
}
export default converter
