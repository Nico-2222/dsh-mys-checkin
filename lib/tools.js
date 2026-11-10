/**
 * Agent-facing tools. Everything returned here is display data: no stoken, no
 * cookie_token, no full uid. Tools exist so the assistant can check state and
 * trigger a sign-in without the user opening the panel.
 */
let defineTool
try {
  ;({ defineTool } = await import('@deepseek-ai/dsh-tools'))
} catch {
  // Standalone preview/tests run outside the harness runtime, which is what
  // supplies this peer package; a plain identity keeps the definitions inert.
  defineTool = (spec) => spec
}

const text = (value) => [{ type: 'text', text: value }]

const shanghaiTime = (iso) => {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso).slice(0, 16)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type) => (parts.find((part) => part.type === type) ?? {}).value ?? ''
  return `${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

const line = (game) => {
  const roles = game.roles ?? []
  if (game.error !== undefined) return `- ${game.name}: ⚠️ ${game.error}`
  if (roles.length === 0) return `- ${game.name}: 无绑定角色`
  return roles
    .map((role) => {
      const icon = role.status === 'signed' ? '✅' : role.status === 'already' ? '☑️' : '❌'
      const days = role.totalDays === null || role.totalDays === undefined ? '' : `，累计 ${role.totalDays} 天`
      const award = role.award ? `，奖励「${role.award}」` : ''
      const why = role.status === 'failed' ? `，${role.message ?? '失败'}` : ''
      return `- ${game.name} · ${role.regionName} · ${role.nickname ?? role.uid}${icon} ${role.status}${days}${award}${why}`
    })
    .join('\n')
}

function renderReport(report) {
  const head = `米游社签到（${report.day}，${report.reason}）：${report.ok ? '全部正常' : '有失败项'}`
  const body = (report.games ?? []).map(line).join('\n')
  const signed = (report.games ?? []).flatMap((game) => game.roles ?? []).filter((role) => role.status === 'signed').length
  return `${head}\n本次新签到 ${signed} 个角色。\n${body}`
}

export function createTools({ service, onSettingsChanged }) {
  const status = defineTool({
    name: 'mys_checkin_status',
    description:
      '米游社签到状态：是否已登录、启用了哪些游戏、今天是否签过、最近几次运行结果。不含任何令牌或完整 uid。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          status: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const s = value.status ?? {}
        const games = (s.games ?? []).filter((game) => game.enabled).map((game) => game.name).join('、') || '未选择'
        const account = s.account ? `${s.account.nickname ?? '未命名'}（${s.account.uid ?? '?'}）` : '未登录'
        const last = s.history?.[0]
        const lastText = last
          ? `${shanghaiTime(last.at)} ${last.ok ? '全部成功' : '有失败'}`
          : '还没有运行记录'
        return text(
          `米游社签到\n- 账号：${account}\n- 启用游戏：${games}\n- 定时：${s.settings?.signTime ?? '?'}（随机延迟 ${s.settings?.jitterMinutes ?? 0} 分钟，自动=${s.settings?.autoSign === true ? '开' : '关'}）\n- 最近运行：${lastText}\n- 面板：${s.panelUrl ?? '/mys-checkin'}`,
        )
      },
    },
    async execute() {
      return { ok: true, status: service.status() }
    },
  })

  const now = defineTool({
    name: 'mys_checkin_now',
    description: '立即执行一次米游社签到（对已启用游戏的全部绑定角色）。返回每个角色的结果。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          report: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (value.ok !== true) return text(`签到失败：${value.error ?? '未知错误'}`)
        return text(renderReport(value.report))
      },
    },
    async execute() {
      try {
        const report = await service.runAll('manual')
        return { ok: true, report }
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
      }
    },
  })

  const games = defineTool({
    name: 'mys_checkin_games',
    description:
      '查看或设置要签到的游戏。不传 games 时返回列表；传 games 数组（genshin/starrail/zzz/honkai3rd/tears/honkai2）则更新选择。',
    parameters: {
      games: {
        type: 'array',
        items: { type: 'string' },
        description: '要启用的游戏 id 列表；省略则只查询。',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          games: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (value.ok !== true) return text(`设置失败：${value.error ?? '未知错误'}`)
        const rows = (value.games ?? [])
          .map((game) => `- ${game.enabled ? '✅' : '⬜'} ${game.name}（${game.id}）`)
          .join('\n')
        return text(`米游社签到游戏：\n${rows}`)
      },
    },
    async execute(args) {
      try {
        if (Array.isArray(args.games)) {
          await service.setSettings({ games: args.games })
          onSettingsChanged?.()
        }
        return { ok: true, games: service.games() }
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
      }
    },
  })

  const schedule = defineTool({
    name: 'mys_checkin_schedule',
    description: '查看或修改每日签到时间（HH:MM，Asia/Shanghai）、随机延迟分钟数、是否自动签到。',
    parameters: {
      signTime: { type: 'string', description: 'HH:MM，例如 00:30' },
      jitterMinutes: { type: 'integer', description: '0-120 的随机延迟分钟数' },
      autoSign: { type: 'boolean', description: '是否每天自动签到' },
      catchUp: { type: 'boolean', description: '启动时若当天未签到则补签' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          settings: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (value.ok !== true) return text(`设置失败：${value.error ?? '未知错误'}`)
        const s = value.settings ?? {}
        return text(`签到计划：每天 ${s.signTime}（Asia/Shanghai）+ 随机 0-${s.jitterMinutes} 分钟；自动=${s.autoSign ? '开' : '关'}，补签=${s.catchUp ? '开' : '关'}`)
      },
    },
    async execute(args) {
      try {
        const patch = {}
        if (typeof args.signTime === 'string') patch.signTime = args.signTime
        if (Number.isInteger(args.jitterMinutes)) patch.jitterMinutes = args.jitterMinutes
        if (typeof args.autoSign === 'boolean') patch.autoSign = args.autoSign
        if (typeof args.catchUp === 'boolean') patch.catchUp = args.catchUp
        if (Object.keys(patch).length > 0) {
          await service.setSettings(patch)
          onSettingsChanged?.()
        }
        const s = service.status().settings
        return { ok: true, settings: s }
      } catch (error) {
        return { ok: false, error: error?.message ?? String(error) }
      }
    },
  })

  return [status, now, games, schedule]
}
