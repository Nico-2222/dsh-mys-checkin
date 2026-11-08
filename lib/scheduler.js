/**
 * Daily scheduling.
 *
 * dsh's scheduling seam is the timer service (`ctx.timeout`), not a cron
 * registry: one pending one-shot timer is re-armed after each run against the
 * next wall-clock occurrence of `settings.signTime`, plus a per-day random
 * jitter so many installs do not hit the API at the same second.
 *
 * A missed day (machine off) is recovered by the startup catch-up: when the
 * plugin mounts and today has no recorded run yet, one pass is attempted a
 * short delay later. Sign-in is idempotent (-5003), so a duplicate pass is
 * harmless.
 */
const TZ_OFFSET_MINUTES = 8 * 60 // Asia/Shanghai, no DST
const STARTUP_DELAY_MS = 20_000

function parseHhMm(text) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text ?? ''))
  if (!match) return { hour: 0, minute: 30 }
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/** Milliseconds from `now` until the next HH:MM occurrence in Asia/Shanghai. */
export function msUntilNext(signTime, now = new Date()) {
  const { hour, minute } = parseHhMm(signTime)
  // Shift the clock by the zone offset so UTC field access reads Shanghai
  // wall-clock time; the zone has no DST so a fixed offset is exact.
  const local = new Date(now.getTime() + TZ_OFFSET_MINUTES * 60_000)
  const target = new Date(local)
  target.setUTCHours(hour, minute, 0, 0)
  let delta = target.getTime() - local.getTime()
  if (delta <= 0) delta += 24 * 60 * 60_000
  return delta
}

export function startScheduler(ctx, { service, log }) {
  let timer
  let stopped = false
  let running = false

  const settings = () => service.store.state.settings

  const arm = () => {
    if (stopped) return
    const current = settings()
    if (current.autoSign !== true) {
      log.info('mys-checkin: auto sign disabled; scheduler idle')
      return
    }
    const jitter = Math.floor(Math.random() * Math.max(0, current.jitterMinutes ?? 0) * 60_000)
    const delay = msUntilNext(current.signTime) + jitter
    timer?.()
    timer = ctx.timeout(() => {
      void run('schedule')
    }, delay)
    log.info(`mys-checkin: next automatic run in ${Math.round(delay / 60_000)} min`)
  }

  const run = async (reason) => {
    if (running || stopped) return
    running = true
    try {
      const report = await service.runAll(reason)
      log.info(`mys-checkin: ${reason} run done, ok=${report.ok}`)
    } catch (error) {
      if (error?.code === 'NO_ACCOUNT' || error?.code === 'LOGIN_EXPIRED') {
        log.warn(`mys-checkin: ${reason} run skipped — ${error.message}`)
      } else {
        log.error(`mys-checkin: ${reason} run failed`, error)
      }
    } finally {
      running = false
      if (!stopped) arm()
    }
  }

  const catchUpWanted = () => {
    const current = settings()
    if (current.catchUp !== true) return false
    // Nothing to do before the user has picked games.
    if ((current.games ?? []).length === 0) return false
    const state = service.store.state
    if (!state.account?.stoken) return false
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    return !(state.history ?? []).some((entry) => String(entry.at ?? '').slice(0, 10) === day)
  }

  if (settings().autoSign === true) {
    if (catchUpWanted()) {
      timer = ctx.timeout(() => {
        void run('catch-up')
      }, STARTUP_DELAY_MS)
      log.info(`mys-checkin: no run recorded today; catch-up in ${Math.round(STARTUP_DELAY_MS / 1000)}s`)
    } else {
      arm()
    }
  }

  return {
    stop() {
      stopped = true
      timer?.()
    },
    /** Re-read settings (e.g. after the panel saved a new time) and re-arm. */
    resync() {
      if (stopped) return
      timer?.()
      if (catchUpWanted()) {
        timer = ctx.timeout(() => {
          void run('catch-up')
        }, STARTUP_DELAY_MS)
      } else {
        arm()
      }
    },
  }
}
