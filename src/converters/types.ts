// The contract of `src/converters/<id>.ts`, the code half of a converter named in formats.json.

export type ExecFn = (cmd: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<{ stdout: string }>

export type ConvertJob = {
  /** The uploaded file, named `in.<ext>`. */
  src: string
  ext: string
  /** Scratch folder for this job; removed afterwards. */
  dir: string
  /** Where the converter should write its output (`<dir>/out.<output>`). */
  out: string
  /** The tool's path, as `locate` found it. */
  tool: string
  /** The plugin cache folder, for state a tool keeps between runs (LibreOffice's profile). */
  cacheDir: string
  exec: ExecFn
}

/** A converter file's default export: runs the tool and resolves with the file it wrote.
 *  Its label, output kind and install paths live in formats.json under `converters`. */
export type Converter = { run(job: ConvertJob): Promise<string> }

export const MIN = 60_000
