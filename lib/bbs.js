/**
 * 米游币社区签到（只做「讨论区签到」，绝不评论 / 发帖 / 点赞 / 分享）。
 *
 * 为什么只签到：米游币日常的大头是讨论区签到，看帖/点赞/分享基本不额外给币，
 * 而自动评论既冒犯社区也最容易触发风控。这里刻意只保留动作最轻的一步。
 */
import { createHash } from 'node:crypto'

const BBS_API = 'https://bbs-api.miyoushe.com'
const BBS_VERSION = '2.106.2'
const BBS_X6_SALT = 't0qEgfub6cvueAPgR5m9aQWWVciEer7v'
const APP_UA = 'okhttp/4.9.3'
const WEB_UA = `Mozilla/5.0 (Linux; Android 12; Unspecified Device) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 miHoYoBBS/${BBS_VERSION}`

/** 讨论区签到目标：原神版、大别野。 */
export const BBS_FORUMS = [
  { gids: '2', name: '原神' },
  { gids: '5', name: '大别野' },
]

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex')

function dsX6(query, body) {
  const t = Math.floor(Date.now() / 1000)
  const r = String(Math.floor(100_000 + Math.random() * 100_000))
  const c = md5(`salt=${BBS_X6_SALT}&t=${t}&r=${r}&b=${body}&q=${query}`)
  return `${t},${r},${c}`
}

function webCookie(account) {
  const uid = String(account.uid ?? account.mid ?? '')
  const mid = String(account.mid ?? '')
  const token = String(account.cookieToken ?? '')
  return [
    `account_id=${uid}`,
    `account_id_v2=${uid}`,
    `ltuid=${uid}`,
    `ltuid_v2=${uid}`,
    `account_mid_v2=${uid}`,
    `ltmid_v2=${mid || uid}`,
    `cookie_token=${token}`,
    `cookie_token_v2=${token}`,
  ].join('; ')
}

function stokenCookie(account) {
  const uid = String(account.uid ?? account.mid ?? '')
  const appToken = String(account.stoken ?? '') || String(account.ltoken ?? '')
  const parts = [`stuid=${uid}`, `stoken=${appToken}`, `ltuid=${uid}`, `account_id=${uid}`, `mid=${account.mid ?? ''}`]
  // Hand-pasted accounts have no stoken; carry the web session cookies as well.
  if (account.ltoken) parts.push(`ltoken=${account.ltoken}`)
  if (account.cookieToken) parts.push(`cookie_token=${account.cookieToken}`)
  return parts.join('; ')
}

function appHeaders(account, device, body, query = '') {
  const headers = {
    DS: dsX6(query, body),
    cookie: stokenCookie(account),
    'x-rpc-client_type': '2',
    'x-rpc-app_version': BBS_VERSION,
    'x-rpc-sys_version': '12',
    'x-rpc-channel': 'miyousheluodi',
    'x-rpc-device_id': String(device?.id ?? ''),
    'x-rpc-device_name': 'Xiaomi MI 6',
    'x-rpc-device_model': 'Mi 6',
    'x-rpc-h265_supported': '1',
    Referer: 'https://app.mihoyo.com',
    'Content-Type': 'application/json; charset=UTF-8',
    'x-rpc-verify_key': 'bll8iq97cem8',
    'x-rpc-csm_source': 'discussion',
    'User-Agent': APP_UA,
  }
  if (device?.fp) headers['x-rpc-device_fp'] = String(device.fp)
  return headers
}

async function getJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) })
  return response.json()
}

/** 今日米游币进度：已得 / 还能得 / 总余额。 */
export async function fetchBbsState(account) {
  const body = await getJson(`${BBS_API}/apihub/wapi/getUserMissionsState?point_sn=myb`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://webstatic.mihoyo.com',
      'User-Agent': WEB_UA,
      Referer: 'https://webstatic.mihoyo.com',
      'Accept-Language': 'zh-CN,en-US;q=0.8',
      'X-Requested-With': 'com.mihoyo.hyperion',
      Cookie: webCookie(account),
    },
  })
  if (body?.retcode !== 0) {
    const error = new Error(body?.message ?? `retcode ${body?.retcode}`)
    error.retcode = body?.retcode
    throw error
  }
  const data = body.data ?? {}
  return {
    already: Number(data.already_received_points ?? 0),
    canGet: Number(data.can_get_points ?? 0),
    total: Number(data.total_points ?? 0),
    todayCap: Number(data.today_total_points ?? 0),
  }
}

async function signForum(account, device, gids) {
  const body = JSON.stringify({ gids })
  return getJson(`${BBS_API}/apihub/app/api/signIn`, {
    method: 'POST',
    headers: appHeaders(account, device, body),
    body,
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min))

/**
 * 跑一次讨论区签到。任何单个版块失败都不抛出，结果按值返回；
 * 今日已无可获得米游币时直接跳过（不发请求，避免无意义调用）。
 */
export async function runBbsSign({ account, device, log, forums = BBS_FORUMS }) {
  const before = await fetchBbsState(account)
  if (before.canGet === 0) {
    log?.info?.(`mys-checkin: 米游币任务今日已完成（已得 ${before.already}），跳过`)
    return { ok: true, skipped: true, before, after: before, forums: [] }
  }

  const results = []
  for (const forum of forums) {
    try {
      const response = await signForum(account, device, forum.gids)
      results.push({ name: forum.name, retcode: response?.retcode ?? null, message: response?.message ?? '' })
      log?.info?.(`mys-checkin: 米游币签到 ${forum.name} -> ${response?.retcode} ${response?.message ?? ''}`)
    } catch (error) {
      results.push({ name: forum.name, retcode: null, message: String(error?.message ?? error) })
      log?.warn?.(`mys-checkin: 米游币签到 ${forum.name} 失败 — ${error?.message ?? error}`)
    }
    await sleep(jitter(3_000, 6_000))
  }

  await sleep(1_500)
  let after = null
  try {
    after = await fetchBbsState(account)
  } catch {
    after = null
  }
  const ok = results.every((item) => item.retcode === 0 || item.retcode === -5003)
  return { ok, skipped: false, before, after, forums: results }
}
