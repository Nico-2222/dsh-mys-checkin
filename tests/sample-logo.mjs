import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const png = PNG.sync.read(readFileSync(new URL('../lib/assets/miyoushe.png', import.meta.url)))
const at = (x, y) => { const i = (png.width * y + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] }
const hex = (c) => '#' + c.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('')
console.log('size', png.width, png.height)
for (const [name, x, y] of [['icon-fill', 60, 40], ['text-blue', 200, 40], ['sub-text', 200, 120], ['corner', 5, 5], ['icon-white', 100, 100]]) {
  console.log(name, hex(at(x, y)), JSON.stringify(at(x, y)))
}
// dominant opaque colors, quantised
const counts = new Map()
for (let y = 0; y < png.height; y += 2) {
  for (let x = 0; x < png.width; x += 2) {
    const [r, g, b, a] = at(x, y)
    if (a < 200) continue
    const key = `${r >> 4}.${g >> 4}.${b >> 4}`
    const prev = counts.get(key) ?? { n: 0, r, g, b }
    counts.set(key, { n: prev.n + 1, r, g, b })
  }
}
console.log([...counts.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((c) => `${c.n} ${hex([c.r, c.g, c.b])}`).join('\n'))
