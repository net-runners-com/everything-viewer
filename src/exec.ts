// The only place that touches the OS: runs converters and finds them on this Mac.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ToolError } from './protocol'
import type { ExecFn, Tools } from './worker'

export class ToolFailure extends Error {
  toolError: ToolError
  constructor(toolError: ToolError) {
    super(toolError.message)
    this.toolError = toolError
  }
}

export const runTool: ExecFn = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts?.timeoutMs ?? 110_000, maxBuffer: 16 * 1024 * 1024, signal: opts?.signal },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout: stdout.toString() })
        const e = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
        if (e.code === 'ENOENT') return reject(new ToolFailure({ kind: 'not_found', message: `${cmd} not found` }))
        if (e.killed || e.signal === 'SIGTERM') {
          return reject(new ToolFailure({ kind: 'timeout', message: `${cmd} took too long` }))
        }
        const tail = (stderr || error.message).toString().trim().split('\n').slice(-6).join('\n')
        reject(new ToolFailure({ kind: 'failed', message: tail }))
      }
    )
  })

const first = (paths: string[]) => () => paths.find((p) => existsSync(p)) ?? null

export const macTools: Tools = {
  soffice: first([
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
    '/usr/local/bin/soffice'
  ]),
  blender: first(['/Applications/Blender.app/Contents/MacOS/Blender', '/opt/homebrew/bin/blender'])
}
