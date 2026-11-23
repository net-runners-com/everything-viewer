import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { Converter } from './converters/types'
import { createRegistry, type FormatsFile } from './registry'
import { createWorker } from './worker'

const FILE = JSON.parse(readFileSync(new URL('../formats.json', import.meta.url), 'utf8')) as FormatsFile
const registry = createRegistry(FILE)

/** Stand-in converters: each writes `output` to job.out and records that it ran. */
function fakeConverters(output: Buffer | null, failing: string[] = [], gate?: Promise<void>) {
  const ran: string[] = []
  const load = async (id: string): Promise<Converter> => ({
    async run(job) {
      ran.push(id)
      await gate
      if (failing.includes(id)) throw Object.assign(new Error('boom'), { toolError: { kind: 'failed', message: `${id} failed` } })
      if (output) writeFileSync(job.out, output)
      return job.out
    }
  })
  return { ran, load }
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const everywhere = () => '/bin/tool'

async function mount(loadConverter: (id: string) => Promise<Converter>, locate: (id: string) => string | null = everywhere) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'cv-test-'))
  const exec = async () => ({ stdout: '' })
  return mountWorker({ default: createWorker({ registry, exec, cacheDir, locate, loadConverter }) }, { host: mockHost({}) })
}
type W = Awaited<ReturnType<typeof mount>>

async function upload(worker: W, bytes: Buffer, ext: string, stage: 'convert' | 'fallback' = 'convert') {
  const { id } = await worker.request('upload.begin', { size: bytes.length })
  for (let off = 0; off < bytes.length; off += 4) {
    await worker.request('upload.chunk', { id, offset: off, b64: bytes.subarray(off, off + 4).toString('base64') })
  }
  return worker.request('upload.finish', { id, hash: sha(bytes), ext, stage })
}

async function settle(worker: W, hash: string, ext: string, stage: 'convert' | 'fallback' = 'convert') {
  for (let i = 0; i < 200; i++) {
    const s = await worker.request('convert.lookup', { hash, ext, stage })
    if (s.state !== 'running') return s
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('job never finished')
}

test('a document converts in the background, then is served from the cache in chunks', async () => {
  const pdf = Buffer.alloc(1_200_000, 7)
  let open!: () => void
  const conv = fakeConverters(pdf, [], new Promise<void>((r) => (open = r)))
  const worker = await mount(conv.load)
  const input = Buffer.from('fake .doc bytes')
  const hash = sha(input)

  assert.deepEqual(await worker.request('convert.lookup', { hash, ext: 'doc', stage: 'convert' }), { state: 'missing' })
  assert.deepEqual(await upload(worker, input, 'doc'), { state: 'running', label: 'LibreOffice' })
  assert.deepEqual(await worker.request('convert.lookup', { hash, ext: 'doc', stage: 'convert' }), { state: 'running', label: 'LibreOffice' })
  open()
  assert.deepEqual(await settle(worker, hash, 'doc'), { state: 'ready', size: pdf.length })
  assert.deepEqual(conv.ran, ['libreoffice'])

  const first = await worker.request('convert.read', { hash, ext: 'doc', stage: 'convert', offset: 0 })
  assert.equal(first.eof, false)
  const firstBytes = Buffer.from(first.b64, 'base64')
  const second = await worker.request('convert.read', { hash, ext: 'doc', stage: 'convert', offset: firstBytes.length })
  assert.equal(second.eof, true)
  assert.ok(Buffer.concat([firstBytes, Buffer.from(second.b64, 'base64')]).equals(pdf))
  await worker.deactivate()
})

test('formats.json decides which converter runs', async () => {
  const conv = fakeConverters(Buffer.from('out'))
  const worker = await mount(conv.load)
  const cases: [string, 'convert' | 'fallback', string][] = [
    ['blend', 'convert', 'blender'],
    ['abc', 'convert', 'blender'],
    ['jp2', 'convert', 'sips'],
    ['wmv', 'convert', 'ffmpeg'],
    ['aiff', 'convert', 'ffmpeg'],
    ['numbers', 'convert', 'libreoffice']
  ]
  for (const [ext, stage, id] of cases) {
    const input = Buffer.from(`sample ${ext}`)
    await upload(worker, input, ext, stage)
    assert.equal((await settle(worker, sha(input), ext, stage)).state, 'ready', ext)
    assert.equal(conv.ran[conv.ran.length - 1], id, ext)
  }
  await worker.deactivate()
})

/** A registry with a two-converter chain and a fallback stage, to exercise both. */
const chained = createRegistry({
  converters: {
    sips: FILE.converters.sips,
    libreoffice: { ...FILE.converters.libreoffice, output: 'png' },
    ffmpeg: FILE.converters.ffmpeg
  },
  formats: [
    { id: 'pic', extensions: ['pic'], content: 'bytes', priority: 'default', viewer: 'image', convert: ['sips', 'libreoffice'] },
    { id: 'clip', extensions: ['clip'], content: 'bytes', priority: 'default', viewer: 'media', fallback: ['ffmpeg'] }
  ]
})

async function mountWith(reg: typeof registry, loadConverter: (id: string) => Promise<Converter>, locate: (id: string) => string | null = everywhere) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'cv-test-'))
  return mountWorker({ default: createWorker({ registry: reg, exec: async () => ({ stdout: '' }), cacheDir, locate, loadConverter }) }, { host: mockHost({}) })
}

test('a failing converter falls through to the next one in the chain', async () => {
  const conv = fakeConverters(Buffer.from('png'), ['sips'])
  const worker = await mountWith(chained, conv.load)
  const input = Buffer.from('picture')
  await upload(worker, input, 'pic')
  assert.equal((await settle(worker, sha(input), 'pic')).state, 'ready')
  assert.deepEqual(conv.ran, ['sips', 'libreoffice'])
  await worker.deactivate()
})

test('the fallback stage runs only its own converters', async () => {
  const conv = fakeConverters(Buffer.from('mp4'))
  const worker = await mountWith(chained, conv.load)
  const input = Buffer.from('clip')
  assert.equal((await upload(worker, input, 'clip', 'convert')).state, 'error') // nothing to convert with
  await upload(worker, input, 'clip', 'fallback')
  assert.equal((await settle(worker, sha(input), 'clip', 'fallback')).state, 'ready')
  assert.deepEqual(conv.ran, ['ffmpeg'])
  await worker.deactivate()
})

test('an uninstalled converter is skipped; when none is installed the tab gets its install hint', async () => {
  const conv = fakeConverters(Buffer.from('png'))
  const worker = await mountWith(chained, conv.load, (id) => (id === 'libreoffice' ? '/bin/soffice' : null))
  const pic = Buffer.from('picture')
  await upload(worker, pic, 'pic')
  assert.equal((await settle(worker, sha(pic), 'pic')).state, 'ready')
  assert.deepEqual(conv.ran, ['libreoffice'])
  await worker.deactivate()

  const none = await mount(fakeConverters(Buffer.from('x')).load, () => null)
  const blend = Buffer.from('blend')
  await upload(none, blend, 'blend')
  const s = await settle(none, sha(blend), 'blend')
  assert.ok(s.state === 'error')
  assert.equal(s.error.kind, 'not_found')
  assert.equal(s.error.message, FILE.converters.blender.missing)
  await none.deactivate()
})

test('a converter that writes nothing is a failure, not a hang', async () => {
  const worker = await mount(fakeConverters(null).load)
  const input = Buffer.from('doc')
  await upload(worker, input, 'doc')
  const s = await settle(worker, sha(input), 'doc')
  assert.ok(s.state === 'error')
  assert.equal(s.error.kind, 'failed')
  await worker.deactivate()
})

test('an upload whose bytes do not match the hash is refused', async () => {
  const worker = await mount(fakeConverters(Buffer.from('x')).load)
  const { id } = await worker.request('upload.begin', { size: 3 })
  await worker.request('upload.chunk', { id, offset: 0, b64: Buffer.from('abc').toString('base64') })
  const done = await worker.request('upload.finish', { id, hash: 'f'.repeat(64), ext: 'doc', stage: 'convert' })
  assert.ok(done.state === 'error')
  assert.equal(done.error.kind, 'bad_request')
  await worker.deactivate()
})

test('a format with nothing to run for that stage is refused', async () => {
  const worker = await mount(fakeConverters(Buffer.from('x')).load)
  const done = await upload(worker, Buffer.from('abc'), 'json')
  assert.ok(done.state === 'error')
  assert.equal(done.error.kind, 'bad_request')
  await worker.deactivate()
})
