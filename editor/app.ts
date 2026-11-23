// The editor app shared by every format's entry: reads formats.json, converts the file through the
// worker when its format says so, then loads the viewer formats.json names and hands it the result.
import { createRegistry, type FormatSpec, type Registry, type Stage } from '../src/registry'
import { errorBox } from './lib/ui'
import type { View, ViewContext } from './lib/view'
import { ConvertError, convertBytes, type Phase } from './transfer'

const ja = (orca.locale || '').startsWith('ja')
const t = (j: string, e: string) => (ja ? j : e)

const style = document.createElement('link')
style.rel = 'stylesheet'
style.href = new URL('./app.css', import.meta.url).href
document.head.append(style)
const app = document.createElement('div')
app.id = 'app'
;(document.getElementById('root') ?? document.body).append(app)

function status(title: string, detail = '', progress: number | null = null) {
  const box = document.createElement('div')
  box.className = 'status'
  const h = document.createElement('div')
  h.className = 'title'
  h.textContent = title
  box.append(h)
  if (progress !== null) {
    const p = document.createElement('div')
    p.className = 'progress'
    const fill = document.createElement('div')
    fill.style.width = `${Math.round(progress * 100)}%`
    p.append(fill)
    box.append(p)
  }
  if (detail) {
    const d = document.createElement('div')
    d.className = 'detail'
    d.style.textAlign = 'center'
    d.textContent = detail
    box.append(d)
  }
  app.replaceChildren(box)
}

const PHASE: Record<Phase, string> = {
  upload: t('読み込み中…', 'Reading…'),
  convert: t('変換中…', 'Converting…'),
  download: t('表示の準備中…', 'Preparing…')
}

let registry: Promise<Registry> | null = null
const loadRegistry = () =>
  (registry ??= fetch(new URL('../formats.json', import.meta.url))
    .then((r) => r.json())
    .then(createRegistry))

const loadView = async (name: string): Promise<View> => (await import(`./viewers/${name}.ts`)).default

let current = 0

async function open(format: FormatSpec, reg: Registry, content: { kind: 'text'; text: string } | { kind: 'bytes'; bytes: ArrayBuffer }, ext: string) {
  const run = ++current
  const convert = async (stage: Stage) => {
    status(t('準備中…', 'Starting…'))
    return convertBytes(
      (content as { bytes: ArrayBuffer }).bytes,
      ext,
      stage,
      (method, input, opts) => orca.plugin.request(method, input as never, opts),
      (phase, ratio, label) => {
        if (run === current) status(PHASE[phase], phase === 'convert' ? (label ?? '') : '', phase === 'convert' ? null : ratio)
      }
    )
  }
  const ctx: ViewContext = { root: app, t, ext, options: format.options ?? {} }
  if (content.kind === 'text') ctx.text = content.text
  else {
    const first = reg.chain(format, 'convert')
    ctx.data = first ? await convert('convert') : new Uint8Array(content.bytes)
    if (first) ctx.output = first.output
    const fallback = reg.chain(format, 'fallback')
    if (fallback) ctx.fallback = async () => ({ data: await convert('fallback'), output: fallback.output })
  }
  if (run !== current) return
  const view = await loadView(format.viewer)
  if (run === current) await view(ctx)
}

function showError(error: unknown) {
  const kind = error instanceof ConvertError ? error.kind : 'failed'
  const title =
    kind === 'not_found'
      ? t('変換ツールが見つかりません', 'A converter is not installed')
      : kind === 'timeout'
        ? t('変換に時間がかかりすぎました', 'Conversion took too long')
        : t('このファイルを表示できませんでした', 'Could not show this file')
  app.replaceChildren(errorBox(title, error instanceof Error ? error.message : String(error)))
}

/** Starts the editor. Text entries pass their format id; bytes documents name their suffix. */
export function boot(formatId?: string): void {
  orca.document!.onDidChange((doc) => {
    const run = current + 1
    void (async () => {
      try {
        const reg = await loadRegistry()
        const format = formatId ? reg.byId(formatId) : reg.formatFor(doc.fileType ?? '')
        if (!format) throw new Error(`formats.json has no format for ${formatId ?? '.' + doc.fileType}`)
        // Bytes documents name the matched suffix; text documents carry none, so use the format's first.
        await open(format, reg, doc.content, (doc.fileType ?? format.extensions[0]).toLowerCase())
      } catch (error) {
        if (current <= run) showError(error)
      }
    })()
  })
}
