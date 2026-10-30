import { chromium, errors } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { config } from './config.ts'
import { preCaptureSteps } from './db.ts'
import type { PreCaptureStep, Watch } from './db.ts'
import type { Capture } from './capture.ts'

const CLICK_TIMEOUT_MS = 5000

let browser: Browser | null = null
let pending: Promise<Browser> | null = null

/** Kill animation/caret noise before anything is measured or screenshotted. */
const STABILISE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html { scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; }
`

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser
  if (pending) return pending
  pending = (config.cdpUrl
    ? chromium.connectOverCDP(config.cdpUrl)
    : chromium.launch({
        executablePath: config.chromePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
      })
  ).then((b) => {
    browser = b
    pending = null
    b.on('disconnected', () => {
      browser = null
    })
    return b
  })
  return pending
}

export async function closeBrowser() {
  if (browser?.isConnected()) await browser.close().catch(() => {})
  browser = null
}

export async function renderPage(
  watch: Watch,
  opts: { screenshot?: boolean } = {},
): Promise<Capture> {
  const b = await getBrowser()
  const context = await b.newContext({
    viewport: config.viewport,
    userAgent: config.userAgent,
    locale: 'en-US',
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    extraHTTPHeaders: parseHeaders(watch.headers),
  })

  try {
    const page = await context.newPage()
    await page.goto(watch.url, { waitUntil: 'load', timeout: config.fetchTimeoutMs })
    await page.addStyleTag({ content: STABILISE_CSS }).catch(() => {})
    if (watch.wait_ms > 0) await page.waitForTimeout(watch.wait_ms)
    await settle(page)
    await runPreCaptureSteps(page, watch.pre_capture_steps)

    const html = await page.content()
    const finalUrl = page.url()
    if (!opts.screenshot) return { html, finalUrl }

    const target = watch.selector ? page.locator(watch.selector).first() : page
    const screenshot = await target.screenshot({
      type: 'png',
      ...(watch.selector ? {} : { fullPage: true }),
      animations: 'disabled',
      caret: 'hide',
    })
    return { html, finalUrl, screenshot }
  } finally {
    await context.close().catch(() => {})
  }
}

async function runPreCaptureSteps(page: Page, raw: string | null) {
  for (const step of preCaptureSteps(raw)) {
    await runClickStep(page, step)
    await settle(page)
  }
}

async function runClickStep(page: Page, step: PreCaptureStep) {
  const locator = page.locator(step.selector).first()
  try {
    if (!(await locator.count())) {
      console.warn(`[render] click step matched nothing: ${step.selector}`)
      return
    }
    await locator.click({ timeout: CLICK_TIMEOUT_MS })
  } catch (e) {
    if (!(e instanceof errors.TimeoutError))
      throw new Error(`click step failed for "${step.selector}": ${(e as Error).message}`)
    console.warn(`[render] click step found nothing clickable: ${step.selector}`)
  }
}

/** Scroll the page once so lazy-loaded content exists before we capture it. */
async function settle(page: Page) {
  await page
    .evaluate(async () => {
      const step = window.innerHeight
      const max = document.body.scrollHeight
      for (let y = 0; y < max; y += step) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
      await new Promise((r) => setTimeout(r, 150))
    })
    .catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
}

function parseHeaders(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? v : undefined
  } catch {
    return undefined
  }
}
