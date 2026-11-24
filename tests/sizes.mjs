import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
for (const f of ['ys','sr','zzz','bh3','tears','bh2','miyoushe']) {
  const p = PNG.sync.read(readFileSync(`lib/assets/${f}.png`))
  console.log(f, p.width + 'x' + p.height)
}
