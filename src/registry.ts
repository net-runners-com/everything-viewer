// Reads formats.json: which suffixes this plugin opens, the viewer that shows each, and the
// converters that run first. Pure (no Node or DOM imports) so the worker, the editor frame and the
// generator share it; each loads the JSON its own way.

export type OutKind = 'pdf' | 'glb' | 'png' | 'mp4'
export type Stage = 'convert' | 'fallback'

export type ConverterSpec = {
  label: string
  output: OutKind
  /** Where the tool may live, most likely first; `~/` is the home folder. */
  candidates: string[]
  /** Paths that must exist for the tool to be usable (an app it drives). */
  requires?: string[]
  /** Shown when no candidate exists. */
  missing: string
}

export type FormatSpec = {
  id: string
  /** Name in the editor's view toggle and on the tab. */
  title?: string
  /** Suffixes without the dot (at most 32: Orca's limit per editor). */
  extensions: string[]
  /** `bytes` for binary files; `text` for files Orca opens in Source. */
  content: 'bytes' | 'text'
  /** `option` only offers the viewer in the toggle beside Orca's own view or another plugin's. */
  priority: 'default' | 'option'
  /** `editor/viewers/<viewer>.ts`. */
  viewer: string
  /** Converters tried in order before showing; the first that succeeds wins. */
  convert?: string[]
  /** Converters tried only when the viewer can't show the file's own bytes. */
  fallback?: string[]
  /** Passed to the viewer as is (MIME types, parser name, media kind…). */
  options?: Record<string, any>
}

export type FormatsFile = { converters: Record<string, ConverterSpec>; formats: FormatSpec[] }

export type Registry = {
  file: FormatsFile
  formatFor(ext: string): FormatSpec | null
  byId(id: string): FormatSpec | null
  /** The converters a stage runs and what they produce; null when the format has none. */
  chain(format: FormatSpec, stage: Stage): { output: OutKind; converters: string[] } | null
}

export function createRegistry(file: FormatsFile): Registry {
  const byExt = new Map<string, FormatSpec>()
  const byId = new Map<string, FormatSpec>()
  for (const f of file.formats) {
    if (byId.has(f.id)) throw new Error(`format ${f.id} listed twice`)
    byId.set(f.id, f)
    if (f.extensions.length > 32) throw new Error(`${f.id}: at most 32 extensions per format`)
    for (const raw of f.extensions) {
      const ext = raw.toLowerCase()
      if (byExt.has(ext)) throw new Error(`.${ext} listed twice (${byExt.get(ext)!.id}, ${f.id})`)
      byExt.set(ext, f)
    }
    for (const stage of ['convert', 'fallback'] as const) {
      const ids = f[stage] ?? []
      for (const c of ids) if (!file.converters[c]) throw new Error(`${f.id}: unknown converter ${c}`)
      if (new Set(ids.map((c) => file.converters[c].output)).size > 1) throw new Error(`${f.id}: ${stage} converters have different outputs`)
    }
  }
  return {
    file,
    formatFor: (ext) => byExt.get(ext.toLowerCase().replace(/^\./, '')) ?? null,
    byId: (id) => byId.get(id) ?? null,
    chain(format, stage) {
      const converters = format[stage] ?? []
      return converters.length ? { output: file.converters[converters[0]].output, converters } : null
    }
  }
}

export type EditorContribution = {
  id: string
  title: string
  extensions: string[]
  entry: string
  frame: 'isolated'
  contentKind: 'bytes' | 'text'
  priority: 'default' | 'option'
}

/** Orca allows at most 16 custom editors per plugin and 32 suffixes per editor. */
export const MAX_EDITORS = 16
const MAX_SUFFIXES = 32

/** The manifest's editors for formats.json. Text documents carry no file name, so each text format
 *  gets its own editor whose entry names it; bytes documents name their suffix (`fileType`), so
 *  bytes formats share editors grouped by priority. */
export function editorsFor(file: FormatsFile): EditorContribution[] {
  const editors: EditorContribution[] = []
  const shared = new Map<string, string[]>()
  for (const f of file.formats) {
    if (f.content === 'text') {
      editors.push({
        id: f.id,
        title: f.title ?? 'Preview',
        extensions: f.extensions.map((e) => `.${e}`),
        entry: `editor/entries/${f.id}.ts`,
        frame: 'isolated',
        contentKind: 'text',
        priority: f.priority
      })
    } else shared.set(f.priority, [...(shared.get(f.priority) ?? []), ...f.extensions])
  }
  for (const [priority, exts] of shared) {
    for (let i = 0; i < exts.length; i += MAX_SUFFIXES) {
      editors.push({
        id: `files-${priority}-${i / MAX_SUFFIXES + 1}`,
        title: 'Viewer',
        extensions: exts.slice(i, i + MAX_SUFFIXES).map((e) => `.${e}`),
        entry: 'editor/entries/files.ts',
        frame: 'isolated',
        contentKind: 'bytes',
        priority: priority as EditorContribution['priority']
      })
    }
  }
  if (editors.length > MAX_EDITORS) throw new Error(`${editors.length} editors: Orca allows ${MAX_EDITORS}`)
  return editors
}
