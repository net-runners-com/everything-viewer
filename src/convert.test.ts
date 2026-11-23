import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { Uploads, pruneCache } from './convert'

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
