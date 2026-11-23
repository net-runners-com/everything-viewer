import { assert, test } from 'orca/testing'
import { blenderArgs, exportScript } from './blender'
import { ffmpegArgs } from './ffmpeg'
import { sofficeArgs } from './libreoffice'
import { sipsArgs } from './sips'

test('libreoffice uses its own profile and converts to pdf', () => {
  assert.deepEqual(sofficeArgs('/in/a.doc', '/out', '/c/lo-profile'), [
    '-env:UserInstallation=file:///c/lo-profile', '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', '/out', '/in/a.doc'
  ])
})

test('blender opens a .blend as the scene and imports other formats', () => {
  assert.deepEqual(blenderArgs('/in/a.blend', '/o.glb', '/s.py', true), ['-b', '--factory-startup', '/in/a.blend', '--python', '/s.py', '--', '/in/a.blend', '/o.glb'])
  assert.deepEqual(blenderArgs('/in/a.stl', '/o.glb', '/s.py', false), ['-b', '--factory-startup', '--python', '/s.py', '--', '/in/a.stl', '/o.glb'])
  assert.ok(exportScript('stl').includes('bpy.ops.wm.stl_import(filepath=src)'))
  assert.ok(!exportScript('blend').includes('import(filepath'))
})

test('sips writes png and ffmpeg writes web-playable mp4', () => {
  assert.deepEqual(sipsArgs('/in/a.heic', '/o.png'), ['-s', 'format', 'png', '/in/a.heic', '--out', '/o.png'])
  const f = ffmpegArgs('/in/a.avi', '/o.mp4')
  assert.equal(f[f.indexOf('-i') + 1], '/in/a.avi')
  assert.equal(f[f.length - 1], '/o.mp4')
  assert.ok(f.includes('libx264') && f.includes('aac') && f.includes('+faststart'))
})
