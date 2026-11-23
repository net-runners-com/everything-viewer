import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { ALL_FORMATS, canConvert, routeFor } from './formats'

test('routeFor picks a view and, when needed, a converter', () => {
  assert.deepEqual(routeFor('doc'), { view: 'pdf', convert: 'pdf', content: 'bytes', priority: 'default' })
  assert.deepEqual(routeFor('PDF'), { view: 'pdf', convert: null, content: 'bytes', priority: 'option' })
  assert.deepEqual(routeFor('mp4'), { view: 'media', convert: null, fallback: 'mp4', content: 'bytes', priority: 'option' })
  assert.deepEqual(routeFor('wmv'), { view: 'media', convert: 'mp4', content: 'bytes', priority: 'default' })
  assert.deepEqual(routeFor('heic'), { view: 'image', convert: 'png', content: 'bytes', priority: 'option' })
  assert.deepEqual(routeFor('png'), { view: 'image', convert: null, content: 'bytes', priority: 'option' })
  assert.deepEqual(routeFor('stl'), { view: 'model', convert: 'glb', content: 'bytes', priority: 'option' })
  assert.deepEqual(routeFor('glb'), { view: 'model', convert: null, content: 'bytes', priority: 'option' })
  assert.deepEqual(routeFor('woff2'), { view: 'font', convert: null, content: 'bytes', priority: 'option' })
  assert.equal(routeFor('md')?.view, 'markdown')
  assert.equal(routeFor('yml')?.view, 'tree')
  assert.equal(routeFor('tsv')?.view, 'table')
  assert.equal(routeFor('ipynb')?.view, 'notebook')
  assert.equal(routeFor('csv')?.content, 'text')
  assert.equal(routeFor('ts'), null)
})

test('canConvert allows only the converter a format maps to (or its fallback)', () => {
  assert.equal(canConvert('docx', 'pdf'), true)
  assert.equal(canConvert('mp4', 'mp4'), true)
  assert.equal(canConvert('png', 'mp4'), false)
  assert.equal(canConvert('json', 'pdf'), false)
})

test('the manifest lists every format exactly once, grouped by content and priority', () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  const seen = new Map<string, { content: string; priority: string }>()
  for (const e of manifest.contributes.customEditors) {
    assert.ok(e.extensions.length <= 32, `${e.id} lists more than 32 extensions`)
    for (const x of e.extensions) {
      const ext = x.slice(1)
      assert.ok(!seen.has(ext), `${ext} listed twice`)
      seen.set(ext, { content: e.contentKind ?? 'text', priority: e.priority ?? 'default' })
    }
  }
  assert.deepEqual([...seen.keys()].sort(), [...ALL_FORMATS].sort())
  for (const [ext, got] of seen) {
    const r = routeFor(ext)!
    assert.deepEqual(got, { content: r.content, priority: r.priority }, ext)
  }
})
