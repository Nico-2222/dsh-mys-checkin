// Build the 180x180 storefront tile with pngjs: wordmark centred on white.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { PNG } from 'pngjs'

const src = PNG.sync.read(readFileSync('lib/assets/miyoushe.png'))
const size = 180
const canvas = new PNG({ width: size, height: size })
for (let i = 0; i < canvas.data.length; i += 4) {
  canvas.data[i] = 255
  canvas.data[i + 1] = 255
  canvas.data[i + 2] = 255
  canvas.data[i + 3] = 255
}

const scale = Math.min(150 / src.width, 100 / src.height)
const w = Math.round(src.width * scale)
const h = Math.round(src.height * scale)
const ox = Math.round((size - w) / 2)
const oy = Math.round((size - h) / 2)

for (let y = 0; y < h; y += 1) {
  for (let x = 0; x < w; x += 1) {
    const sx = Math.min(src.width - 1, Math.floor((x / w) * src.width))
    const sy = Math.min(src.height - 1, Math.floor((y / h) * src.height))
    const si = (sy * src.width + sx) * 4
    const alpha = src.data[si + 3] / 255
    const di = ((oy + y) * size + (ox + x)) * 4
    canvas.data[di] = Math.round(src.data[si] * alpha + 255 * (1 - alpha))
    canvas.data[di + 1] = Math.round(src.data[si + 1] * alpha + 255 * (1 - alpha))
    canvas.data[di + 2] = Math.round(src.data[si + 2] * alpha + 255 * (1 - alpha))
    canvas.data[di + 3] = 255
  }
}

mkdirSync('assets', { recursive: true })
writeFileSync('assets/icon-180.png', PNG.sync.write(canvas))
console.log('wrote assets/icon-180.png', size, 'x', size)
