# dsh-mys-checkin · 米游社全游戏每日签到

给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）用的 Cordis 插件：每天自动完成**米游社**（miHoYo BBS）里的游戏社区签到。

支持国服六个游戏，**安装后在面板里自己勾选要签哪几个**：

| 游戏 | id | act_id |
| --- | --- | --- |
| 原神 | `genshin` | e202311201442471 |
| 崩坏：星穹铁道 | `starrail` | e202304121516551 |
| 绝区零 | `zzz` | e202406242138391 |
| 崩坏3 | `honkai3rd` | e202306201626331 |
| 未定事件簿 | `tears` | e202202251749321 |
| 崩坏学园2 | `honkai2` | e202203291431091 |

## 特性

- **扫码登录**：用「米游社」App 扫一次码，插件自己换取并保存长期凭证；不读浏览器 cookie、不要密码。
- **侧边栏入口**：安装后 dsh 侧边栏会出现「米游社」图标，点开即面板（也可直接访问 `/mys-checkin`，但需经 dsh 会话）。
- **逐游戏选择**：面板勾选启用的游戏，每个游戏下所有绑定角色（含多区服）逐一签到。
- **米游币签到**：默认开启，游戏签完后顺带签「原神」「大别野」两个讨论区（每天 +30 米游币）。**只签到，不评论、不发帖、不点赞、不分享**。
- **每日定时**：默认 00:30（Asia/Shanghai）+ 0–10 分钟随机延迟；关机错过则启动时补签一次（签到幂等，`-5003` 视为已签）。
- **agent 工具**：`mys_checkin_status` / `mys_checkin_now` / `mys_checkin_games` / `mys_checkin_schedule`，可以直接让助手帮你查状态或立刻签到。
- **结果留痕**：每次运行记录每个角色的结果、累计天数、当日奖励名，面板里可看最近 14 次。

## 安装

```bash
dsh plugin --profile <profile> add dsh-mys-checkin
```

或者本地开发时把目录复制进 profile 的 `node_modules`，并把包名加进 profile `package.json` 的 `dsh.profile.bundles`。

重启 dsh 后打开面板：

```
http://127.0.0.1:<port>/mys-checkin
```

（默认端口以 `dsh web` 打印为准；桌面端通常是 127.0.0.1:55113。）

首次使用：点「获取二维码」→ 米游社 App 扫码 → 手机确认 → 勾选游戏 → 保存设置。

### 扫不了二维码怎么办（QQ / 手机无法扫码）

面板的登录卡里有一块「扫不了二维码？手动粘贴 cookie」：在电脑浏览器登录 `user.mihoyo.com` → `F12` → Application → Cookies → 复制 `cookie_token` 与 `ltoken` 两个值粘贴进去即可绑定，无需摄像头、无需短信验证码。

凭证大约 30 天会失效（换设备登录、账号风控、改密码会提前作废）。`mys_checkin_status` 会显示「凭证状态：已用 N 天」，接近 27 天时会提示尽快重新绑定；错误码与排查细节见 [docs/troubleshooting.zh.md](docs/troubleshooting.zh.md)。

## 配置

全部字段都有默认值，通常只在面板里改。需要写 YAML 时，在 profile 的 `cordis.patch.yml` 里按 row id 覆盖：

```yaml
- id: mys-checkin
  name: dsh-mys-checkin
  config:
    games: [genshin, starrail, zzz]
    signTime: "00:30"
    jitterMinutes: 10
    autoSign: true
    catchUp: true
    panelPath: /mys-checkin
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `games` | `[]` | 要签到的游戏；空表示还没选，面板里勾选后写入状态文件 |
| `signTime` | `00:30` | 每日执行时间（Asia/Shanghai） |
| `jitterMinutes` | `10` | 随机延迟上限（0–120 分钟） |
| `autoSign` | `true` | 是否自动执行 |
| `catchUp` | `true` | 启动时若当天没有运行记录则补签 |
| `panelPath` | `/mys-checkin` | 面板路径 |
| `dataPath` | 空 | 状态文件路径；空 = `$DSH_HOME/data/mys-checkin/state.json` |

## 安全与隐私（重要）

- 插件**不包含任何账号、token、cookie**；凭证只在你本机扫码后生成。
- 凭证保存在 `$DSH_HOME/data/mys-checkin/state.json`，文件权限 **0600**，原子写入。
- 令牌只出现在发往 `*.mihoyo.com` 的请求头里：不写日志、不出现在 agent 工具返回值、面板接口只回传掩码后的 UID。
- 卸载/换账号时删掉该状态文件即可；面板也有「退出登录」。
- 面板与 API 只挂在 dsh 的 **loopback** 端口上，没有独立鉴权：请勿把该端口暴露到公网或反代到外网。
- 同一台机器只维护一份凭证（单账号）；多账号请用不同的 `dataPath` 起第二个 profile。

## 返回码

| retcode | 含义 | 插件行为 |
| --- | --- | --- |
| `0` | 签到成功 | 记录奖励名与累计天数 |
| `-5003` | 今日已签到 | 视为成功，继续下一个角色 |
| `-100` / `-1001` | 凭证失效 | 用 stoken 换新的 cookie_token 重试一次；仍失败则提示重新扫码 |
| `-500001` | 缺 `x-rpc-signgame` 头或 DS 签名不匹配 | 检查游戏表里的 signgame / 客户端版本常量 |
| `10001` | 参数错误（act_id 过期等） | 更新 `lib/games.js` 里的 act_id |

## 已知限制

- 只支持**国服**（`cn_gf01` / `cn_qd01` 等）；国际服（HoYoLAB）端点与 salt 不同，未包含。
- 米游社客户端更新后 `BBS_VERSION` / `WEB_SALT` 可能失效，表现为 `-500001`，需要跟进更新 `lib/api.js`。
- **米游币签到需要 `stoken`**（扫码得到的凭证）。手动粘贴 `cookie_token`/`ltoken` 的账号只能签游戏，米游币会被跳过并在报告里说明。
- **不能自动登录**：米游社的密码登录与短信登录都有人机验证（aigis），插件只支持扫码与手动粘贴，且绝不保存密码。
- 定时依赖 dsh 进程存活；进程不在时靠下次启动的补签覆盖当天。
- 面板路径需要 dsh 的会话（侧边栏打开即可；用 node/curl 直连会 401）。
- 凭证约 30 天失效，换设备登录、风控或改密码会提前作废，需本人重新授权；升级与事故复盘见 [CHANGELOG.md](CHANGELOG.md) 与 [docs/troubleshooting.zh.md](docs/troubleshooting.zh.md)。

## 免责声明

本项目仅用于个人账号的签到自动化，与米哈游无关。请自行评估账号风险：保持低频率、只用本插件对**自己的**账号签到，不要用于批量/商业用途。因使用本插件造成的账号限制或损失，作者不承担责任。

## License

MIT
