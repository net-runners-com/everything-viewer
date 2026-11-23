// An image from bytes or markup: fit/100% toggle, size readout, checkerboard behind transparency.
import { bar, blobUrl, button, el, formatBytes, type T } from '../lib/ui'
import type { View } from '../lib/view'

export function showImage(root: HTMLElement, data: Uint8Array | string, mime: string, t: T): void {
  const img = el('img')
  img.src = blobUrl(data, mime)
  img.alt = ''
  const info = el('span', 'muted')
  const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length
  let fit = true
  const toggle = button(t('原寸', '100%'))
  const stage = el('div', 'image-stage checker fit')
  toggle.onclick = () => {
    fit = !fit
    stage.classList.toggle('fit', fit)
    toggle.textContent = fit ? t('原寸', '100%') : t('全体', 'Fit')
  }
  img.onclick = toggle.onclick
  img.onload = () => {
    info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${formatBytes(size)}`
  }
  img.onerror = () => {
    info.textContent = t('この画像は表示できません', 'This image cannot be shown')
  }
  stage.append(img)
  root.replaceChildren(bar([info], [toggle]), stage)
}

/** options.mime: one MIME type, or a map from suffix to MIME type. Converted images are PNG. */
const view: View = (ctx) => {
  const m = ctx.options.mime
  const mime = ctx.output === 'png' ? 'image/png' : typeof m === 'string' ? m : (m?.[ctx.ext] ?? 'application/octet-stream')
  showImage(ctx.root, ctx.text ?? ctx.data!, mime, ctx.t)
}
export default view
