/**
 * Supported miHoYo games (mainland China, cn).
 *
 * Every game signs through the same Takumi "luna" envelope:
 *   GET  /event/luna/{home,info}?act_id=...&lang=zh-cn
 *   POST /event/luna/sign        { act_id, region, uid }
 * with the CS game id in `x-rpc-signgame`. 绝区零 has its own path prefix.
 *
 * `act_id` is published per activity/semester and changes over time; when a
 * game starts answering 10001/param-error on a valid session, refresh the id
 * from the current 米游社 activity page.
 */
export const GAMES = Object.freeze({
  genshin: {
    id: 'genshin',
    name: '原神',
    nameEn: 'Genshin Impact',
    actId: 'e202311201442471',
    gameBiz: 'hk4e_cn',
    signgame: 'hk4e',
    path: 'luna',
  },
  starrail: {
    id: 'starrail',
    name: '崩坏：星穹铁道',
    nameEn: 'Honkai: Star Rail',
    actId: 'e202304121516551',
    gameBiz: 'hkrpg_cn',
    signgame: 'hkrpg',
    path: 'luna',
  },
  zzz: {
    id: 'zzz',
    name: '绝区零',
    nameEn: 'Zenless Zone Zero',
    actId: 'e202406242138391',
    gameBiz: 'nap_cn',
    signgame: 'zzz',
    path: 'luna/zzz',
  },
  honkai3rd: {
    id: 'honkai3rd',
    name: '崩坏3',
    nameEn: 'Honkai Impact 3rd',
    actId: 'e202306201626331',
    gameBiz: 'bh3_cn',
    signgame: 'bh3',
    path: 'luna',
  },
  tears: {
    id: 'tears',
    name: '未定事件簿',
    nameEn: 'Tears of Themis',
    actId: 'e202202251749321',
    gameBiz: 'nxx_cn',
    signgame: 'nxx',
    path: 'luna',
  },
  honkai2: {
    id: 'honkai2',
    name: '崩坏学园2',
    nameEn: 'Honkai Gakuen 2',
    actId: 'e202203291431091',
    gameBiz: 'bh2_cn',
    signgame: 'bh2',
    path: 'luna',
  },
})

export const GAME_IDS = Object.freeze(Object.keys(GAMES))

export function getGame(id) {
  return Object.prototype.hasOwnProperty.call(GAMES, id) ? GAMES[id] : undefined
}

/** Public shape handed to the browser/tools; no secrets, no ids. */
export function gameSummary(game) {
  return { id: game.id, name: game.name, nameEn: game.nameEn }
}
