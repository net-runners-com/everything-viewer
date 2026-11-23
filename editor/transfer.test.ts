import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createWorker, type ExecFn } from '../src/worker'
import { ConvertError, convertBytes, type RequestFn } from './transfer'

async function setup(pdf: Buffer | null) {
  const exec: ExecFn = async (_cmd, args) => {
    const outDir = args[args.indexOf('--outdir') + 1]
    if (pdf) writeFileSync(join(outDir, 'in.pdf'), pdf)
    return { stdout: '' }
  }
  const cacheDir = mkdtempSync(join(tmpdir(), 'cv-tr-'))
  const worker = await mountWorker(
    { default: createWorker({ exec, cacheDir, tools: { soffice: () => '/bin/soffice', blender: () => null } }) },
    { host: mockHost({}) }
  )
  const methods: string[] = []
  const request: RequestFn = (method, input) => {
    methods.push(method)
    // The real bridge refuses inputs over 64 KiB; enforce it here too.
    assert.ok(JSON.stringify(input).length < 64 * 1024, `${method} input too large`)
    return worker.request(method as never, input as never) as Promise<never>
  }
  return { worker, request, methods }
}

test('a 200 KB document uploads in chunks, converts, and downloads intact', async () => {
  const pdf = Buffer.alloc(1_500_000, 3)
  const { worker, request, methods } = await setup(pdf)
  const input = new Uint8Array(200_000).map((_, i) => i % 251)
  const phases = new Set<string>()
  const out = await convertBytes(input.buffer, 'doc', request, (p) => phases.add(p))
  assert.equal(out.kind, 'pdf')
  assert.ok(Buffer.from(out.data).equals(pdf))
  assert.ok(methods.filter((m) => m === 'upload.chunk').length >= 5)
  assert.deepEqual([...phases], ['upload', 'convert', 'download'])

  methods.length = 0
  await convertBytes(input.buffer, 'doc', request)
  assert.ok(!methods.some((m) => m.startsWith('upload.')), 'second open is a cache hit')
  await worker.deactivate()
})

test('a conversion error surfaces as ConvertError', async () => {
  const { worker, request } = await setup(null)
  let caught: unknown
  try {
    await convertBytes(new Uint8Array([1, 2, 3]).buffer, 'doc', request)
  } catch (e) {
    caught = e
  }
  assert.ok(caught instanceof ConvertError)
  assert.equal((caught as ConvertError).kind, 'failed')
  await worker.deactivate()
})

test('rate_limited calls wait retryAfterMs and retry', async () => {
  const { worker, request } = await setup(Buffer.from('%PDF'))
  let limited = 0
  const flaky: RequestFn = (method, input, opts) => {
    if (method === 'upload.chunk' && limited < 3) {
      limited++
      return Promise.reject(Object.assign(new Error('Too many requests.'), { code: 'rate_limited', retryAfterMs: 5 }))
    }
    return request(method, input, opts)
  }
  const out = await convertBytes(new Uint8Array(100_000).buffer, 'doc', flaky)
  assert.equal(limited, 3)
  assert.equal(Buffer.from(out.data).toString(), '%PDF')
  await worker.deactivate()
})
