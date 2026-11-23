// An audio or video player. Resolves false when the browser cannot play the bytes, so the format's
// view can transcode and try again.
import { bar, blobUrl, el, formatBytes, type T } from '../lib/ui'
import type { View } from '../lib/view'

function showMedia(root: HTMLElement, data: Uint8Array, mime: string, kind: 'audio' | 'video', t: T): Promise<boolean> {
  return new Promise((resolve) => {
    const media = el(kind) as HTMLMediaElement
    media.controls = true
    media.preload = 'metadata'
    media.src = blobUrl(data, mime)
    const info = el('span', 'muted', formatBytes(data.length))
    const stage = el('div', kind === 'audio' ? 'media-stage audio' : 'media-stage')
    stage.append(media)
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    media.onerror = () => done(false)
    media.onloadedmetadata = () => {
      const v = media as HTMLVideoElement
      // An unsupported video codec can still load its audio track: a 0×0 picture means unplayable.
      if (kind === 'video' && v.videoWidth === 0 && v.videoHeight === 0) return done(false)
      const d = media.duration
      const time = Number.isFinite(d) ? `${Math.floor(d / 60)}:${Math.round(d % 60).toString().padStart(2, '0')}` : ''
      info.textContent = [time, kind === 'video' ? `${v.videoWidth} × ${v.videoHeight}` : '', formatBytes(data.length)].filter(Boolean).join(' · ')
      done(true)
    }
    root.replaceChildren(bar([info]), stage)
    void t
  })
}

/** options.kind: 'audio' | 'video'; options.mime: suffix -> MIME type. Converted media is MP4.
 *  When the browser can't play the file's own bytes, the format's fallback converters run. */
const view: View = async (ctx) => {
  const kind: 'audio' | 'video' = ctx.options.kind === 'audio' ? 'audio' : 'video'
  const mime = ctx.output ? `${kind}/mp4` : (ctx.options.mime?.[ctx.ext] ?? `${kind}/mp4`)
  if (await showMedia(ctx.root, ctx.data!, mime, kind, ctx.t)) return
  if (ctx.fallback) {
    const { data } = await ctx.fallback()
    if (await showMedia(ctx.root, data, `${kind}/mp4`, kind, ctx.t)) return
  }
  throw new Error(ctx.t('この形式は再生できませんでした', 'This file could not be played'))
}
export default view
