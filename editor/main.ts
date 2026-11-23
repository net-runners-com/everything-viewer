// Entry of both custom editors: converts the opened file through the worker, then shows it.
import { ConvertError, convertBytes, type Phase } from './transfer'

const ja = (orca.locale || '').startsWith('ja')
const t = (j: string, e: string) => (ja ? j : e)

const CSS = `
html, body { margin: 0; height: 100%; background: var(--orca-background); color: var(--orca-foreground);
  font: 13px var(--orca-font-sans, system-ui, sans-serif); }
#app { display: flex; flex-direction: column; height: 100vh; }
.bar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--orca-border); flex: none; }
.spacer { flex: 1; }
.muted { color: var(--orca-muted-foreground); }
.zoom { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
.bar button { font: inherit; color: var(--orca-foreground); background: var(--orca-card); border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius, 6px); padding: 2px 9px; cursor: pointer; }
.bar button:hover { border-color: var(--orca-ring); }
.bar button:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.scroller { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.page { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); flex: none; }
.page canvas { display: block; }
.stage { flex: 1; min-height: 0; position: relative; }
.stage canvas { display: block; }
.status { margin: auto; text-align: center; max-width: 420px; padding: 24px; }
.status .title { font-size: 14px; margin-bottom: 10px; }
.status .detail { color: var(--orca-muted-foreground); white-space: pre-wrap; word-break: break-word; font-size: 12px; }
.progress { height: 4px; background: var(--orca-muted); border-radius: 2px; overflow: hidden; margin: 10px auto 0; width: 220px; }
.progress > div { height: 100%; width: 0; background: var(--orca-ring); transition: width .15s; }
.error .title { color: var(--orca-destructive); }
`

const style = document.createElement('style')
style.textContent = CSS
document.head.append(style)
const app = document.createElement('div')
app.id = 'app'
;(document.getElementById('root') ?? document.body).append(app)

function status(title: string, detail = '', progress: number | null = null, error = false) {
  const box = document.createElement('div')
  box.className = 'status' + (error ? ' error' : '')
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
    d.textContent = detail
    box.append(d)
  }
  app.replaceChildren(box)
}

const PHASE = {
  upload: t('読み込み中…', 'Reading…'),
  convert: t('変換中…', 'Converting…'),
  download: t('表示の準備中…', 'Preparing…')
} satisfies Record<Phase, string>

let current = 0
async function open(bytes: ArrayBuffer, ext: string) {
  const run = ++current
  const tool = ext.toLowerCase() === 'blend' ? 'Blender' : 'LibreOffice'
  status(t('準備中…', 'Starting…'))
  try {
    const out = await convertBytes(
      bytes,
      ext,
      (method, input, opts) => orca.plugin.request(method, input as any, opts),
      (phase, ratio) => {
        if (run === current) status(PHASE[phase], phase === 'convert' ? tool : '', phase === 'convert' ? null : ratio)
      }
    )
    if (run !== current) return
    if (out.kind === 'pdf') {
      const { showPdf } = await import('./pdf-view')
      await showPdf(app, out.data, t)
    } else {
      const { showGlb } = await import('./glb-view')
      await showGlb(app, out.data, t)
    }
  } catch (error) {
    if (run !== current) return
    const kind = error instanceof ConvertError ? error.kind : 'failed'
    const title =
      kind === 'not_found'
        ? t(`${tool} が見つかりません`, `${tool} is not installed`)
        : kind === 'timeout'
          ? t('変換に時間がかかりすぎました', 'Conversion took too long')
          : t('このファイルを表示できませんでした', 'Could not show this file')
    status(title, error instanceof Error ? error.message : String(error), null, true)
  }
}

orca.document!.onDidChange((doc) => {
  if (doc.content.kind !== 'bytes') {
    status(t('このファイルを表示できませんでした', 'Could not show this file'), 'not a binary document', null, true)
    return
  }
  void open(doc.content.bytes, doc.fileType ?? '')
})
