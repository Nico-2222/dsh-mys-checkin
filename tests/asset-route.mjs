/**
 * Asset + panel route self-check: mounts the real registerRoutes() on a
 * throwaway http server (no harness needed) and fetches the shipped images.
 */
import http from 'node:http'
import { registerRoutes } from '../lib/routes.js'

let disposed = []
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const base = '/mys-checkin'
  const action = url.pathname === base ? '' : url.pathname.slice(base.length + 1)
  for (const route of handlers) {
    const hit = route.kind === 'exact'
      ? url.pathname === route.path
      : url.pathname === route.path || url.pathname.startsWith(`${route.path}/`)
    if (!hit) continue
    if (route.kind === 'prefix') return route.handler(req, res, action)
    return route.handler(req, res)
  }
  res.writeHead(404).end()
})

const handlers = []
const ctx = {
  logger: () => ({ info() {}, warn() {}, debug() {} }),
  webServer: {
    register(route) {
      handlers.push(route)
      return () => {}
    },
  },
}

const service = {
  status: () => ({ account: null, games: [], settings: {}, history: [] }),
  setSettings: async () => {},
  runAll: async () => ({ games: [] }),
  loginStart: async () => ({ url: 'https://example.invalid/qr', ticket: 't' }),
  loginPoll: async () => ({ done: false }),
  logout: async () => {},
}

registerRoutes(ctx, { service, config: { panelPath: '/mys-checkin' }, log: ctx.logger(), onSettingsChanged: () => {} })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}/mys-checkin`

const failures = []
const check = (ok, label, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${extra ? ' — ' + extra : ''}`)
  if (!ok) failures.push(label)
}

const page = await fetch(origin)
const html = await page.text()
check(page.status === 200, 'panel page 200')
check(/assets\/miyoushe\.png/.test(html), 'panel references wordmark asset')
// Game icons are assembled client-side from the GAME_META table, so assert on
// the icon keys rather than on literal URLs.
check(['ys', 'sr', 'zzz', 'bh3', 'tears', 'bh2'].every((name) => new RegExp(`icon: '${name}'`).test(html)), 'panel references all game icons')
check(!/undefined\//.test(html), 'no undefined base path leaked')

for (const name of ['miyoushe', 'ys', 'sr', 'zzz', 'bh3', 'tears', 'bh2']) {
  const res = await fetch(`${origin}/assets/${name}.png`)
  const bytes = await res.arrayBuffer()
  const type = res.headers.get('content-type')
  check(res.status === 200 && type === 'image/png' && bytes.byteLength > 4000, `asset ${name}`, `${res.status} ${type} ${bytes.byteLength}B`)
  const sig = new Uint8Array(bytes.slice(0, 4))
  check(sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47, `asset ${name} png signature`)
}

const bad = await fetch(`${origin}/assets/nope.png`)
check(bad.status === 404, 'unknown asset 404', String(bad.status))
const trav = await fetch(`${origin}/assets/..%2fpackage.json`)
check(trav.status === 404, 'path traversal blocked', String(trav.status))
const post = await fetch(`${origin}/assets/ys.png`, { method: 'POST' })
check(post.status === 405, 'POST asset rejected', String(post.status))

server.close()
console.log(failures.length ? `FAILED ${failures.length}` : 'OK all asset checks')
process.exit(failures.length ? 1 : 0)
