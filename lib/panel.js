/**
 * Settings panel HTML, served from `panel.html` on every request.
 *
 * Keeping the markup in its own file means a styling tweak is a file save —
 * no code reload, no host restart — while the route still owns the base path:
 * `__BASE__` tokens in the template are replaced with the configured panel
 * path so the page can move without a rebuild.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), 'panel.html')
let cache = { mtimeMs: -1, text: '' }

export function panelHtml({ basePath }) {
  const { mtimeMs } = statSync(HTML_PATH)
  if (mtimeMs !== cache.mtimeMs) cache = { mtimeMs, text: readFileSync(HTML_PATH, 'utf8') }
  return cache.text.replaceAll('__BASE__', basePath)
}
