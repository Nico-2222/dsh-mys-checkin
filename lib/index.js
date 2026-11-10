/**
 * dsh-mys-checkin — 米游社全游戏每日签到 as a dsh bundle.
 *
 * Contract consumed by the dsh loader:
 *  - `name`   display id
 *  - `inject` required services (timer for scheduling, tools for agent tools)
 *  - `Config` validated Schemastery configuration
 *  - `apply(ctx, config)` the plugin body
 *
 * Credential model: the QR login happens in the plugin's own panel, and only
 * the resulting stoken/cookie_token are persisted (0600, under DSH_HOME).
 * Nothing in the plugin reads a browser profile, and no secret is ever logged.
 */
import { join, resolve } from 'node:path'
import Config from './config.js'
import { CheckinService } from './service.js'
import { registerRoutes } from './routes.js'
import { startScheduler } from './scheduler.js'
import { Store } from './store.js'
import { createTools } from './tools.js'

export const name = 'mys-checkin'
export const inject = ['timer', 'tools']

/**
 * Precedence: explicit config value, $DSH_MYS_CHECKIN_DATA, then
 * $DSH_HOME/data/mys-checkin/state.json, then ./.mys-checkin/state.json.
 */
export function resolveDataPath(explicit) {
  if (typeof explicit === 'string' && explicit !== '') return resolve(explicit)
  const direct = process.env.DSH_MYS_CHECKIN_DATA
  if (typeof direct === 'string' && direct !== '') return resolve(direct)
  const home = process.env.DSH_HOME
  return home !== undefined && home !== ''
    ? join(home, 'data', 'mys-checkin', 'state.json')
    : join(process.cwd(), '.mys-checkin', 'state.json')
}

export function apply(ctx, config) {
  const named = ctx.logger('mys-checkin')
  const log = {
    info: (message) => named.info(message),
    warn: (message) => named.warn(message),
    error: (message, error) => {
      if (error === undefined) named.error(message)
      else named.error(`${message}: ${String(error)}`)
    },
  }

  const store = new Store(resolveDataPath(config?.dataPath))
  const service = new CheckinService({ store, log })
  let scheduler
  let routesDisposed

  const onSettingsChanged = () => {
    try {
      scheduler?.resync()
    } catch (error) {
      log.warn(`mys-checkin: scheduler resync failed — ${String(error)}`)
    }
  }

  ctx.inject(['webServer'], (hostCtx) => {
    // Cordis lets a fiber own effects; when the seam is present the routes are
    // disposed with the plugin, otherwise the host disposes them with the fiber.
    const mount = () => registerRoutes(hostCtx, { service, config: config ?? {}, log, onSettingsChanged })
    if (typeof hostCtx.effect === 'function') hostCtx.effect(mount)
    else routesDisposed = mount()
  })

  // Bootstrap after apply() returns: the fiber must not block on disk I/O, and
  // tools/scheduler should see the persisted state, not the empty default.
  void store
    .load()
    .then(async () => {
      const configured = Array.isArray(config?.games) ? config.games : []
      if (configured.length > 0 && store.state.settings.games.length === 0) {
        await service.setSettings({ games: configured })
      }
      for (const tool of createTools({ service, onSettingsChanged })) {
        ctx.tools.register(tool)
      }
      scheduler = startScheduler(ctx, { service, log })
      // Nicknames are display-only sugar; refresh them lazily so the panel and
      // the agent tools never show a bare uid after a restart.
      if (store.state.account !== null && store.state.account.nickname == null) {
        void service.refreshNickname().catch(() => {})
      }
      log.info(`mys-checkin ready; state=${store.path}`)
    })
    .catch((error) => log.error('mys-checkin: startup bootstrap failed', error))
}

export { Config }
export default { name, inject, Config, apply }
