// Rewrites contributes.customEditors in orca-plugin.json from src/formats.ts (≤ 32 extensions each).
// Run: node --experimental-strip-types scripts/gen-manifest.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { GROUPS } from '../src/formats.ts'

const TITLES: Record<string, string> = {
  'bytes:default': 'Viewer',
  'bytes:option': 'Viewer',
  'text:option': 'Preview'
}
const buckets = new Map<string, string[]>()
for (const g of GROUPS) {
  const key = `${g.route.content}:${g.route.priority}`
  buckets.set(key, [...(buckets.get(key) ?? []), ...g.exts])
}
const editors = []
for (const [key, exts] of buckets) {
  const [content, priority] = key.split(':')
  for (let i = 0; i < exts.length; i += 32) {
    const part = exts.slice(i, i + 32)
    editors.push({
      id: `${content}-${priority}-${i / 32 + 1}`,
      title: TITLES[key],
      extensions: part.map((e) => '.' + e),
      entry: 'editor/main.ts',
      frame: 'isolated',
      contentKind: content,
      priority
    })
  }
}
const path = new URL('../orca-plugin.json', import.meta.url)
const manifest = JSON.parse(readFileSync(path, 'utf8'))
manifest.contributes = { ...manifest.contributes, customEditors: editors }
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
console.log(editors.map((e) => `${e.id}: ${e.extensions.length}`).join('\n'))
