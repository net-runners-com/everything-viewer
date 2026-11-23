// Tiny DOM helpers shared by the viewers.
import type { Translate } from './view'

export type T = Translate

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

export function button(label: string, title = label): HTMLButtonElement {
  const b = el('button', '', label)
  b.title = title
  return b
}

/** A toolbar row: items on the left, `right` after a spacer. */
export function bar(left: (Node | string)[], right: Node[] = []): HTMLDivElement {
  const b = el('div', 'bar')
  for (const item of left) b.append(typeof item === 'string' ? el('span', 'muted', item) : item)
  b.append(el('span', 'spacer'), ...right)
  return b
}

export function blobUrl(data: Uint8Array | string, type: string): string {
  return URL.createObjectURL(new Blob([data as BlobPart], { type }))
}

export function formatBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`
}

export function errorBox(title: string, detail: string): HTMLElement {
  const box = el('div', 'status error')
  box.append(el('div', 'title', title), el('div', 'detail', detail))
  return box
}
