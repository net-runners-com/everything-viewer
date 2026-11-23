import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker, type ExecFn, type Tools } from './worker'

const TOOLS: Tools = { soffice: () => '/bin/soffice', blender: () => '/bin/blender' }

/** Pretends to be soffice/Blender: writes `output` where the real tool would. */
function fakeExec(output: Buffer | null) {
  const calls: { cmd: string; args: string[] }[] = []
  const fn: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args })
    if (output) {
      if (cmd === '/bin/soffice') {
        const input = args[args.length - 1]
        const outDir = args[args.indexOf('--outdir') + 1]
        writeFileSync(join(outDir, basename(input, extname(input)) + '.pdf'), output)
      } else {
        writeFileSync(args[args.length - 1], output)
      }
    }
    return { stdout: '' }
  }
  return { fn, calls }
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function mount(exec: ExecFn, tools: Tools = TOOLS) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'cv-test-'))
  return mountWorker({ default: createWorker({ exec, cacheDir, tools }) }, { host: mockHost({}) })
}

async function upload(worker: Awaited<ReturnType<typeof mount>>, bytes: Buffer, ext: string) {
  const { id } = await worker.request('upload.begin', { size: bytes.length })
  for (let off = 0; off < bytes.length; off += 4) {
    await worker.request('upload.chunk', { id, offset: off, b64: bytes.subarray(off, off + 4).toString('base64') })
  }
  return worker.request('upload.finish', { id, hash: sha(bytes), ext })
}

test('a document converts once, then is served from the cache in chunks', async () => {
  const pdf = Buffer.alloc(1_200_000, 7)
  const exec = fakeExec(pdf)
  const worker = await mount(exec.fn)
  const input = Buffer.from('fake .doc bytes')
  const hash = sha(input)

  assert.deepEqual(await worker.request('convert.lookup', { hash, kind: 'pdf' }), { ready: false })
  const done = await upload(worker, input, 'doc')
  assert.deepEqual(done, { ready: true, size: pdf.length })
  assert.equal(exec.calls[0].cmd, '/bin/soffice')

  assert.deepEqual(await worker.request('convert.lookup', { hash, kind: 'pdf' }), { ready: true, size: pdf.length })
  const first = await worker.request('convert.read', { hash, kind: 'pdf', offset: 0 })
  assert.equal(first.eof, false)
  const firstBytes = Buffer.from(first.b64, 'base64')
  const second = await worker.request('convert.read', { hash, kind: 'pdf', offset: firstBytes.length })
  assert.equal(second.eof, true)
  assert.ok(Buffer.concat([firstBytes, Buffer.from(second.b64, 'base64')]).equals(pdf))
  await worker.deactivate()
})

test('a .blend file goes through Blender to glb', async () => {
  const exec = fakeExec(Buffer.from('glTF'))
  const worker = await mount(exec.fn)
  const done = await upload(worker, Buffer.from('BLENDER-v500'), 'blend')
  assert.deepEqual(done, { ready: true, size: 4 })
  assert.equal(exec.calls[0].cmd, '/bin/blender')
  assert.equal(extname(exec.calls[0].args[exec.calls[0].args.length - 1]), '.glb')
  await worker.deactivate()
})

test('a missing converter reports not_found with no exec', async () => {
  const exec = fakeExec(Buffer.from('x'))
  const worker = await mount(exec.fn, { soffice: () => null, blender: () => null })
  const done = await upload(worker, Buffer.from('doc'), 'doc')
  assert.ok('error' in done)
  assert.equal(done.error.kind, 'not_found')
  assert.equal(exec.calls.length, 0)
  await worker.deactivate()
})

test('a converter that writes nothing is a failure, not a hang', async () => {
  const worker = await mount(fakeExec(null).fn)
  const done = await upload(worker, Buffer.from('doc'), 'doc')
  assert.ok('error' in done)
  assert.equal(done.error.kind, 'failed')
  await worker.deactivate()
})

test('an upload whose bytes do not match the hash is refused', async () => {
  const worker = await mount(fakeExec(Buffer.from('x')).fn)
  const { id } = await worker.request('upload.begin', { size: 3 })
  await worker.request('upload.chunk', { id, offset: 0, b64: Buffer.from('abc').toString('base64') })
  const done = await worker.request('upload.finish', { id, hash: 'f'.repeat(64), ext: 'doc' })
  assert.ok('error' in done)
  assert.equal(done.error.kind, 'bad_request')
  await worker.deactivate()
})

test('an unsupported extension is refused', async () => {
  const worker = await mount(fakeExec(Buffer.from('x')).fn)
  const done = await upload(worker, Buffer.from('abc'), 'docx')
  assert.ok('error' in done)
  assert.equal(done.error.kind, 'bad_request')
  await worker.deactivate()
})
