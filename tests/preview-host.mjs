/**
 * Standalone preview host: loads the bundle with a minimal fake harness and
 * serves the panel on a free loopback port, so the UI can be inspected without
 * restarting the real dsh host.
 *
 * Usage: node tests/preview-host.mjs [port]
 */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import plugin from '../lib/index.js'

const port = Number(process.argv[2] ?? 0)
const dataDir = mkdtempSync(join(tmpdir(), 'mys-checkin-preview-'))
process.env.DSH_MYS_CHECKIN_DATA = join(dataDir, 'state.json')

const routes = []
const logs = []

const logger = (scope) => {
  const emit = (level) => (message) => {
    logs.push(`[${level}] ${scope}: ${String(message)}`)
  }
  const api = { info: emit('info'), warn: emit('warn'), error: emit('error'), debug: emit('debug') }
  api.info = emit('info')
  return api
}

const ctx = {
  logger,
  inject(names, callback) {
    const hostCtx = {
      ...ctx,
      webServer: ctx.webServer,
      effect: (fn) => fn(),
    }
    callback(hostCtx)
  },
  effect: (fn) => fn(),
  timeout: (ms, fn) => {
    const handle = setTimeout(fn, Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(handle)
  },
  interval: (ms, fn) => {
    const handle = setInterval(fn, ms)
    return () => clearInterval(handle)
  },
  tools: { register: (tool) => logs.push(`[tool] ${tool.name}`) },
  webServer: {
    register({ kind, path, handler }) {
      const entry = { kind, path, handler }
      routes.push(entry)
      return () => {
        const at = routes.indexOf(entry)
        if (at >= 0) routes.splice(at, 1)
      }
    },
  },
}

plugin.apply(ctx, { panelPath: '/mys-checkin' })

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  for (const route of routes) {
    const hit =
      route.kind === 'exact' ? pathname === route.path : pathname.startsWith(route.path)
    if (hit) {
      try {
        await route.handler(req, res)
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(error))
      }
      return
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('no route')
})

server.listen(port, '127.0.0.1', () => {
  const { port: actual } = server.address()
  console.log(`preview: http://127.0.0.1:${actual}/mys-checkin`)
  console.log(`state:   ${process.env.DSH_MYS_CHECKIN_DATA}`)
  console.log(JSON.stringify({ logs }, null, 2))
})
