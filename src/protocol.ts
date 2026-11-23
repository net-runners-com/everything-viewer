// The editor frame <-> worker contract. Inputs are capped at 64 KiB and answers at 1 MiB, so file
// bytes travel as base64 chunks; conversions run as background jobs the frame polls. A conversion is
// named by the file's hash, its suffix and the stage (formats.json `convert` or `fallback`).
import type { Stage } from './registry'

export type ToolError = { kind: 'not_found' | 'failed' | 'timeout' | 'bad_request'; message: string }
export type JobState =
  | { state: 'missing' }
  | { state: 'running'; label?: string }
  | { state: 'ready'; size: number }
  | { state: 'error'; error: ToolError }

export type JobKey = { hash: string; ext: string; stage: Stage }

/** Raw bytes per upload chunk (base64 grows it to 60 000 chars, under the 64 KiB input cap). */
export const UPLOAD_CHUNK = 45_000
/** Raw bytes per download answer (base64 ≈ 933 KB, under the 1 MiB answer cap). */
export const DOWNLOAD_CHUNK = 700_000

declare module 'orca' {
  interface PluginRequests {
    /** Where this conversion stands: never seen, running, ready, or failed. */
    'convert.lookup': { input: JobKey; output: JobState }
    'upload.begin': { input: { size: number }; output: { id: string } }
    'upload.chunk': { input: { id: string; offset: number; b64: string }; output: { ok: true } }
    /** Assembles the upload, checks its SHA-256 and starts the stage's converters. */
    'upload.finish': { input: JobKey & { id: string }; output: JobState }
    /** Up to DOWNLOAD_CHUNK bytes of the converted file from `offset`. */
    'convert.read': { input: JobKey & { offset: number }; output: { b64: string; eof: boolean } }
  }
  interface PluginPanelEvents {}
}
