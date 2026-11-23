import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { Uploads, blenderArgs, ffmpegArgs, keynoteArgs, pruneCache, sipsArgs, sofficeArgs } from './convert'

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

test('blenderArgs opens a .blend directly and imports anything else', () => {
  assert.deepEqual(blenderArgs('/in/a.blend', '/out/a.glb', '/c/x.py'), [
    '-b', '--factory-startup', '/in/a.blend', '--python', '/c/x.py', '--', '/in/a.blend', '/out/a.glb'
  ])
  assert.deepEqual(blenderArgs('/in/a.stl', '/out/a.glb', '/c/x.py'), [
    '-b', '--factory-startup', '--python', '/c/x.py', '--', '/in/a.stl', '/out/a.glb'
  ])
})

test('sipsArgs and ffmpegArgs write png and web-playable mp4', () => {
  assert.deepEqual(sipsArgs('/in/a.heic', '/out/a.png'), ['-s', 'format', 'png', '/in/a.heic', '--out', '/out/a.png'])
  const f = ffmpegArgs('/in/a.avi', '/out/a.mp4')
  assert.equal(f[f.indexOf('-i') + 1], '/in/a.avi')
  assert.equal(f[f.length - 1], '/out/a.mp4')
  assert.ok(f.includes('libx264') && f.includes('aac') && f.includes('+faststart'))
})

test('keynoteArgs passes the paths as osascript arguments, not inside the script', () => {
  const a = keynoteArgs('/in/a "x".key', '/out/a.pdf')
  assert.deepEqual(a.slice(-2), ['/in/a "x".key', '/out/a.pdf'])
  assert.ok(!a.slice(0, -2).join('\n').includes('/in/'))
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

test('Uploads drops uploads left idle for 10 minutes', () => {
  let now = 0
  const u = new Uploads(() => now)
  const old = u.begin(3)
  now = 11 * 60_000
  const fresh = u.begin(1)
  assert.throws(() => u.put(old, 0, b64('abc')))
  u.put(fresh, 0, b64('z'))
  assert.equal(u.size, 1)
})

test('pruneCache removes outputs past maxAge, then the oldest past maxBytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cv-prune-'))
  const day = 86_400_000
  const now = 100 * day
  const put = (name: string, size: number, ageDays: number) => {
    writeFileSync(join(dir, name), Buffer.alloc(size))
    const t = (now - ageDays * day) / 1000
    utimesSync(join(dir, name), t, t)
  }
  const h = (c: string) => c.repeat(64)
  put(`${h('a')}.pdf`, 10, 40) // too old
  put(`${h('b')}.pdf`, 60, 5) // oldest of the rest -> over the cap
  put(`${h('c')}.mp4`, 50, 1)
  put(`${h('d')}.glb`, 40, 0)
  put('notes.txt', 999, 99) // not ours: never touched
  const removed = pruneCache(dir, { maxBytes: 100, maxAgeMs: 30 * day, now })
  assert.deepEqual(removed.sort(), [`${h('a')}.pdf`, `${h('b')}.pdf`])
  assert.deepEqual(readdirSync(dir).sort(), [`${h('c')}.mp4`, `${h('d')}.glb`, 'notes.txt'])
})
