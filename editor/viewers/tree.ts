// A collapsible, filterable tree of any JSON-like value (JSON, YAML, TOML, XML all land here).
import * as yaml from '../vendor/js-yaml/js-yaml.mjs'
import { parse as parseToml } from '../vendor/smol-toml/index.js'
import { stripJsonComments, toTree, xmlToValue, type TreeNode } from '../lib/parse'
import { bar, button, el, errorBox, type T } from '../lib/ui'
import type { View } from '../lib/view'

/** `parse` runs inside so a syntax error shows in the tab instead of failing the editor. */
function showTree(root: HTMLElement, parse: () => unknown, t: T): void {
  let value: unknown
  try {
    value = parse()
  } catch (error) {
    root.replaceChildren(errorBox(t('構文エラー', 'Syntax error'), error instanceof Error ? error.message : String(error)))
    return
  }
  const tree = toTree(value)
  const filter = el('input', 'sample-input')
  filter.placeholder = t('キー・値で絞り込み', 'Filter keys and values')
  const expandAll = button(t('すべて開く', 'Expand all'))
  const collapseAll = button(t('すべて閉じる', 'Collapse all'))
  const list = el('div', 'tree')
  const open = new Set<string>()
  const seed = (n: TreeNode, depth: number) => {
    if (n.children && depth < 2) {
      open.add(n.path)
      n.children.forEach((c) => seed(c, depth + 1))
    }
  }
  seed(tree, 0)

  const matches = (n: TreeNode, q: string): boolean =>
    n.key.toLowerCase().includes(q) || (!n.children && n.preview.toLowerCase().includes(q)) || (n.children ?? []).some((c) => matches(c, q))

  const render = () => {
    const q = filter.value.trim().toLowerCase()
    const rows: HTMLElement[] = []
    const walk = (n: TreeNode, depth: number) => {
      if (q && !matches(n, q)) return
      const row = el('div', 'tree-row')
      row.style.paddingLeft = `${depth * 14 + 6}px`
      row.title = n.path
      const isOpen = q ? true : open.has(n.path)
      const caret = el('span', 'caret', n.children ? (isOpen ? '▾' : '▸') : '')
      row.append(caret, el('span', 'tree-key', n.key))
      if (n.children) row.append(el('span', 'muted', ` ${n.type === 'array' ? `[${n.count}]` : `{${n.count}}`}`))
      else row.append(el('span', 'muted', ': '), el('span', `tree-val t-${n.type}`, n.type === 'string' ? JSON.stringify(n.preview) : n.preview))
      if (n.children) {
        row.classList.add('branch')
        row.onclick = () => {
          if (open.has(n.path)) open.delete(n.path)
          else open.add(n.path)
          render()
        }
      }
      rows.push(row)
      if (n.children && isOpen) n.children.forEach((c) => walk(c, depth + 1))
    }
    walk(tree, 0)
    list.replaceChildren(...rows.slice(0, 5000))
  }
  filter.oninput = render
  const all = (on: boolean) => {
    const visit = (n: TreeNode) => {
      if (!n.children) return
      if (on) open.add(n.path)
      else open.delete(n.path)
      n.children.forEach(visit)
    }
    visit(tree)
    if (!on) open.add(tree.path)
    render()
  }
  expandAll.onclick = () => all(true)
  collapseAll.onclick = () => all(false)
  render()
  root.replaceChildren(bar([filter], [expandAll, collapseAll]), list)
}

/** options.parser names one of these. */
const PARSERS: Record<string, (text: string) => unknown> = {
  json: (text) => JSON.parse(stripJsonComments(text)),
  yaml: (text) => {
    const docs = yaml.loadAll(text)
    return docs.length === 1 ? docs[0] : docs
  },
  toml: (text) => parseToml(text),
  xml: (text) => xmlToValue(text)
}

const view: View = (ctx) => {
  const parse = PARSERS[ctx.options.parser ?? 'json']
  if (!parse) throw new Error(`unknown parser ${ctx.options.parser}`)
  showTree(ctx.root, () => parse(ctx.text!), ctx.t)
}
export default view
