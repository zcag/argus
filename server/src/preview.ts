import { randomUUID } from 'node:crypto'
import { httpFetch } from './fetch.ts'
import { extractText, pageTitle } from './extract.ts'
import type { PreCaptureStep, Watch } from './db.ts'

type Capture = {
  token: string
  url: string
  finalUrl: string
  html: string
  title: string | null
  shot: Buffer | null
  at: number
}

const TTL = 5 * 60_000
const MAX = 6
const captures = new Map<string, Capture>()

/**
 * Cache key deliberately ignores the selector unless a screenshot is wanted, so
 * trying selector after selector in text/element mode reuses one fetch and feels
 * instant. A visual preview of a specific element genuinely needs its own capture.
 */
const keyFor = (url: string, render: boolean, shotSelector: string, preCaptureSteps: string) =>
  `${url}|${render ? 'r' : 'h'}|${shotSelector}|${preCaptureSteps}`

function sweep() {
  const now = Date.now()
  for (const [k, c] of captures) if (now - c.at > TTL) captures.delete(k)
  while (captures.size > MAX) captures.delete(captures.keys().next().value!)
}

export type PreviewResult = {
  token: string
  title: string | null
  finalUrl: string
  chars: number
  sample: string
  hasShot: boolean
  selectorMatched: boolean
  error?: string
}

export async function makePreview(opts: {
  url: string
  render: boolean
  selector?: string | null
  wantShot: boolean
  preCaptureSteps?: PreCaptureStep[]
}): Promise<PreviewResult> {
  sweep()
  const selector = opts.selector?.trim() || null
  const shotSelector = opts.wantShot && selector ? selector : ''
  const steps = opts.preCaptureSteps?.length ? JSON.stringify(opts.preCaptureSteps) : null
  const effectiveRender = opts.render || opts.wantShot || !!steps
  const key = keyFor(opts.url, effectiveRender, shotSelector, steps ?? '')

  let capture = captures.get(key)
  if (!capture || (opts.wantShot && !capture.shot)) {
    capture = await capturePage(
      opts.url,
      effectiveRender,
      opts.wantShot,
      shotSelector || null,
      steps,
    )
    captures.set(key, capture)
  }

  // Extraction is cheap and depends on the selector, so always run it fresh.
  let sample = ''
  let selectorMatched = true
  try {
    sample = extractText(capture.html, { selector })
  } catch {
    selectorMatched = false
  }

  return {
    token: capture.token,
    title: capture.title,
    finalUrl: capture.finalUrl,
    chars: sample.length,
    sample: sample.slice(0, 20_000),
    hasShot: !!capture.shot,
    selectorMatched,
  }
}

async function capturePage(
  url: string,
  render: boolean,
  wantShot: boolean,
  shotSelector: string | null,
  preCaptureSteps: string | null,
): Promise<Capture> {
  const token = randomUUID()
  if (render || wantShot) {
    const { renderPage } = await import('./render.ts')
    const watch = {
      url,
      selector: shotSelector,
      headers: null,
      wait_ms: 0,
      pre_capture_steps: preCaptureSteps,
    } as Watch
    const out = await renderPage(watch, { screenshot: wantShot })
    return {
      token,
      url,
      finalUrl: out.finalUrl,
      html: out.html,
      title: pageTitle(out.html),
      shot: out.screenshot ?? null,
      at: Date.now(),
    }
  }
  const out = await httpFetch(url)
  return {
    token,
    url,
    finalUrl: out.finalUrl,
    html: out.html,
    title: pageTitle(out.html),
    shot: null,
    at: Date.now(),
  }
}

export const previewShot = (token: string): Buffer | null => {
  for (const c of captures.values()) if (c.token === token) return c.shot
  return null
}

export const previewTitle = (token: string): string | null => {
  for (const c of captures.values()) if (c.token === token) return c.title
  return null
}
