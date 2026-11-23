import { readdirSync, readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { createRegistry, editorsFor, type FormatsFile } from './registry'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const file = JSON.parse(read('../formats.json')) as FormatsFile
const reg = createRegistry(file)

test('formats.json maps extensions to a format, its viewer and its converters', () => {
  assert.equal(reg.formatFor('DOC')?.viewer, 'pdf')
  assert.equal(reg.formatFor('.yml')?.options?.parser, 'yaml')
  assert.equal(reg.formatFor('ts'), null)
  assert.deepEqual(reg.chain(reg.formatFor('pages')!, 'convert'), { output: 'pdf', converters: ['libreoffice'] })
  assert.deepEqual(reg.chain(reg.formatFor('wmv')!, 'convert'), { output: 'mp4', converters: ['ffmpeg'] })
  assert.equal(reg.chain(reg.formatFor('json')!, 'convert'), null)
  assert.equal(reg.formatFor('pptx')?.viewer, 'pdf') // with a page toolbar, replacing the Presentation Viewer plugin
})

test('formats.json leaves out what Orca or an installed plugin already shows', () => {
  for (const ext of ['key', 'md', 'csv', 'html', 'svg', 'ipynb', 'png', 'pdf', 'mp4', 'mp3', 'docx', 'xlsx', 'stl', 'glb', 'ttf', 'heic']) {
    assert.equal(reg.formatFor(ext), null, ext)
  }
})

test('every viewer and converter named in formats.json has its code file', () => {
  const viewers = new Set(readdirSync(new URL('../editor/viewers/', import.meta.url)).map((f) => f.replace(/\.ts$/, '')))
  const converters = new Set(readdirSync(new URL('./converters/', import.meta.url)).map((f) => f.replace(/\.ts$/, '')))
  for (const f of file.formats) {
    assert.ok(viewers.has(f.viewer), `${f.id}: no editor/viewers/${f.viewer}.ts`)
    for (const c of [...(f.convert ?? []), ...(f.fallback ?? [])]) assert.ok(converters.has(c), `${f.id}: no src/converters/${c}.ts`)
  }
  for (const id of Object.keys(file.converters)) assert.ok(converters.has(id), `no src/converters/${id}.ts`)
})

test('createRegistry rejects duplicate extensions, unknown converters and mixed outputs', () => {
  const base = { converters: file.converters }
  const fmt = (id: string, extensions: string[], extra = {}) => ({ id, extensions, content: 'bytes' as const, priority: 'option' as const, viewer: 'pdf', ...extra })
  assert.throws(() => createRegistry({ ...base, formats: [fmt('a', ['x']), fmt('b', ['x'])] }), /listed twice/)
  assert.throws(() => createRegistry({ ...base, formats: [fmt('a', ['x'], { convert: ['nope'] })] }), /unknown converter/)
  assert.throws(() => createRegistry({ ...base, formats: [fmt('a', ['x'], { convert: ['libreoffice', 'ffmpeg'] })] }), /different outputs/)
  assert.throws(() => createRegistry({ ...base, formats: [fmt('a', Array.from({ length: 33 }, (_, i) => `e${i}`))] }), /32/)
})

test('the manifest is generated from formats.json (run scripts/gen.ts after editing it)', () => {
  const manifest = JSON.parse(read('../orca-plugin.json'))
  assert.deepEqual(manifest.contributes.customEditors, editorsFor(file))
})

test('editorsFor gives each text format its own entry and shares the bytes ones', () => {
  const editors = editorsFor(file)
  assert.ok(editors.length <= 16)
  const yaml = editors.find((e) => e.extensions.includes('.yaml'))!
  assert.deepEqual([yaml.entry, yaml.contentKind], ['editor/entries/yaml.ts', 'text'])
  const doc = editors.find((e) => e.extensions.includes('.doc'))!
  assert.deepEqual([doc.entry, doc.priority], ['editor/entries/files.ts', 'default'])
  for (const e of editors) {
    assert.ok(e.extensions.length <= 32)
    // A catalog lists each editor's suffixes as one detail line of at most 160 characters.
    assert.ok(e.extensions.join(', ').length <= 160, `${e.id}: ${e.extensions.join(', ').length} characters`)
  }
})
