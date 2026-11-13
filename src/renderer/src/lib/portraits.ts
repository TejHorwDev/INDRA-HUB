import { useEffect, useState } from 'react'
import { api } from './api'

/**
 * Portraits that are photographs.
 *
 * The renderer never gets a path: it asks the main process for the bytes by
 * asset id and draws them from a Blob URL. One cache holds the URL per asset,
 * so a person who appears in the rail, on a card and in three member rows is
 * fetched once and drawn five times.
 *
 * The cache is keyed by the id inside `photo:<id>`, which changes whenever the
 * photo is replaced, so a new picture can never be served the old bytes.
 */

const urls = new Map<string, string>()
const loading = new Map<string, Promise<string | null>>()

export function portraitId(avatar?: string | null): string | null {
  if (!avatar || !avatar.startsWith('photo:')) return null
  return avatar.slice('photo:'.length) || null
}

function load(id: string): Promise<string | null> {
  const ready = urls.get(id)
  if (ready) return Promise.resolve(ready)
  const inFlight = loading.get(id)
  if (inFlight) return inFlight

  const task = api.auth
    .portraitBytes(id)
    .then((file) => {
      if (!file || !file.bytes?.length) return null
      // Copy into a fresh buffer: the bytes arrive typed as ArrayBufferLike,
      // and Blob will not take a SharedArrayBuffer view.
      const copy = new Uint8Array(file.bytes.length)
      copy.set(file.bytes)
      const blob = new Blob([copy.buffer as ArrayBuffer], { type: file.mime || 'image/png' })
      const url = URL.createObjectURL(blob)
      urls.set(id, url)
      return url
    })
    .catch(() => null)
    .finally(() => {
      loading.delete(id)
    })

  loading.set(id, task)
  return task
}

/** The Blob URL for a `photo:` portrait, or null while it loads. */
export function usePortraitUrl(avatar?: string | null): string | null {
  const id = portraitId(avatar)
  const [url, setUrl] = useState<string | null>(() => (id ? (urls.get(id) ?? null) : null))

  useEffect(() => {
    if (!id) {
      setUrl(null)
      return
    }

    const ready = urls.get(id)
    if (ready) {
      setUrl(ready)
      return
    }

    let alive = true
    setUrl(null)
    void load(id).then((next) => {
      if (alive) setUrl(next)
    })
    return () => {
      alive = false
    }
  }, [id])

  return url
}

/** Drops a cached URL — used after replacing a photo in the account panel. */
export function forgetPortrait(avatar?: string | null): void {
  const id = portraitId(avatar)
  if (!id) return
  const url = urls.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urls.delete(id)
  }
}
