import { assert, test } from 'orca/testing'
import { Uploads, blenderArgs, outKindFor, sofficeArgs } from './convert'

test('outKindFor maps documents to pdf and blender scenes to glb', () => {
  assert.equal(outKindFor('doc'), 'pdf')
  assert.equal(outKindFor('KEY'), 'pdf')
  assert.equal(outKindFor('numbers'), 'pdf')
  assert.equal(outKindFor('blend'), 'glb')
  assert.equal(outKindFor('docx'), null)
})

test('sofficeArgs uses its own profile and converts to pdf', () => {
  assert.deepEqual(sofficeArgs('/in/a.doc', '/out', '/c/lo-profile'), [
    '-env:UserInstallation=file:///c/lo-profile',
    '--headless',
    '--norestore',
    '--convert-to',
    'pdf',
    '--outdir',
    '/out',
    '/in/a.doc'
  ])
})

test('blenderArgs runs the export script in background', () => {
  assert.deepEqual(blenderArgs('/in/a.blend', '/out/a.glb', '/c/export.py'), [
    '-b',
    '--factory-startup',
    '/in/a.blend',
    '--python',
    '/c/export.py',
    '--',
    '/out/a.glb'
  ])
})

const b64 = (s: string) => Buffer.from(s).toString('base64')

test('Uploads assembles concurrent uploads independently', () => {
  const u = new Uploads()
  const a = u.begin(6)
  const b = u.begin(3)
  u.put(a, 0, b64('abc'))
  u.put(b, 0, b64('xyz'))
  u.put(a, 3, b64('def'))
  assert.equal(u.finish(a).toString(), 'abcdef')
  assert.equal(u.finish(b).toString(), 'xyz')
})

test('Uploads rejects out-of-range chunks, missing bytes and unknown ids', () => {
  const u = new Uploads()
  const id = u.begin(4)
  assert.throws(() => u.put(id, 3, b64('xy')))
  u.put(id, 0, b64('ab'))
  assert.throws(() => u.finish(id))
  assert.throws(() => u.put('nope', 0, b64('a')))
})
