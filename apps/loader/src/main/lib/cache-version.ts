import { app, session } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * A new version must not inherit the old version's cache.
 *
 * The film is cached for a day, which is right — it is large and its name never changes.
 * But 1.0.28 fixed how it is served: before it, the API sent video with no length and no
 * range support, so the copy Chromium already holds cannot seek, and so cannot loop. No
 * server fix reaches a file that is already in the cache; the person who updated would
 * keep the worse film until the next day and conclude nothing was fixed.
 *
 * So it is cleared once per version, on the first start after an update. The images come
 * back in a second and the film re-fetches once.
 */

function marker(): string {
  return join(app.getPath('userData'), 'cache-version.txt')
}

function previous(): string {
  try {
    return readFileSync(marker(), 'utf8').trim()
  } catch {
    // First run: nothing was cached under any version.
    return ''
  }
}

export async function clearCacheOnUpdate(): Promise<void> {
  const current = app.getVersion()
  if (previous() === current) return

  try {
    await session.defaultSession.clearCache()
  } catch (error) {
    console.error('[cache] could not clear', error)
  }

  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(marker(), current, 'utf8')
  } catch (error) {
    console.error('[cache] could not record the version', error)
  }
}
