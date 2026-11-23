// Small, dependency-free parsers for the text views: CSV/TSV rows, JSON with comments, a tree model
// of any JSON-like value, and XML to a JSON-like value. Pure so they run in Node tests.

export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function sniffDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  let best = ','
  let most = 0
  for (const d of [',', '\t', ';', '|']) {
    const n = first.split(d).length
    if (n > most) {
      most = n
      best = d
    }
  }
  return best
}

/** JSONC → JSON: drops comments and trailing commas, leaving string contents alone. */
export function stripJsonComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 1
    } else out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

export type TreeNode = {
  key: string
  path: string
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  /** Short text for leaves, `{n}` / `[n]` for containers. */
  preview: string
  count?: number
  children?: TreeNode[]
}

const ID_RE = /^[A-Za-z_$][\w$]*$/

export function toTree(value: unknown, key = '$', path = '$'): TreeNode {
  if (value === null || value === undefined) return { key, path, type: 'null', preview: 'null' }
  if (Array.isArray(value)) {
    return {
      key, path, type: 'array', preview: `[${value.length}]`, count: value.length,
      children: value.map((v, i) => toTree(v, String(i), `${path}[${i}]`))
    }
  }
  if (value instanceof Date) return { key, path, type: 'string', preview: value.toISOString() }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return {
      key, path, type: 'object', preview: `{${entries.length}}`, count: entries.length,
      children: entries.map(([k, v]) => toTree(v, k, ID_RE.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`))
    }
  }
  if (typeof value === 'string') return { key, path, type: 'string', preview: value }
  if (typeof value === 'number' || typeof value === 'bigint') return { key, path, type: 'number', preview: String(value) }
  if (typeof value === 'boolean') return { key, path, type: 'boolean', preview: String(value) }
  return { key, path, type: 'string', preview: String(value) }
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m)
  )

type XmlEl = { name: string; attrs: [string, string][]; kids: (XmlEl | string)[] }

/** XML → { tag: { '@attr': v, child: value | value[], '#text'?: text } }; leaf elements become their text. */
export function xmlToValue(xml: string): unknown {
  const root: XmlEl = { name: '#root', attrs: [], kids: [] }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.kids.push(m[1])
    else if (m[2]) {
      if (stack.length > 1) stack.pop()
    } else if (m[3]) {
      const attrs: [string, string][] = []
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs.push([a[1], decode(a[3] ?? a[4] ?? '')])
      const el: XmlEl = { name: m[3], attrs, kids: [] }
      top.kids.push(el)
      if (!m[5]) stack.push(el)
    } else if (m[6] && m[6].trim()) top.kids.push(decode(m[6].trim()))
  }
  const convert = (el: XmlEl): unknown => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of el.attrs) out[`@${k}`] = v
    const texts: string[] = []
    const repeated = new Set<string>()
    for (const k of el.kids) {
      if (typeof k === 'string') texts.push(k)
      else {
        const v = convert(k)
        if (repeated.has(k.name)) (out[k.name] as unknown[]).push(v)
        else if (k.name in out) {
          out[k.name] = [out[k.name], v]
          repeated.add(k.name)
        } else out[k.name] = v
      }
    }
    const text = texts.join(' ')
    if (Object.keys(out).length === 0) return text
    if (text) out['#text'] = text
    return out
  }
  const doc = convert(root) as Record<string, unknown> | string
  return typeof doc === 'string' ? {} : doc
}
