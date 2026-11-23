// Shows a GLB with the vendored three.js: orbit/zoom/pan, a floor grid, framed to the model.
import * as THREE from '../vendor/three/three.module.min.js'
import { GLTFLoader } from '../vendor/three/GLTFLoader.js'
import { OrbitControls } from '../vendor/three/OrbitControls.js'

import type { Translate, View } from '../lib/view'

const cssColor = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

async function showGlb(root: HTMLElement, data: Uint8Array, t: Translate): Promise<void> {
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')

  root.replaceChildren()
  const bar = document.createElement('div')
  bar.className = 'bar'
  const info = document.createElement('span')
  info.className = 'muted'
  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  const reset = document.createElement('button')
  reset.textContent = t('視点リセット', 'Reset view')
  bar.append(info, spacer, reset)
  const stage = document.createElement('div')
  stage.className = 'stage'
  root.append(bar, stage)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  stage.append(renderer.domElement)

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2.5)
  sun.position.set(3, 6, 4)
  scene.add(sun)
  const model = gltf.scene
  scene.add(model)

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const radius = Math.max(size.length() / 2, 0.001)
  const gridSize = Math.max(1, Math.ceil(Math.max(size.x, size.z) * 2))
  const grid = new THREE.GridHelper(gridSize, Math.min(100, gridSize * 2))
  grid.position.y = box.isEmpty() ? 0 : box.min.y
  scene.add(grid)

  let triangles = 0
  model.traverse((o: any) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3
    }
  })
  const fmt = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(3))
  info.textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} m · ${Math.round(triangles).toLocaleString()} ${t('ポリゴン', 'triangles')}`

  const camera = new THREE.PerspectiveCamera(45, 1, radius / 100, radius * 100)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  const home = () => {
    const dist = radius / Math.sin((camera.fov * Math.PI) / 360)
    camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist))
    controls.target.copy(center)
    controls.update()
  }
  reset.onclick = home
  home()

  const theme = () => {
    scene.background = new THREE.Color(cssColor('--orca-background', '#1e1e1e'))
    // --orca-border is often rgba(); three.js colors take rgb only, so fade the grid with opacity.
    const [r, g, b, a = '1'] = (cssColor('--orca-border', 'rgb(68,68,68)').match(/[\d.]+/g) ?? ['68', '68', '68'])
    const mat = grid.material as any
    mat.color = new THREE.Color(`rgb(${r},${g},${b})`)
    mat.transparent = true
    mat.opacity = Math.max(0.25, Number(a))
  }
  theme()
  orca.on('theme', theme)

  const resize = () => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    if (!w || !h) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  new ResizeObserver(resize).observe(stage)
  resize()
  renderer.setAnimationLoop(() => {
    controls.update()
    renderer.render(scene, camera)
  })
}

const view: View = (ctx) => showGlb(ctx.root, ctx.data!, ctx.t)
export default view
