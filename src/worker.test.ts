import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker, type ExecFn, type Tools } from './worker'

const TOOLS: Tools = {
  soffice: () => '/bin/soffice',
  blender: () => '/bin/blender',
  ffmpeg: () => '/bin/ffmpeg',
  sips: () => '/bin/sips',
  keynote: () => '/bin/osascript'
}

type Call = { cmd: string; args: string[] }

/** Pretends to be each converter: writes `output` where the real tool would. */
function fakeExec(output: Buffer | null, opts: { failCmd?: string; gate?: Promise<void> } = {}) {
  const calls: Call[] = []
  const fn: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args })
    await opts.gate
    if (cmd === opts.failCmd) throw Object.assign(new Error('boom'), { toolError: { kind: 'failed', message: 'boom' } })
    if (!output) return { stdout: '' }
    if (cmd === '/bin/soffice') {
      const input = args[args.length - 1]
      const outDir = args[args.indexOf('--outdir') + 1]
      writeFileSync(join(outDir, basename(input, extname(input)) + '.pdf'), output)
    } else if (cmd === '/bin/sips') {
      writeFileSync(args[args.indexOf('--out') + 1], output)
    } else {
      writeFileSync(args[args.length - 1], output)
    }
    return { stdout: '' }
  }
  return { fn, calls }
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function mount(exec: ExecFn, tools: Tools = TOOLS) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'cv-test-'))
  const worker = await mountWorker({ default: createWorker({ exec, cacheDir, tools }) }, { host: mockHost({}) })
  return { worker, cacheDir }
}

type W = Awaited<ReturnType<typeof mount>>['worker']

async function upload(worker: W, bytes: Buffer, ext: string, kind: string) {
  const { id } = await worker.request('upload.begin', { size: bytes.length })
  for (let off = 0; off < bytes.length; off += 4) {
    await worker.request('upload.chunk', { id, offset: off, b64: bytes.subarray(off, off + 4).toString('base64') })
  }
  return worker.request('upload.finish', { id, hash: sha(bytes), ext, kind: kind as never })
}

async function settle(worker: W, hash: string, kind: string) {
  for (let i = 0; i < 200; i++) {
    const s = await worker.request('convert.lookup', { hash, kind: kind as never })
    if (s.state !== 'running') return s
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('job never finished')
}

test('a document converts in the background, then is served from the cache in chunks', async () => {
  const pdf = Buffer.alloc(1_200_000, 7)
  let open!: () => void
  const exec = fakeExec(pdf, { gate: new Promise<void>((r) => (open = r)) })
  const { worker } = await mount(exec.fn)
  const input = Buffer.from('fake .doc bytes')
  const hash = sha(input)

  assert.deepEqual(await worker.request('convert.lookup', { hash, kind: 'pdf' }), { state: 'missing' })
  assert.deepEqual(await upload(worker, input, 'doc', 'pdf'), { state: 'running' })
  assert.deepEqual(await worker.request('convert.lookup', { hash, kind: 'pdf' }), { state: 'running' })
  open()
  assert.deepEqual(await settle(worker, hash, 'pdf'), { state: 'ready', size: pdf.length })
  assert.equal(exec.calls[0].cmd, '/bin/soffice')

  const first = await worker.request('convert.read', { hash, kind: 'pdf', offset: 0 })
  assert.equal(first.eof, false)
  const firstBytes = Buffer.from(first.b64, 'base64')
  const second = await worker.request('convert.read', { hash, kind: 'pdf', offset: firstBytes.length })
  assert.equal(second.eof, true)
  assert.ok(Buffer.concat([firstBytes, Buffer.from(second.b64, 'base64')]).equals(pdf))
  await worker.deactivate()
})

test('each format reaches its converter', async () => {
  const exec = fakeExec(Buffer.from('out'))
  const { worker } = await mount(exec.fn)
  const cases: [string, string, string][] = [
    ['blend', 'glb', '/bin/blender'],
    ['stl', 'glb', '/bin/blender'],
    ['heic', 'png', '/bin/sips'],
    ['avi', 'mp4', '/bin/ffmpeg'],
    ['mp4', 'mp4', '/bin/ffmpeg'], // fallback for a codec the browser can't play
    ['key', 'pdf', '/bin/osascript']
  ]
  for (const [ext, kind, cmd] of cases) {
    const input = Buffer.from(`sample ${ext}`)
    await upload(worker, input, ext, kind)
    assert.equal((await settle(worker, sha(input), kind)).state, 'ready', ext)
    assert.equal(exec.calls[exec.calls.length - 1].cmd, cmd, ext)
  }
  await worker.deactivate()
})

test('a Keynote export that fails falls back to LibreOffice', async () => {
  const exec = fakeExec(Buffer.from('%PDF'), { failCmd: '/bin/osascript' })
  const { worker } = await mount(exec.fn)
  const input = Buffer.from('keynote')
  await upload(worker, input, 'key', 'pdf')
  assert.equal((await settle(worker, sha(input), 'pdf')).state, 'ready')
  assert.deepEqual(exec.calls.map((c) => c.cmd), ['/bin/osascript', '/bin/soffice'])
  await worker.deactivate()
})

test('a missing converter reports not_found with no exec', async () => {
  const exec = fakeExec(Buffer.from('x'))
  const none = () => null
  const { worker } = await mount(exec.fn, { soffice: none, blender: none, ffmpeg: none, sips: none, keynote: none })
  const input = Buffer.from('doc')
  await upload(worker, input, 'doc', 'pdf')
  const s = await settle(worker, sha(input), 'pdf')
  assert.ok(s.state === 'error')
  assert.equal(s.error.kind, 'not_found')
  assert.equal(exec.calls.length, 0)
  await worker.deactivate()
})

test('a converter that writes nothing is a failure, not a hang', async () => {
  const { worker } = await mount(fakeExec(null).fn)
  const input = Buffer.from('doc')
  await upload(worker, input, 'doc', 'pdf')
  const s = await settle(worker, sha(input), 'pdf')
  assert.ok(s.state === 'error')
  assert.equal(s.error.kind, 'failed')
  await worker.deactivate()
})

test('an upload whose bytes do not match the hash is refused', async () => {
  const { worker } = await mount(fakeExec(Buffer.from('x')).fn)
  const { id } = await worker.request('upload.begin', { size: 3 })
  await worker.request('upload.chunk', { id, offset: 0, b64: Buffer.from('abc').toString('base64') })
  const done = await worker.request('upload.finish', { id, hash: 'f'.repeat(64), ext: 'doc', kind: 'pdf' })
  assert.ok(done.state === 'error')
  assert.equal(done.error.kind, 'bad_request')
  await worker.deactivate()
})

test('a format/converter pair the table does not allow is refused', async () => {
  const { worker } = await mount(fakeExec(Buffer.from('x')).fn)
  const done = await upload(worker, Buffer.from('abc'), 'png', 'mp4')
  assert.ok(done.state === 'error')
  assert.equal(done.error.kind, 'bad_request')
  await worker.deactivate()
})
