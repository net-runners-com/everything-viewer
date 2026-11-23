# Convert Viewer

Read-only Orca editors for files nothing else in Orca shows. Orca's own viewers and the installed
plugins (Word, Spreadsheet, Media, Audio, Image, Font, 3D, Markdown) cover the rest,
so this plugin leaves those alone.

| Format | Suffixes | How |
| --- | --- | --- |
| Legacy Office, OpenDocument, Visio, Publisher, Works, Pages, Numbers | `.doc .ppt .odt .vsd .pub .pages .numbers …` | LibreOffice → PDF, shown with pdf.js |
| PowerPoint (replaces the Presentation Viewer plugin, which has no page toolbar; it is disabled) | `.pptx .pptm .ppsx .ppsm .potx .potm` | LibreOffice → PDF, with page / zoom toolbar |
| Blender | `.blend .abc` | Blender → GLB, shown with three.js |
| JPEG 2000 | `.jp2` | sips → PNG |
| Older video / audio | `.wmv .flv .mpg .vob … / .aiff .wma .amr …` | ffmpeg → MP4 |
| Data | `.json .jsonc .yaml .toml .xml .plist` | collapsible, filterable tree (in the view toggle beside Source) |

## Adding a format

Everything is driven by **`formats.json`**:

- `formats[]`: `extensions`, `content` (`bytes`/`text`), `priority`, `viewer` (a file in
  `editor/viewers/`), optional `convert` / `fallback` (converter ids) and `options` passed to the viewer.
- `converters{}`: per converter its `output`, install `candidates` (`~/` = home), `requires` and the
  `missing` hint. The command line lives in `src/converters/<id>.ts`.

After editing it, regenerate what Orca reads statically (manifest editors and entries):

```sh
node --experimental-strip-types scripts/gen.ts
orca plugin test .    # also fails if the manifest is out of date
```

A new viewer is `editor/viewers/<name>.ts` default-exporting a `View` (`editor/lib/view.ts`); a new
converter is `src/converters/<id>.ts` default-exporting a `Converter` (`src/converters/types.ts`).

## How it works

The editor frame uploads the file to the plugin's worker in base64 chunks (requests are capped at
64 KiB in, 1 MiB out, and rate-limited, so the first open of a large file takes a while — about
0.5 MB/s). The worker runs the converters in a background job into
`~/Library/Caches/orca-convert-viewer/<sha256>.<output>` (pruned to 2 GiB / 30 days), so reopening is
instant. Files over Orca's 64 MiB editor cap don't open.

Vendored under `editor/vendor/`: pdf.js 4.10.38 (Apache-2.0), three.js 0.170.0 (MIT),
js-yaml 4.1.0 (MIT), smol-toml 1.3.4 (BSD-3-Clause).
