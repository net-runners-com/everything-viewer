// Renders a PDF with the vendored pdf.js: pages stacked, rendered lazily as they scroll in.
import type { Translate, View } from '../lib/view'
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href

const GAP = 12

async function showPdf(root: HTMLElement, data: Uint8Array, t: Translate): Promise<void> {
  const pdf = await pdfjs.getDocument({
    data,
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    isEvalSupported: false
  }).promise

  root.replaceChildren()
  const bar = el('div', 'bar')
  const pagesLabel = el('span', 'muted pages')
  const showPage = (n: number) => {
    pagesLabel.textContent = `${n} / ${pdf.numPages}`
  }
  showPage(1)
  const zoomLabel = el('span', 'zoom')
  const minus = button('−', t('縮小', 'Zoom out'))
  const plus = button('+', t('拡大', 'Zoom in'))
  const fit = button(t('幅に合わせる', 'Fit width'), t('幅に合わせる', 'Fit width'))
  bar.append(pagesLabel, el('span', 'spacer'), minus, zoomLabel, plus, fit)
  const scroller = el('div', 'scroller')
  root.append(bar, scroller)

  const first = await pdf.getPage(1)
  const base = first.getViewport({ scale: 1 })
  let zoom = 1 // relative to fit-width
  let fitScale = 1
  const slots: { box: HTMLDivElement; rendered: number }[] = []

  for (let n = 1; n <= pdf.numPages; n++) {
    const box = el('div', 'page') as HTMLDivElement
    box.dataset.page = String(n)
    scroller.append(box)
    slots.push({ box, rendered: -1 }) // -1: never rendered (generation starts at 0)
  }

  const scale = () => fitScale * zoom
  const layout = () => {
    fitScale = Math.max(0.1, (scroller.clientWidth - GAP * 2) / base.width)
    for (const s of slots) {
      s.box.style.width = `${base.width * scale()}px`
      s.box.style.height = `${base.height * scale()}px`
    }
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`
  }

  let generation = 0
  const render = async (slot: { box: HTMLDivElement; rendered: number }) => {
    const gen = generation
    if (slot.rendered === gen) return
    slot.rendered = gen
    const page = await pdf.getPage(Number(slot.box.dataset.page))
    const vp = page.getViewport({ scale: scale() })
    const dpr = window.devicePixelRatio || 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vp.width * dpr)
    canvas.height = Math.floor(vp.height * dpr)
    canvas.style.width = `${vp.width}px`
    canvas.style.height = `${vp.height}px`
    slot.box.style.width = `${vp.width}px`
    slot.box.style.height = `${vp.height}px`
    try {
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] }).promise
    } catch (error) {
      slot.rendered = -1
      console.error(`page ${slot.box.dataset.page} failed to render`, error)
      return
    }
    if (gen === generation) slot.box.replaceChildren(canvas)
  }

  const visible = new Set<HTMLElement>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target as HTMLElement)
        else visible.delete(e.target as HTMLElement)
      }
      for (const s of slots) if (visible.has(s.box)) void render(s)
    },
    { root: scroller, rootMargin: '600px 0px' }
  )
  slots.forEach((s) => io.observe(s.box))

  const rerender = () => {
    generation++
    layout()
    for (const s of slots) if (visible.has(s.box)) void render(s)
  }
  const setZoom = (z: number) => {
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight)
    zoom = Math.min(5, Math.max(0.25, z))
    rerender()
    scroller.scrollTop = ratio * scroller.scrollHeight
  }
  minus.onclick = () => setZoom(zoom / 1.25)
  plus.onclick = () => setZoom(zoom * 1.25)
  fit.onclick = () => setZoom(1)
  let lastWidth = 0
  new ResizeObserver(() => {
    if (Math.abs(scroller.clientWidth - lastWidth) < 2) return
    lastWidth = scroller.clientWidth
    rerender()
  }).observe(scroller)
  // The page crossing the upper third of the view is the one being read.
  let ticking = false
  scroller.addEventListener('scroll', () => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      ticking = false
      const mark = scroller.getBoundingClientRect().top + scroller.clientHeight / 3
      const reading = slots.find((s) => s.box.getBoundingClientRect().bottom > mark)
      showPage(reading ? Number(reading.box.dataset.page) : pdf.numPages)
    })
  })
  layout()
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  return e
}

function button(label: string, title: string): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.title = title
  return b
}

const view: View = (ctx) => showPdf(ctx.root, ctx.data!, ctx.t)
export default view
