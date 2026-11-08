/**
 * HTTP surface: the panel page and its small JSON API.
 *
 * Routes register on the harness `webServer` service (exact for the page,
 * prefix for its API) so the panel lives at the same origin as the GUI — no
 * CORS, no extra port, and the user's existing login to the GUI covers it.
 */
import QRCode from 'qrcode'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { panelHtml } from './panel.js'

// Official community avatars / wordmark shipped with the package. Served from
// an allow-list so the prefix route can never be turned into a file reader.
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets')
const ASSET_NAMES = new Set(['miyoushe', 'ys', 'sr', 'zzz', 'bh3', 'tears', 'bh2'])

const normalizeBase = (path) => {
  const text = typeof path === 'string' && path.startsWith('/') ? path : '/mys-checkin'
  return text.endsWith('/') ? text.slice(0, -1) : text
}

const sendJson = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const readJsonBody = async (req, limit = 64 * 1024) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid JSON body')
  }
}

export function registerRoutes(ctx, { service, config, log, onSettingsChanged }) {
  const base = normalizeBase(config.panelPath)
  const disposers = []

  const dispatch = async (req, res, action) => {
    try {
      if (action.startsWith('assets/')) {
        if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
        const file = action.slice('assets/'.length)
        const name = file.endsWith('.png') ? file.slice(0, -4) : ''
        if (!ASSET_NAMES.has(name)) return sendJson(res, 404, { ok: false, error: 'not found' })
        const bytes = await readFile(join(ASSETS_DIR, `${name}.png`))
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=86400',
          'content-length': bytes.length,
        })
        res.end(bytes)
        return
      }
      switch (action) {
        case '': {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end(panelHtml({ basePath: base }))
          return
        }
        case 'api/state': {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          return sendJson(res, 200, { ok: true, state: service.status() })
        }
        case 'api/settings': {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          const body = await readJsonBody(req)
          await service.setSettings(body)
          onSettingsChanged?.()
          return sendJson(res, 200, { ok: true, state: service.status() })
        }
        case 'api/sign': {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          const report = await service.runAll('manual')
          return sendJson(res, 200, { ok: true, report })
        }
        case 'api/login/start': {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          const { url, ticket } = await service.loginStart()
          const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
          return sendJson(res, 200, { ok: true, ticket, dataUrl })
        }
        case 'api/login/poll': {
          if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' })
          const url = new URL(req.url ?? '/', 'http://localhost')
          const ticket = url.searchParams.get('ticket') ?? ''
          const result = await service.loginPoll(ticket)
          // A finished scan means a fresh account: let the scheduler re-arm so
          // the startup catch-up can sign the day right away.
          if (result.done) onSettingsChanged?.()
          return sendJson(res, 200, { ok: true, ...result })
        }
        case 'api/logout': {
          if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
          await service.logout()
          return sendJson(res, 200, { ok: true, state: service.status() })
        }
        default:
          return sendJson(res, 404, { ok: false, error: 'not found' })
      }
    } catch (error) {
      log.warn(`mys-checkin: ${action || '/'} failed — ${error?.message ?? String(error)}`)
      sendJson(res, error?.code === 'NO_ACCOUNT' || error?.code === 'LOGIN_EXPIRED' ? 400 : 500, {
        ok: false,
        error: error?.message ?? String(error),
      })
    }
  }

  disposers.push(
    ctx.webServer.register({
      kind: 'exact',
      path: base,
      handler: (req, res) => dispatch(req, res, ''),
    }),
  )
  disposers.push(
    ctx.webServer.register({
      // The host matches a prefix route with `pathname.startsWith(prefix + '/')`,
      // so the pattern must carry no trailing slash — registering `${base}/`
      // would only ever answer the bare slash form itself.
      kind: 'prefix',
      path: base,
      handler: (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const action = url.pathname === base ? '' : url.pathname.slice(base.length + 1)
        return dispatch(req, res, action)
      },
    }),
  )

  log.info(`mys-checkin: panel at ${base}`)
  return () => {
    for (const dispose of disposers) dispose()
  }
}
