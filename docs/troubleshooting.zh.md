# 凭证与故障排查（凭证 / troubleshooting）

本文件记录 2026-11 排查「签到突然失败」时确认的事实，改动代码前请先读。

## 1. 错误码到底什么意思

| retcode | 米游社原文 | 实际含义 | 插件应该怎么做 |
| --- | --- | --- | --- |
| `0` | ok | 成功 | 正常处理 |
| `-5003` | 已签到 | 今天已经签过 | 视为成功（`already`） |
| `-100` | 请登录后重试（-100）/ 登录状态失效，请重新登录 | 这套 cookie 对这个接口无效（通常是 token 过期，或账号需要重新验证） | 标 `invalid`，提示重新绑定 |
| `-464` | 请使用最新版本产品/链接以获得更佳体验，或前往 user.mihoyo.com 完成操作 | **不是版本问题**：`getCookieAccountInfoBySToken` 这类换 token 的接口一旦带上 `mid=`（那串 `0mok…`）就返回它 | 换 token 时**只能**用数字 `stuid`/`uid`，不能带 `mid` |
| `-3235` | 您的账号存在安全风险，为确保是您本人操作，请先验证身份后再登录 | 账号级风控：必须账号本人在 user.mihoyo.com / App 内完成身份验证 | 明确告知用户去官方验证，不要重试 |
| `-3101` | 请求频繁，请稍后再试 | 同一 IP/设备短时间多次登录尝试 | 退避，隔 2–10 分钟再试 |
| `-3501` | 二维码已失效 | 扫码 ticket 过期（约 3 分钟） | 重新生成二维码 |

## 2. 换 token 的正确姿势

`getCookieAccountInfoBySToken` / `getLTokenBySToken`：

```
GET https://passport-api.mihoyo.com/account/auth/api/getCookieAccountInfoBySToken
    ?stoken=<v2_...>&uid=<数字 stuid>
    Cookie: stoken=<v2_...>; stuid=<数字 stuid>
```

- `uid` 必须是**数字**（账号 id / QR 确认回包里的 `aid`），传 `mid` 必然 `-464`。
- 之前代码用 `account.mid` 传参，导致「登录成功但换不到 cookie_token」，对外表现为「明明刚扫码，还是提示版本过低」——这就是那次事故的根因。

## 3. 凭证多久失效

- 米游社没有公开有效期；实测 app 端 token 大约 **30 天**，且会在下列情况**提前作废**：
  - 在别的设备重新登录同一账号；
  - 账号被判风控（`-3235`），需本人验证；
  - 改密码。
- 因此：`state.account.updatedAt` 被当作「绑定时间」，`service.status()` 会给出 `ageDays` / `expiringSoon`（≥27 天），面板和 `mys_checkin_status` 都会读它。
- 建议的运维节奏：**过期前 ≥3 天提醒用户重新绑定**，而不是等签到失败才发现。

## 4. 为什么不能用「手机号 + 密码」或「短信验证码」自动登录

两条路都被米游社的人机验证（aigis）挡住：

- `POST /account/ma-cn-passport/app/loginByPassword`（账号密码 RSA 加密）→ 需要 `x-rpc-aigis` 挑战，人机滑块过不去就是 `-3101` / `-3235`；
- `POST /account/ma-cn-verifier/verifier/createLoginCaptcha`（发短信）→ 同样要 aigis。

结论：**第三方工具只能走扫码授权**（`createQRLogin` + `queryQRLoginStatus`），或由用户手动把已有会话的 cookie 交给插件。

## 5. 扫码在 QQ 场景下的死循环（重要 UX 问题）

绑定 QQ 对话时：二维码是图片、链接点不开、手机也无法「从相册扫二维码」（米游社 App 只认摄像头）。
可用的替代路径，按优先级：

1. **本机浏览器代登录**：用户在电脑浏览器登录 `user.mihoyo.com` 后，插件读取该浏览器会话（需浏览器 cookie 可读，例如 DSH 内置浏览器，其 cookie 库为明文存储）；
2. **手动粘贴 cookie**：用户从 DevTools 复制 `cookie_token` / `ltoken` 交给插件（一次性）；
3. 扫码：仅在用户能对着屏幕扫描时可行。

> 现状：DSH 内置浏览器与 Edge 的 cookie 库在运行期都被独占锁定（`Copy-Item` 报「正由另一进程使用」，`node:sqlite` 打不开），所以「代登录后读取」需要先让对应浏览器退出，或改用插件内的手动粘贴。

## 6. 复现/验证脚本（已删除，仅作记录）

排查期间写过一批一次性脚本（`probe-sign.mjs`、`probe-creds.mjs`、`probe-refresh.mjs`、`relogin-flow.mjs`、`qr-on-screen.mjs`、`paste-cookie.mjs`、`read-dsh-cookies.mjs`），验证完即删，避免仓库里留下会把凭证明文写盘的代码。

如果再次遇到同类问题，按下面的顺序手工复现即可（用 `node --input-type=module` 或任意临时文件，读 `state.json` 里的 account/device）：

1. `GET /event/luna/info?act_id=…&region=cn_gf01&uid=…` —— 带 `x-rpc-signgame: hk4e`，看是 `-100` 还是 `0`；
2. `GET /binding/api/getUserGameRolesByCookie?game_biz=hk4e_cn` —— 区分「cookie 有效」与「token 失效」；
3. `GET /account/auth/api/getCookieAccountInfoBySToken?stoken=…&uid=<数字>` —— 用 **数字 uid**，带 `mid` 会得到误导性的 `-464`；
4. `POST /apihub/app/api/signIn`（`bbs-api.miyoushe.com`）—— 只有 `stoken` 有效时才会 `retcode 0`。
