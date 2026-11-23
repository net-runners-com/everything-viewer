// LibreOffice: Office, OpenDocument, Visio, Publisher, Works and iWork files to PDF.
import { join } from 'node:path'
import { MIN, type Converter } from './types'

/** A private profile keeps a LibreOffice window the user has open from blocking the conversion. */
export function sofficeArgs(input: string, outDir: string, profileDir: string): string[] {
  return [`-env:UserInstallation=file://${profileDir}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, input]
}

const converter: Converter = {
  async run({ src, dir, tool, cacheDir, exec }) {
    await exec(tool, sofficeArgs(src, dir, join(cacheDir, 'lo-profile')), { timeoutMs: 2 * MIN })
    return join(dir, 'in.pdf') // soffice names the output after the input
  }
}
export default converter
