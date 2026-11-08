/**
 * 米游社 (miHoYo BBS) HTTP client.
 *
 * Only two flows are implemented on purpose:
 *  1. QR login  — the user scans once from the 米游社 App; the plugin stores
 *     the resulting stoken and derives cookie_token from it, so no browser
 *     cookie jar and no password ever touch this plugin.
 *  2. Game check-in — role discovery + luna info/sign.
 *
 * Secrets (`stoken`, `cookie_token`, session cookies) are only ever put in
 * request headers. They are never logged, never returned by a tool, and never
 * written outside the 0600 state file.
 */
import { passportDs, webDs, deviceFp, deviceId } from './crypto.js'

export const PASSPORT_API = 'https://passport-api.mihoyo.com'
export const TAKUMI_API = 'https://api-takumi.mihoyo.com'

// 米游社 App client constants. Bump together with the App when signing breaks.
export const BBS_VERSION = '2.106.2'
export const QR_CLIENT_VERSION = '2.90.1'
export const PASSPORT_VERSION = '2.90.1'
export const APP_ID = 'bll8iq97cem8'
export const WEB_SALT = 'G1ktdwFL4IyGkHuuWSmz0wUe9Db9scyK'
export const PASSPORT_SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs'

export const MOBILE_UA =
  `Mozilla/5.0 (Linux; Android 12; Unspecified Device) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 miHoYoBBS/${BBS_VERSION}`

export class MysError extends Error {
  constructor(message, retcode) {
    super(message)
    this.name = 'MysError'
    this.retcode = retcode
  }
}

async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 20000 } = {}) {
  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new MysError(`network error: ${error?.message ?? String(error)}`)
  }
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new MysError(`non-JSON response (HTTP ${response.status})`)
  }
  if (typeof json?.retcode === 'number' && json.retcode !== 0) {
    throw new MysError(json.message ?? `retcode ${json.retcode}`, json.retcode)
  }
  return { status: response.status, json, headers: response.headers }
}

// ------------------------------------------------------------------ QR login

const qrHeaders = (fp, id, ds) => ({
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Content-Type': 'application/json; charset=UTF-8',
  'User-Agent': `Mozilla/5.0 miHoYoBBS/${QR_CLIENT_VERSION} Capture/2.2.0`,
  'x-rpc-client_type': '3',
  'x-rpc-app_version': QR_CLIENT_VERSION,
  'x-rpc-app_id': APP_ID,
  'x-rpc-sdk_version': QR_CLIENT_VERSION,
  'x-rpc-game_biz': 'bbs_cn',
  'x-rpc-device_id': id,
  'x-rpc-device_fp': fp,
  'x-rpc-device_model': 'Mi 14',
  'x-rpc-device_name': 'Mihoyo Capture',
  'x-rpc-account_version': QR_CLIENT_VERSION,
  DS: ds,
})

/** Create a login QR. Returns the URL to encode plus the polling ticket. */
export async function createQrLogin(device) {
  const body = '{}'
  const ds = passportDs(PASSPORT_SALT, '', body)
  const { json } = await request(`${PASSPORT_API}/account/ma-cn-passport/app/createQRLogin`, {
    method: 'POST',
    headers: qrHeaders(device.fp, device.id, ds),
    body,
  })
  const url = json?.data?.url
  const ticket = json?.data?.ticket
  if (typeof url !== 'string' || typeof ticket !== 'string') {
    throw new MysError('createQRLogin returned no url/ticket')
  }
  return { url, ticket }
}

/**
 * Poll one QR. `status` is Init | Scanned | Confirmed | Canceled | Expired.
 * On Confirmed the result also carries `mid`, `aid`, `stoken`.
 */
export async function queryQrLogin(device, ticket) {
  const body = JSON.stringify({ ticket })
  const ds = passportDs(PASSPORT_SALT, '', body)
  const { json } = await request(`${PASSPORT_API}/account/ma-cn-passport/app/queryQRLoginStatus`, {
    method: 'POST',
    headers: qrHeaders(device.fp, device.id, ds),
    body,
  })
  const data = json?.data ?? {}
  const token = Array.isArray(data.tokens) ? data.tokens[0] : undefined
  return {
    status: data.status ?? 'Init',
    mid: data.user_info?.mid ?? data.mid,
    aid: data.user_info?.aid ?? data.aid,
    stoken: token?.token,
    expired: data.status === 'Expired' || data.status === 'Canceled',
  }
}

// ------------------------------------------------------------- token refresh

/** Exchange an stoken for the long-lived cookie_token used by game check-in. */
export async function fetchCookieToken(device, { stoken, mid }) {
  const query = `stoken=${encodeURIComponent(stoken)}&mid=${encodeURIComponent(mid)}`
  const ds = passportDs(PASSPORT_SALT, query, '')
  const { json } = await request(`${PASSPORT_API}/account/auth/api/getCookieAccountInfoBySToken?${query}`, {
    headers: {
      'User-Agent': MOBILE_UA,
      'x-rpc-app_version': PASSPORT_VERSION,
      'x-rpc-client_type': '2',
      'x-rpc-device_id': device.id,
      'x-rpc-device_fp': device.fp,
      DS: ds,
    },
  })
  const data = json?.data ?? {}
  return { cookieToken: data.cookie_token, uid: data.uid ?? data.account_id }
}

export async function fetchLToken(device, { stoken, mid }) {
  const query = `stoken=${encodeURIComponent(stoken)}&mid=${encodeURIComponent(mid)}`
  const ds = passportDs(PASSPORT_SALT, query, '')
  const { json } = await request(`${PASSPORT_API}/account/auth/api/getLTokenBySToken?${query}`, {
    headers: {
      'User-Agent': MOBILE_UA,
      'x-rpc-app_version': PASSPORT_VERSION,
      'x-rpc-client_type': '2',
      'x-rpc-device_id': device.id,
      'x-rpc-device_fp': device.fp,
      DS: ds,
    },
  })
  return json?.data ?? {}
}

/** Full cookie header, rebuilt from stored tokens on every request. */
export function cookieHeader(account) {
  const parts = []
  const add = (key, value) => {
    if (typeof value === 'string' && value !== '') parts.push(`${key}=${value}`)
  }
  // account_id / ltuid must be the numeric account id; the mid is a different
  // identifier and only fits the *_mid_* keys.
  add('account_id', account.uid)
  add('account_id_v2', account.uid)
  add('ltuid', account.uid)
  add('ltuid_v2', account.uid)
  add('login_uid', account.uid)
  add('account_mid_v2', account.mid)
  add('ltmid_v2', account.mid)
  add('ltoken', account.ltoken)
  add('ltoken_v2', account.ltoken)
  add('cookie_token', account.cookieToken)
  add('cookie_token_v2', account.cookieToken)
  return parts.join('; ')
}

// ------------------------------------------------------------- game check-in

function gameHeaders(device, cookie, signgame) {
  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,en-US;q=0.8',
    DS: webDs(WEB_SALT),
    Origin: 'https://act.mihoyo.com',
    Referer: 'https://act.mihoyo.com/',
    'User-Agent': MOBILE_UA,
    Cookie: cookie,
    'x-rpc-app_version': BBS_VERSION,
    'x-rpc-client_type': '5',
    'x-rpc-channel': 'miyousheluodi',
    'x-rpc-device_id': device.id,
    'x-rpc-device_fp': device.fp,
    // Mandatory: without it luna/* answers -500001 "网络出小差了".
    'x-rpc-signgame': signgame,
    'X-Requested-With': 'com.mihoyo.hyperion',
  }
}

/** Roles bound to this cookie for one game_biz. */
export async function fetchRoles(device, cookie, game) {
  const { json } = await request(
    `${TAKUMI_API}/binding/api/getUserGameRolesByCookie?game_biz=${encodeURIComponent(game.gameBiz)}`,
    { headers: gameHeaders(device, cookie, game.signgame) },
  )
  return Array.isArray(json?.data?.list) ? json.data.list : []
}

async function luna(device, cookie, game, verb, query = '', body) {
  const base = `${TAKUMI_API}/event/${game.path}/${verb}`
  const url = `${base}?${query}`
  const headers = gameHeaders(device, cookie, game.signgame)
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const { json } = await request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return json
}

/** Sign-in state + calendar for one role. */
export async function fetchSignInfo(device, cookie, game, role) {
  const json = await luna(
    device,
    cookie,
    game,
    'info',
    `act_id=${game.actId}&lang=zh-cn&region=${role.region}&uid=${role.game_uid}`,
  )
  return json?.data ?? {}
}

/** Award list for the activity (used only for the "what did I get" text). */
export async function fetchAwards(device, cookie, game) {
  try {
    const json = await luna(device, cookie, game, 'home', `act_id=${game.actId}&lang=zh-cn`)
    return Array.isArray(json?.data?.awards) ? json.data.awards : []
  } catch {
    return []
  }
}

/**
 * Sign in one role. Returns the raw envelope so callers can distinguish
 * retcode -5003 (already signed, a success) from real failures.
 */
export async function signIn(device, cookie, game, role) {
  const json = await luna(device, cookie, game, 'sign', '', {
    act_id: game.actId,
    region: role.region,
    uid: role.game_uid,
  })
  return json
}

export function newDevice() {
  return { id: deviceId(), fp: deviceFp() }
}
