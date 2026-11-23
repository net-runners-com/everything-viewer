// The contract of `editor/viewers/<name>.ts`: formats.json names a viewer per format, and the app
// loads that file and calls its default export.
import type { OutKind } from '../../src/registry'

export type Translate = (ja: string, en: string) => string

export type ViewContext = {
  root: HTMLElement
  t: Translate
  /** The file's suffix, lower case (a text format's first suffix: text documents carry no name). */
  ext: string
  /** formats.json `options` for this format. */
  options: Record<string, any>
  /** Text documents: the file's text. */
  text?: string
  /** Bytes documents: the converted output when the format converts, else the file's own bytes. */
  data?: Uint8Array
  /** What `data` was converted to, when it was. */
  output?: OutKind
  /** Runs the format's `fallback` converters; present only when formats.json lists some. */
  fallback?: () => Promise<{ data: Uint8Array; output: OutKind }>
}

/** Shows the document in `ctx.root`. Throwing shows the error in the tab. */
export type View = (ctx: ViewContext) => void | Promise<void>
