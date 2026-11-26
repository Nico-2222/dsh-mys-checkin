/**
 * Check-in orchestration: login lifecycle, credential refresh, one pass over
 * the games the user selected.
 *
 * Design rules that keep this publishable:
 *  - the account is identified by mid; uid/nickname are display data only,
 *    and the uid is masked before it leaves this module;
 *  - a run never throws for an individual game: failures are values, so one
 *    dead activity id cannot take the whole schedule down;
 *  - tokens are only read from the store at call time and never copied into
 *    results, logs, or tool output.
 */
import {
  fetchCookieToken,
  fetchLToken,
  fetchAwards,
  fetchRoles,
  fetchSignInfo,
  signIn,
  createQrLogin,
  queryQrLogin,
  cookieHeader,
  MysError,
  newDevice,
} from './api.js'
import { GAMES, GAME_IDS, getGame, gameSummary } from './games.js'
import { runBbsSign } from './bbs.js'

export const E_NO_ACCOUNT = 'NO_ACCOUNT'
export const E_LOGIN_EXPIRED = 'LOGIN_EXPIRED'
export const E_NO_GAMES = 'NO_GAMES'

export class CheckinError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CheckinError'
    this.code = code
  }
}

const maskUid = (uid) => {
  const text = String(uid ?? '')
  return text.length <= 4 ? text : `${text.slice(0, 3)}****${text.slice(-2)}`
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })

// miHoYo app credentials have no documented expiry, but sessions in practice stop
// working after roughly 30 days; surface the age so the user can re-bind early.
const accountAgeDays = (iso) => {
  if (!iso) return 0
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return 0
  return Math.max(0, Math.floor((Date.now() - at) / 86400000))
}

// History timestamps are stored in UTC; the day they belong to must be judged
// in the sign-in timezone, not by slicing the ISO string.
const dayOf = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? String(iso ?? '').slice(0, 10) : date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

export class CheckinService {
  constructor({ store, log }) {
    this.store = store
    this.log = log
    this.pending = null // in-flight QR, kept in memory only
  }

  games() {
    return GAME_IDS.map((id) => ({ ...gameSummary(GAMES[id]), enabled: this.store.state.settings.games.includes(id) }))
  }

  status() {
    const state = this.store.snapshot()
    const account = state.account
    return {
      loggedIn: Boolean(account && (account.stoken || account.cookieToken)),
      account: account
        ? {
            mid: account.mid,
            nickname: account.nickname ?? null,
            uid: maskUid(account.uid ?? account.mid),
            updatedAt: account.updatedAt ?? null,
            expired: account.invalid === true,
            // miHoYo app credentials usually die around the 30-day mark; warn well before.
            ageDays: accountAgeDays(account.updatedAt),
            expiringSoon: accountAgeDays(account.updatedAt) >= 27,
          }
        : null,
      deviceReady: Boolean(state.device?.id && state.device?.fp),
      games: this.games(),
      settings: {
        signTime: state.settings.signTime,
        jitterMinutes: state.settings.jitterMinutes,
        autoSign: state.settings.autoSign,
        catchUp: state.settings.catchUp,
        bbsSign: state.settings.bbsSign !== false,
      },
      lastRun: state.lastRun ?? null,
      today: state.history.filter((entry) => dayOf(entry.at) === today()),
      history: state.history.slice(0, 14),
      panelUrl: '/mys-checkin',
    }
  }

  async ensureDevice() {
    let device = this.store.state.device
    if (!device?.id || !device?.fp) {
      device = newDevice()
      await this.store.update((draft) => {
        draft.device = device
        return draft
      })
      this.log.info('mys-checkin: generated device fingerprint')
    }
    return device
  }

  async setSettings(patch) {
    const clean = {}
    if (Array.isArray(patch.games)) {
      const unknown = patch.games.filter((id) => !getGame(id))
      if (unknown.length > 0) throw new CheckinError('BAD_GAMES', `unknown game id(s): ${unknown.join(', ')}`)
      clean.games = [...new Set(patch.games)]
    }
    if (typeof patch.signTime === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(patch.signTime)) {
      clean.signTime = patch.signTime
    }
    if (Number.isInteger(patch.jitterMinutes) && patch.jitterMinutes >= 0 && patch.jitterMinutes <= 120) {
      clean.jitterMinutes = patch.jitterMinutes
    }
    if (typeof patch.autoSign === 'boolean') clean.autoSign = patch.autoSign
    if (typeof patch.catchUp === 'boolean') clean.catchUp = patch.catchUp
    if (typeof patch.bbsSign === 'boolean') clean.bbsSign = patch.bbsSign
    await this.store.update((draft) => {
      draft.settings = { ...draft.settings, ...clean }
      return draft
    })
    this.log.info(`mys-checkin: settings updated (${JSON.stringify(clean)})`)
    return this.status()
  }

  // ------------------------------------------------------------- QR login

  async loginStart() {
    const device = await this.ensureDevice()
    const { url, ticket } = await createQrLogin(device)
    this.pending = { ticket, url, createdAt: Date.now() }
    return { ticket, url, expiresInSeconds: 180 }
  }

  async loginPoll(ticket) {
    if (!this.pending || this.pending.ticket !== ticket) {
      throw new CheckinError('NO_PENDING_QR', '二维码已失效，请重新获取')
    }
    const device = await this.ensureDevice()
    const result = await queryQrLogin(device, ticket)
    if (result.status !== 'Confirmed') {
      if (result.status === 'Expired' || result.status === 'Canceled') this.pending = null
      return { status: result.status, done: false }
    }
    if (typeof result.stoken !== 'string' || result.stoken === '') {
      throw new CheckinError('NO_STOKEN', '扫码确认但未取到凭证，请重试')
    }
    const mid = String(result.mid ?? result.aid ?? '')
    const tokens = await fetchCookieToken(device, { stoken: result.stoken, mid })
    if (typeof tokens.cookieToken !== 'string' || tokens.cookieToken === '') {
      throw new CheckinError('NO_COOKIE_TOKEN', '未能换取 cookie_token，请重试')
    }
    let ltoken
    try {
      ltoken = (await fetchLToken(device, { stoken: result.stoken, mid })).ltoken
    } catch {
      ltoken = undefined
    }
    const account = {
      mid,
      uid: String(tokens.uid ?? mid),
      stoken: result.stoken,
      cookieToken: tokens.cookieToken,
      ltoken: typeof ltoken === 'string' ? ltoken : undefined,
      updatedAt: new Date().toISOString(),
    }
    await this.store.update((draft) => {
      draft.account = account
      return draft
    })
    this.pending = null
    this.log.info(`mys-checkin: login stored for mid=${maskUid(mid)}`)
    await this.refreshNickname().catch(() => {})
    return { status: 'Confirmed', done: true }
  }

  async logout() {
    this.pending = null
    await this.store.update((draft) => {
      draft.account = null
      return draft
    })
    this.log.info('mys-checkin: account removed')
    return this.status()
  }

  /**
   * Bind credentials pasted by hand (cookie_token / ltoken copied from DevTools).
   * This is the escape hatch for chat clients where the QR code cannot be scanned.
   */
  async bindManual({ cookieToken, ltoken }) {
    const token = String(cookieToken ?? '').trim()
    const ltokenValue = String(ltoken ?? '').trim()
    if (!token.includes('_') || token.length < 40) throw new CheckinError('E_BAD_INPUT', 'cookie_token 看起来不像有效值，请重新复制（通常以 v2_ 开头）')
    const state = this.store.state
    const previous = state.account
    if (!previous?.uid) throw new CheckinError(E_NO_ACCOUNT, '首次绑定还需要账号 uid：请先扫码登录一次，或先提供 uid')
    const account = {
      mid: previous.mid,
      uid: String(previous.uid),
      stoken: '',
      cookieToken: token,
      ltoken: ltokenValue,
      nickname: previous.nickname ?? null,
      updatedAt: new Date().toISOString(),
      invalid: false,
    }
    const device = await this.ensureDevice()
    const roles = await fetchRoles(device, cookieHeader(account), getGame('genshin'))
    if (!Array.isArray(roles) || roles.length === 0) throw new CheckinError(E_LOGIN_EXPIRED, '这组 cookie 没有取到角色，可能已经失效，请重新复制')
    const chosen = roles.find((role) => role.is_chosen) ?? roles[0]
    account.nickname = chosen.nickname ?? account.nickname
    await this.store.update((draft) => {
      draft.account = account
      return draft
    })
    this.log.info(`mys-checkin: credentials pasted manually, uid=${maskUid(account.uid)}`)
    return this.status()
  }

  // ---------------------------------------------------------------- account

  /** Re-derive cookie_token from the stoken; stoken outlives the cookie. */
  async refreshAccount() {
    const state = this.store.state
    const account = state.account
    if (!account?.stoken || !account?.mid) throw new CheckinError(E_NO_ACCOUNT, '还没有登录米游社账号')
    const device = await this.ensureDevice()
    let cookieToken
    let uid
    try {
      const tokens = await fetchCookieToken(device, {
        stoken: account.stoken,
        mid: String(account.mid),
        uid: account.uid,
      })
      cookieToken = tokens.cookieToken
      uid = tokens.uid
    } catch (error) {
      const code = error instanceof MysError ? error.retcode : undefined
      if (code === -100 || code === -1001 || code === -464 || code === -3235) {
        await this.store.update((draft) => {
          if (draft.account) draft.account.invalid = true
          return draft
        })
        throw new CheckinError(E_LOGIN_EXPIRED, '登录凭证已失效，请在插件面板重新扫码登录')
      }
      throw error
    }
    if (typeof cookieToken === 'string' && cookieToken !== '') {
      await this.store.update((draft) => {
        if (draft.account) {
          draft.account.cookieToken = cookieToken
          if (typeof uid === 'string' && uid !== '') draft.account.uid = uid
          draft.account.invalid = false
          draft.account.updatedAt = new Date().toISOString()
        }
        return draft
      })
    }
  }

  async refreshNickname() {
    const state = this.store.state
    if (!state.account?.cookieToken) return
    const device = await this.ensureDevice()
    const cookie = cookieHeader(state.account)
    const ids = GAME_IDS.filter((id) => state.settings.games.includes(id))
    const order = ids.length > 0 ? ids : GAME_IDS
    for (const id of order) {
      const roles = await fetchRoles(device, cookie, getGame(id)).catch(() => [])
      const role = roles.find((item) => item.nickname)
      if (role) {
        await this.store.update((draft) => {
          if (draft.account) draft.account.nickname = role.nickname
          return draft
        })
        return
      }
    }
  }

  // -------------------------------------------------------------- check-in

  /**
   * One pass over every enabled game and every bound role.
   * Returns a report; never throws for per-game failures.
   */
  async runAll(reason = 'manual') {
    const state = this.store.state
    // Cookie-only accounts (credentials pasted by hand) have no stoken: they are
    // perfectly usable, only the silent cookie_token refresh is unavailable.
    if (!state.account?.cookieToken && !state.account?.stoken) throw new CheckinError(E_NO_ACCOUNT, '还没有登录米游社账号')
    const gameIds = state.settings.games
    const bbsSign = state.settings.bbsSign !== false
    if (gameIds.length === 0 && !bbsSign) throw new CheckinError(E_NO_GAMES, '还没有选择要签到的游戏，请在插件面板勾选')

    if (state.account?.stoken) {
      try {
        await this.refreshAccount()
      } catch (error) {
        // A dead stoken must not block signing with a still-valid cookie_token.
        this.log.warn(`mys-checkin: cookie_token refresh skipped — ${error?.message ?? String(error)}`)
      }
    }
    const fresh = this.store.state
    const device = await this.ensureDevice()
    const cookie = cookieHeader(fresh.account)

    const games = []
    for (const id of gameIds) {
      games.push(await this.signGame(id, { device, cookie }))
    }

    // 米游币只做讨论区签到（不评论、不点赞、不分享）。
    let bbs = null
    if (bbsSign) {
      // The community sign-in endpoint only accepts an app session (stoken).
      // Cookie-only accounts can still check games in, so skip instead of failing.
      if (!fresh.account?.stoken) {
        bbs = { ok: true, skipped: true, reason: '米游币签到需要扫码登录（stoken）；手动粘贴 cookie 目前只能签游戏' }
      } else {
        try {
          bbs = await runBbsSign({ account: fresh.account, device, log: this.log })
        } catch (error) {
          bbs = { ok: false, error: error instanceof MysError ? error.message : String(error) }
          this.log.warn(`mys-checkin: 米游币签到失败 — ${bbs.error}`)
        }
      }
    }

    const report = {
      at: new Date().toISOString(),
      day: today(),
      reason,
      ok: games.every((game) => game.roles.every((role) => role.status !== 'failed')) && bbs?.ok !== false,
      games,
      bbs,
    }
    await this.store.recordRun(report)
    const signed = report.games.flatMap((game) => game.roles).filter((role) => role.status === 'signed').length
    this.log.info(`mys-checkin: run (${reason}) — ${signed} newly signed, bbs=${bbs ? (bbs.skipped ? 'done' : `+${Math.max(0, (bbs.after?.total ?? 0) - (bbs.before?.total ?? 0))}`) : 'off'}, ok=${report.ok}`)
    return report
  }

  async signGame(id, { device, cookie }) {
    const game = getGame(id)
    const base = { id: game.id, name: game.name, roles: [] }
    let roles
    try {
      roles = await fetchRoles(device, cookie, game)
    } catch (error) {
      const failure = error instanceof MysError ? { retcode: error.retcode, message: error.message } : { message: String(error) }
      const code = failure.retcode
      if (code === -100 || code === -1001 || code === -464 || code === -3235) {
        throw new CheckinError(E_LOGIN_EXPIRED, '米游社登录凭证已过期，请重新扫码登录')
      }
      return { ...base, error: failure.message ?? 'failed to list roles' }
    }
    if (roles.length === 0) return { ...base, error: 'no role bound to this account' }

    for (const role of roles) {
      base.roles.push(await this.signRole(game, role, { device, cookie }))
    }
    return base
  }

  async signRole(game, role, { device, cookie }) {
    const item = {
      region: role.region,
      regionName: role.region_name ?? role.region,
      uid: maskUid(role.game_uid),
      nickname: role.nickname ?? null,
      status: 'unknown',
      totalDays: null,
      award: null,
      message: null,
    }
    try {
      const info = await fetchSignInfo(device, cookie, game, role)
      item.totalDays = info.total_sign_day ?? null
      if (info.is_sign === true) {
        item.status = 'already'
        return item
      }
      const response = await signIn(device, cookie, game, role)
      const retcode = response?.retcode ?? 0
      if (retcode === 0) {
        item.status = 'signed'
        const signDay = Number(info.total_sign_day ?? 0) + 1
        const awards = await fetchAwards(device, cookie, game)
        const award = awards.find((entry) => Number(entry?.cnt ?? 0) === signDay) ?? awards[signDay - 1]
        if (award?.name) item.award = award.name
      } else if (retcode === -5003) {
        item.status = 'already'
        item.message = response?.message ?? '已签到'
      } else {
        item.status = 'failed'
        item.message = response?.message ?? `retcode ${retcode}`
        item.retcode = retcode
      }
    } catch (error) {
      if (error instanceof MysError && error.retcode === -5003) {
        item.status = 'already'
        item.message = error.message
        return item
      }
      item.status = 'failed'
      item.message = error instanceof MysError ? error.message : String(error)
      if (error instanceof MysError) item.retcode = error.retcode
    }
    return item
  }
}
