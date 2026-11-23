# Convert Viewer

Read-only Orca editor for files no other viewer opens:

- **Document** — `.doc .dot .ppt .pps .pot .odt .ott .odp .otp .odg .otg .vsd .vsdx .pub .wpd .wps .key .pages .numbers`, converted to PDF by LibreOffice and shown with pdf.js.
- **Blender** — `.blend`, exported to GLB by Blender and shown with three.js (orbit, zoom, pan, floor grid).

The editor frame uploads the file to the plugin's worker in base64 chunks (requests are capped at
64 KiB in, 1 MiB out); the worker converts it into `~/Library/Caches/orca-convert-viewer/<sha256>.<pdf|glb>`
so reopening is instant. Needs `/Applications/LibreOffice.app` (or `soffice` from Homebrew) and
`/Applications/Blender.app`. Files over Orca's 64 MiB editor cap don't open.

```sh
orca plugin test .
orca plugin check .
orca plugin dev load .   # prints the --approve fingerprint
```

Vendored: pdf.js 4.10.38 (Apache-2.0), three.js 0.170.0 (MIT) under `editor/vendor/`.
