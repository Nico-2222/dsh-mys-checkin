/**
 * Persisted plugin state (credentials, settings, run history).
 *
 * Lives outside the repository: `$DSH_HOME/data/mys-checkin/state.json`.
 * The file holds a live stoken/cookie_token and is therefore chmod 0600 and
 * written atomically. Nothing in this module ever logs or returns the token
 * values themselves — callers get booleans and masked ids only.
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const VERSION = 1

function emptyState() {
  return {
    version: VERSION,
    device: null,
    account: null,
    settings: {
      games: [],
      signTime: '00:30',
      jitterMinutes: 10,
      autoSign: true,
      catchUp: true,
    },
    history: [],
    lastRun: null,
  }
}

export class Store {
  constructor(path) {
    this.path = path
    this.state = emptyState()
    this.loaded = false
    this.queue = Promise.resolve()
  }

  async load() {
    try {
      const text = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(text)
      this.state = { ...emptyState(), ...parsed, settings: { ...emptyState().settings, ...(parsed.settings ?? {}) } }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      this.state = emptyState()
    }
    this.loaded = true
    return this.state
  }

  snapshot() {
    return structuredClone(this.state)
  }

  /** Serialised read-modify-write; `mutator` may return a replacement state. */
  async update(mutator) {
    const run = this.queue.then(async () => {
      const draft = structuredClone(this.state)
      const result = await mutator(draft)
      this.state = result ?? draft
      await this.persist()
      return this.state
    })
    this.queue = run.catch(() => {})
    return run
  }

  async persist() {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.tmp`
    await writeFile(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, this.path)
    try {
      await chmod(this.path, 0o600)
    } catch {
      // Windows: mode bits are advisory; ACL inheritance already restricts it.
    }
  }

  /** Keep history bounded so the state file stays small. */
  recordRun(entry, keep = 60) {
    return this.update((draft) => {
      draft.history = [entry, ...(draft.history ?? [])].slice(0, keep)
      draft.lastRun = entry.at
      return draft
    })
  }
}
