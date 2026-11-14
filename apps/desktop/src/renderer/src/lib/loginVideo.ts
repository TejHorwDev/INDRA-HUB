import { useEffect, useState } from 'react'
import type { PublicAppearance } from '@shared/types'
import { errorMessage } from './api'
import { api } from './api'

/*
 * The sign-in background video, as something a <video> element can play.
 *
 * The bytes come from the main process and become a Blob URL here. That is
 * deliberate: a Blob URL is an ordinary media source for Chromium, so playback
 * does not depend on a custom scheme being registered correctly, on CSP
 * scheme sources, or on range handling — the three things that were hardest to
 * verify and most likely to differ between a dev build and the packaged app.
 *
 * One Blob per asset is kept for the life of the window: signing out and back
 * in should not re-read forty megabytes off disk every time.
 */

export interface LoginVideoSource {
  url: string
  mime: string
  bytes: number
}

let cache: { key: string; url: string } | null = null

/**
 * A Uint8Array from IPC can be backed by any ArrayBufferLike; Blob wants a
 * plain ArrayBuffer. Copying here is one allocation for one upload.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

/** Drops the cached Blob; used after the administrator replaces the video. */
export function forgetLoginVideo(): void {
  if (!cache) return
  URL.revokeObjectURL(cache.url)
  cache = null
}

export function useLoginVideo(appearance: PublicAppearance | null): {
  source: LoginVideoSource | null
  error: string | null
} {
  const [source, setSource] = useState<LoginVideoSource | null>(null)
  const [error, setError] = useState<string | null>(null)

  const assetId = appearance?.assetId ?? null
  const hasVideo = Boolean(appearance?.hasVideo && assetId)
  const mime = appearance?.mime ?? null
  const bytes = appearance?.bytes ?? 0

  useEffect(() => {
    let active = true

    if (!hasVideo || !assetId) {
      setSource(null)
      setError(null)
      return
    }

    if (cache?.key === assetId) {
      setSource({ url: cache.url, mime: mime ?? 'video/mp4', bytes })
      return
    }

    api.appearance
      .video()
      .then((file) => {
        if (!active || !file) return
        const blob = new Blob([toArrayBuffer(file.bytes)], { type: file.mime })
        const url = URL.createObjectURL(blob)
        forgetLoginVideo()
        cache = { key: assetId, url }
        setSource({ url, mime: file.mime, bytes: blob.size })
        setError(null)
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught))
      })

    return () => {
      active = false
    }
  }, [assetId, hasVideo, mime, bytes])

  return { source, error }
}
