# Everything Viewer

An [Orca](https://orca.dev) plugin that opens the files Orca can't show on its own. It is read-only,
runs on macOS, and converts with tools already on your Mac.

| Format | Suffixes | How it is shown |
| --- | --- | --- |
| Legacy Office, OpenDocument, Visio, Publisher, Works, Pages, Numbers | `.doc .dot .ppt .pps .pot .odt .ott .odp .otp .odg .otg .vsd .vsdx .pub .wpd .wps .pages .numbers` | LibreOffice → PDF, as pages with a page / zoom toolbar |
| PowerPoint | `.pptx .pptm .ppsx .ppsm .potx .potm` | LibreOffice → PDF, as pages with a page / zoom toolbar |
| Blender | `.blend .abc` | Blender → GLB, orbit / zoom / pan with a floor grid |
| JPEG 2000 | `.jp2` | `sips` → PNG |
| Older video and audio | `.wmv .flv .mpg .mpeg .3gp .mts .m2ts .vob .aiff .aif .caf .wma .amr` | ffmpeg → MP4 (H.264 / AAC) |
| Data | `.json .jsonc .geojson .yaml .yml .toml .xml .plist` | Collapsible, filterable tree, in the view toggle beside Source |

Formats Orca or common catalog plugins already show (images, PDF, Markdown, CSV, modern media,
fonts, Word/Excel, 3D meshes) are deliberately left out so the view toggle has no duplicates.

## Requirements

- macOS and the Orca desktop app (1.4.248 or newer)
- [LibreOffice](https://www.libreoffice.org) for documents and presentations: `brew install --cask libreoffice`
- [Blender](https://www.blender.org) in `/Applications` for `.blend` / `.abc`
- [ffmpeg](https://ffmpeg.org) for older video and audio: `brew install ffmpeg`

A missing tool only affects its formats; the tab says which one to install.

## Adding a format

Everything is driven by [`formats.json`](formats.json):

- `formats[]`: `extensions`, `content` (`bytes` / `text`), `priority`, `viewer` (a file in
  `editor/viewers/`), optional `convert` / `fallback` (converter ids) and `options` for the viewer.
- `converters{}`: per converter its `output`, install `candidates` (`~/` = home), `requires` and the
  `missing` hint. The command line lives in `src/converters/<id>.ts`.

After editing it, regenerate what Orca reads statically (the manifest's editors and the entries):

```sh
node --experimental-strip-types scripts/gen.ts
orca plugin test .    # also fails when the manifest is out of date
```

A new viewer is `editor/viewers/<name>.ts` default-exporting a `View` (`editor/lib/view.ts`); a new
converter is `src/converters/<id>.ts` default-exporting a `Converter` (`src/converters/types.ts`).

## How it works

The editor frame uploads the file to the plugin's worker in base64 chunks (Orca caps requests at
64 KiB in and 1 MiB out, and rate-limits them, so the first open of a large file is slow — about
0.5 MB/s). The worker runs the converters in a background job and caches the output in
`~/Library/Caches/orca-everything-viewer/<sha256>.<output>` (pruned to 2 GiB / 30 days), so reopening
is instant. Files over Orca's 64 MiB editor limit don't open.

## Develop

```sh
orca plugin test .
orca plugin check .
orca plugin dev load .   # prints the --approve fingerprint
```

## License

MIT. Bundled third-party code under `editor/vendor/` keeps its own license: pdf.js 4.10.38
(Apache-2.0), three.js 0.170.0 (MIT), js-yaml 4.1.0 (MIT), smol-toml 1.3.4 (BSD-3-Clause).
