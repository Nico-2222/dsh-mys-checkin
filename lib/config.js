/**
 * Plugin configuration (Schemastery). Every field has a default, so an empty
 * patch row is a valid install; users normally change `games` / `signTime`
 * from the panel instead of editing YAML.
 */
import Schema from '@deepseek-ai/schemastery'
import { GAME_IDS } from './games.js'

const GameId = Schema.union(GAME_IDS.map((id) => Schema.const(id)))

export const Config = Schema.object({
  dataPath: Schema.string().default('').description(
    'State file path. Empty resolves to $DSH_HOME/data/mys-checkin/state.json, then ./.mys-checkin/state.json.',
  ),
  games: Schema.array(GameId).default([]).description(
    'Games to check in for. Empty means nothing is selected yet: pick them once in the panel (/mys-checkin), or set them here.',
  ),
  signTime: Schema.string().pattern(/^([01]?\d|2[0-3]):[0-5]\d$/).default('00:30').description(
    'Local Asia/Shanghai wall-clock time for the daily run.',
  ),
  jitterMinutes: Schema.natural().min(0).max(120).default(10).description(
    'Random delay (minutes) added to signTime, to avoid hitting the API at the exact same second every day.',
  ),
  autoSign: Schema.boolean().default(true).description('Run automatically every day.'),
  catchUp: Schema.boolean().default(true).description(
    'On startup, run one pass if today has no recorded run (covers a machine that was off at signTime).',
  ),
  panelPath: Schema.string().default('/mys-checkin').description('HTTP path of the settings panel.'),
}).description('米游社 daily check-in for 原神 / 星穹铁道 / 绝区零 / 崩坏3 / 未定事件簿 / 崩坏学园2.')

export default Config
