# dsh-mys-checkin · MiYoushe daily check-in for dsh

A [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (dsh) Cordis bundle that performs the daily
**miHoYo BBS (米游社) game check-in** for every role bound to your account — 原神, 崩坏：星穹铁道,
绝区零, 崩坏3, 未定事件簿, 崩坏学园2 — with per-game selection, a daily schedule, and agent tools.

## Features

- **QR login** — scan once with the 米游社 App; the plugin exchanges the ticket for long-lived
  credentials itself. No browser cookie jar, no password.
- **Pick your games** — enable only the games you play; every bound role (across regions) is signed.
- **Daily schedule** — default 00:30 Asia/Shanghai plus a random 0–10 min jitter; a startup catch-up
  covers a machine that was off at the scheduled time (sign-in is idempotent: `-5003` means already signed).
- **Agent tools** — `mys_checkin_status`, `mys_checkin_now`, `mys_checkin_games`,
  `mys_checkin_schedule`.
- **Audit trail** — per-role result, cumulative day count and the day's reward name, last 14 runs.

## Install

```bash
dsh plugin --profile <profile> add dsh-mys-checkin
```

For local development, copy this directory into the profile's `node_modules` and add the package name
to `dsh.profile.bundles` in the profile's `package.json`.

After a restart open the panel:

```
http://127.0.0.1:<port>/mys-checkin
```

## Configuration

Every field has a default; most users only touch the panel. To configure in YAML, override the row in
the profile's `cordis.patch.yml`:

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

| key | default | meaning |
| --- | --- | --- |
| `games` | `[]` | enabled games; empty means "not chosen yet" — pick in the panel |
| `signTime` | `00:30` | daily wall-clock time, Asia/Shanghai |
| `jitterMinutes` | `10` | random delay ceiling (0–120) |
| `autoSign` | `true` | enable the scheduler |
| `catchUp` | `true` | run once on startup when today has no recorded run |
| `panelPath` | `/mys-checkin` | panel route |
| `dataPath` | empty | state file; empty = `$DSH_HOME/data/mys-checkin/state.json` |

## Security & privacy

- The package ships **no account, token or cookie**. Credentials exist only after *you* scan a QR.
- They are stored in `$DSH_HOME/data/mys-checkin/state.json` with mode **0600**, written atomically.
- Tokens appear only in request headers to `*.mihoyo.com`: never in logs, never in tool output, and
  the panel API returns only a masked UID.
- To revoke, delete the state file or use "退出登录" in the panel.
- The panel and its API ride the dsh **loopback** port and carry no separate auth: do not expose that
  port to the internet or put it behind a public reverse proxy.
- One account per state file; a second account needs a second profile with its own `dataPath`.

## Return codes

| retcode | meaning | behaviour |
| --- | --- | --- |
| `0` | signed | records reward + cumulative days |
| `-5003` | already signed today | treated as success |
| `-100` / `-1001` | credential expired | refresh cookie_token from stoken once, then ask to re-scan |
| `-500001` | missing `x-rpc-signgame` or stale DS salt | check `signgame` and client constants |
| `10001` | parameter error (stale act_id) | update `act_id` in `lib/games.js` |

## UI assets

The miyoushe wordmark and the six official community avatars under `lib/assets/` are fetched from
miHoYo's public community CDN (`bbs-static.miyoushe.com`, `fastcdn.mihoyo.com`,
`www.miyoushe.com/assets`) purely so the panel is recognisable. All trademarks and artwork remain
miHoYo's property; this project claims no rights and represents no affiliation. Remove the images at
any time — the panel degrades to text-only labels.

Panel markup lives in `lib/panel.html` and is re-read on every request, so restyling is a file save
(no plugin reload needed after the first restart).

## Limitations

- Mainland China servers only; HoYoLAB (global) uses different endpoints and salts.
- After a miHoYo client update, `BBS_VERSION` / `WEB_SALT` may need bumping (symptom: `-500001`).
- Game check-in only — no 米游币 community tasks, cloud-game sign-in, or mall exchange.
- Scheduling depends on the dsh process being alive; the startup catch-up covers the rest.

## Disclaimer

Personal-use automation, not affiliated with miHoYo. Use it on your own account, at low frequency;
batch or commercial use may get the account restricted. No warranty.

## License

MIT
