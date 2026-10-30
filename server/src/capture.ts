import { httpFetch } from './fetch.ts'
import type { Watch } from './db.ts'

export type Capture = {
  html: string
  finalUrl: string
  /** Present only on the render path. */
  screenshot?: Buffer
}

/**
 * Single entry point for getting a page. Cheap HTTP by default; the browser
 * path is used when the watch asks for JS rendering or needs a screenshot.
 */
export async function capture(watch: Watch): Promise<Capture> {
  const headers = watch.headers ? safeJson(watch.headers) : undefined
  const wantsShot = watch.mode === 'visual'

  if (watch.render || wantsShot || watch.pre_capture_steps) {
    const { renderPage } = await import('./render.ts')
    return renderPage(watch, { screenshot: wantsShot })
  }

  const res = await httpFetch(watch.url, { headers })
  return { html: res.html, finalUrl: res.finalUrl }
}

function safeJson(s: string): Record<string, string> | undefined {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? v : undefined
  } catch {
    return undefined
  }
}
