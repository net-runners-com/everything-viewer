// sips (built into macOS): TIFF, HEIC, PSD, JPEG 2000 and other images to PNG.
import { MIN, type Converter } from './types'

export function sipsArgs(input: string, out: string): string[] {
  return ['-s', 'format', 'png', input, '--out', out]
}

const converter: Converter = {
  async run({ src, out, tool, exec }) {
    await exec(tool, sipsArgs(src, out), { timeoutMs: MIN })
    return out
  }
}
export default converter
