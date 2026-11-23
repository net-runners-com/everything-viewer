// Every format this plugin opens: which view shows it, and which converter (if any) runs first.
// Pure (no Node imports) so the editor frame and the worker share it.

export type OutKind = 'pdf' | 'glb' | 'png' | 'mp4'
export type View = 'pdf' | 'model' | 'image' | 'media' | 'font' | 'markdown' | 'html' | 'tree' | 'table' | 'svg' | 'notebook'
export type Route = {
  view: View
  /** Converter to run before showing; null shows the file's own bytes. */
  convert: OutKind | null
  /** Converter to try when the direct view fails (a codec the browser can't play). */
  fallback?: OutKind
  content: 'bytes' | 'text'
  /** `option` when Orca or an installed plugin already shows the format: offered, never forced. */
  priority: 'default' | 'option'
}

type Group = { exts: string[]; route: Route }

const bytes = (view: View, convert: OutKind | null, priority: Route['priority'], fallback?: OutKind): Route =>
  fallback ? { view, convert, fallback, content: 'bytes', priority } : { view, convert, content: 'bytes', priority }
const text = (view: View): Route => ({ view, convert: null, content: 'text', priority: 'option' })

export const GROUPS: Group[] = [
  // LibreOffice (Keynote.app for .key) -> PDF. Nobody else opens these.
  { exts: ['doc', 'dot', 'ppt', 'pps', 'pot', 'odt', 'ott', 'odp', 'otp', 'odg', 'otg', 'vsd', 'vsdx', 'pub', 'wpd', 'wps', 'key', 'pages', 'numbers'], route: bytes('pdf', 'pdf', 'default') },
  // Modern Office: the Word/Spreadsheet/Presentation plugins already show these.
  { exts: ['docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'pptx', 'pptm', 'ppsx', 'potx'], route: bytes('pdf', 'pdf', 'option') },
  { exts: ['pdf'], route: bytes('pdf', null, 'option') },
  // Blender -> GLB.
  { exts: ['blend', 'abc'], route: bytes('model', 'glb', 'default') },
  { exts: ['stl', 'obj', 'fbx', 'ply', 'usd', 'usdz', 'usdc', 'usda'], route: bytes('model', 'glb', 'option') },
  { exts: ['glb'], route: bytes('model', null, 'option') },
  // Images: the browser shows these; sips converts the rest to PNG.
  { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'apng'], route: bytes('image', null, 'option') },
  { exts: ['tif', 'tiff', 'heic', 'heif', 'psd'], route: bytes('image', 'png', 'option') },
  { exts: ['jp2'], route: bytes('image', 'png', 'default') },
  // Media: play directly, ffmpeg -> MP4 when the codec isn't playable.
  { exts: ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'weba'], route: bytes('media', null, 'option', 'mp4') },
  { exts: ['mkv', 'avi'], route: bytes('media', 'mp4', 'option') },
  { exts: ['wmv', 'flv', 'mpg', 'mpeg', '3gp', 'mts', 'm2ts', 'vob', 'aiff', 'aif', 'caf', 'wma', 'amr'], route: bytes('media', 'mp4', 'default') },
  { exts: ['ttf', 'otf', 'woff', 'woff2'], route: bytes('font', null, 'option') },
  // Text files: Orca opens them in Source; these views sit in the toggle beside it.
  { exts: ['md', 'markdown', 'mdx'], route: text('markdown') },
  { exts: ['html', 'htm', 'xhtml'], route: text('html') },
  { exts: ['json', 'jsonc', 'geojson', 'yaml', 'yml', 'toml', 'xml', 'plist'], route: text('tree') },
  { exts: ['csv', 'tsv'], route: text('table') },
  { exts: ['svg'], route: text('svg') },
  { exts: ['ipynb'], route: text('notebook') }
]

const BY_EXT = new Map<string, Route>()
for (const g of GROUPS) for (const e of g.exts) BY_EXT.set(e, g.route)

export const ALL_FORMATS: string[] = [...BY_EXT.keys()]

export function routeFor(ext: string): Route | null {
  return BY_EXT.get(ext.toLowerCase().replace(/^\./, '')) ?? null
}

export function canConvert(ext: string, kind: OutKind): boolean {
  const r = routeFor(ext)
  return !!r && (r.convert === kind || r.fallback === kind)
}
