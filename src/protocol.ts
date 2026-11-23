// The editor frame <-> worker contract. Inputs are capped at 64 KiB and answers at 1 MiB, so file
// bytes travel as base64 chunks; conversions run as background jobs the frame polls.
import type { OutKind } from './formats'

export type ToolError = { kind: 'not_found' | 'failed' | 'timeout' | 'bad_request'; message: string }
export type JobState =
  | { state: 'missing' }
  | { state: 'running' }
  | { state: 'ready'; size: number }
  | { state: 'error'; error: ToolError }

/** Raw bytes per upload chunk (base64 grows it to 60 000 chars, under the 64 KiB input cap). */
export const UPLOAD_CHUNK = 45_000
/** Raw bytes per download answer (base64 ≈ 933 KB, under the 1 MiB answer cap). */
export const DOWNLOAD_CHUNK = 700_000

declare module 'orca' {
  interface PluginRequests {
    /** Where `hash` stands for `kind`: never seen, converting, ready, or failed. */
    'convert.lookup': { input: { hash: string; kind: OutKind }; output: JobState }
    'upload.begin': { input: { size: number }; output: { id: string } }
    'upload.chunk': { input: { id: string; offset: number; b64: string }; output: { ok: true } }
    /** Assembles the upload, checks its SHA-256 and starts converting it to `kind`. */
    'upload.finish': { input: { id: string; hash: string; ext: string; kind: OutKind }; output: JobState }
    /** Up to DOWNLOAD_CHUNK bytes of the converted file from `offset`. */
    'convert.read': { input: { hash: string; kind: OutKind; offset: number }; output: { b64: string; eof: boolean } }
  }
  interface PluginPanelEvents {}
}
