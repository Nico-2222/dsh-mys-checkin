// Mirrors the host's WebServer.match() (extracted from
// @deepseek-ai/dsh-host-webserver/lib/index.js) and checks that the plugin's
// registrations answer every API path — the bug fixed here was registering a
// prefix pattern that ended in '/', which the host matches as `${prefix}/`.
import { registerRoutes } from '../lib/routes.js'

const exact = new Map()
const prefixes = new Map()

const match = (pathname) => {
  const hit = exact.get(pathname)
  if (hit !== undefined) return hit
  let best
  for (const [prefix, route] of prefixes) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
    if (best === undefined || prefix.length > best.path.length) best = route
  }
  return best
}

const ctx = {
  webServer: {
    register(route) {
      const table = route.kind === 'exact' ? exact : prefixes
      if (table.has(route.path)) throw new Error(`duplicate ${route.kind} route ${route.path}`)
      table.set(route.path, route)
      return () => table.delete(route.path)
    },
  },
}

const service = {
  status: () => ({ account: null, settings: { games: [] } }),
  setSettings: async () => {},
  runAll: async () => ({ results: [] }),
  loginStart: async () => ({ url: 'https://example.invalid/qr', ticket: 't' }),
  loginPoll: async () => ({ status: 'Init', done: false }),
  logout: async () => {},
}
const log = { info: () => {}, warn: () => {} }

const dispose = registerRoutes(ctx, { service, config: { panelPath: '/mys-checkin' }, log })
const tests = []
const check = (name, ok) => tests.push({ name, ok })

check('exact table has panel', exact.has('/mys-checkin'))
check('prefix table has base without trailing slash', prefixes.has('/mys-checkin'))
check('no prefix entry with trailing slash', !prefixes.has('/mys-checkin/'))

for (const path of [
  '/mys-checkin',
  '/mys-checkin/',
  '/mys-checkin/api/state',
  '/mys-checkin/api/settings',
  '/mys-checkin/api/sign',
  '/mys-checkin/api/login/start',
  '/mys-checkin/api/login/poll',
  '/mys-checkin/api/logout',
]) {
  check(`match ${path}`, match(path) !== undefined)
}
check('unknown path does not match', match('/other') === undefined)

// Route the state call through the real handler and inspect the response.
const route = match('/mys-checkin/api/state')
const res = {
  status: 0,
  headers: {},
  body: '',
  writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers ?? {}) },
  end(payload) { this.body += payload ?? '' },
}
await route.handler({ method: 'GET', url: '/mys-checkin/api/state' }, res)
check('GET api/state answers 200 json', res.status === 200 && JSON.parse(res.body).ok === true)

dispose()
const failed = tests.filter((t) => !t.ok)
for (const t of tests) console.log(`${t.ok ? 'PASS' : 'FAIL'} ${t.name}`)
console.log(failed.length === 0 ? `OK ${tests.length}/${tests.length}` : `FAILED ${failed.length}/${tests.length}`)
process.exit(failed.length === 0 ? 0 : 1)
