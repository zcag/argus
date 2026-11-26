import { execFile } from 'node:child_process'
import { config } from '../config.ts'
import type { Watch } from '../db.ts'
import { abs } from '../storage.ts'
import { channelsFor, settings } from '../settings.ts'
import type { ChannelId } from '../settings.ts'
import { describe } from './describe.ts'
import type { ChangeFacts } from './describe.ts'
import { buildMessage } from './render.ts'
import type { Message } from './render.ts'
import { sendEmail } from './email.ts'
import { VisualMode } from '../../../shared/visual.ts'

export type ChangeEvent = {
  watch: Watch
  checkId: number
  summary: Record<string, unknown> | null
  changePct: number
  diffPath: string | null
  shotPath?: string | null
  prevShotPath?: string | null
}

export async function notifyChange(ev: ChangeEvent) {
  const facts = describe(ev.summary as never, ev.changePct)
  const link = `${config.baseUrl}/w/${ev.watch.id}`
  const msg = buildMessage(ev.watch, facts, link, new Date(), ev.watch.visual_mode)
  const image = getNotificationImage(ev)

  const chosen = channelsFor(ev.watch.notify_channels)
  if (!chosen.length) return

  // One failing channel must not stop the others.
  const results = await Promise.allSettled(
    chosen.map((c) => deliver(c, msg, facts, ev, image)),
  )
  results.forEach((r, i) => {
    if (r.status === 'rejected')
      console.error(`[notify] ${chosen[i]} failed:`, (r.reason as Error)?.message ?? r.reason)
  })
}

function getNotificationImage(e: ChangeEvent): string[] {
    if (e.watch.visual_mode === VisualMode.AFTER && e.shotPath) return [abs(e.shotPath)]
    if (e.watch.visual_mode === VisualMode.SIDE && e.shotPath && e.prevShotPath) return [abs(e.prevShotPath), abs(e.shotPath)]
    // default notification image is overlay
    if (e.diffPath) return [abs(e.diffPath)]
    // fallback to single image when overlay image is missing
    if (e.shotPath) return [abs(e.shotPath)]
    return []
}

async function deliver(
  channel: ChannelId,
  msg: Message,
  facts: ChangeFacts,
  ev: ChangeEvent,
  images: string[],
) {
  const s = settings()
  switch (channel) {
    case 'email':
      return sendEmail(s.email, msg, images, ev.watch.name)
    case 'webhook':
      return sendWebhook(ev.watch.notify_webhook || s.webhook.url, msg, facts, ev)
    case 'command':
      return runCommand(s.command.bin, s.command.args, msg.text, ev.watch.notify_stream, images)
  }
}

async function sendWebhook(url: string, msg: Message, facts: ChangeFacts, ev: ChangeEvent) {
  if (!url) throw new Error('webhook: no URL configured')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      watch: {
        id: ev.watch.id,
        name: ev.watch.name,
        url: ev.watch.url,
        mode: ev.watch.mode,
      },
      check_id: ev.checkId,
      headline: facts.headline,
      details: facts.details,
      numbers: facts.numbers,
      added: facts.added,
      removed: facts.removed,
      change_pct: facts.changePct,
      regions: facts.regions ?? null,
      excerpt: facts.excerpt,
      link: `${config.baseUrl}/w/${ev.watch.id}`,
      text: msg.text,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`webhook: HTTP ${res.status}`)
}

function runCommand(bin: string, args: string, body: string, stream: string | null, images: string[]) {
  const argv = args.split(/\s+/).filter(Boolean)
  if (stream) argv.push('--stream', stream)
  for (const image of images) argv.push('--file', image)
  return new Promise<void>((resolve, reject) => {
    execFile(bin, [...argv, body], { timeout: 120_000 }, (err, _out, stderr) =>
      err ? reject(new Error(`${bin}: ${stderr.trim() || err.message}`)) : resolve(),
    )
  })
}

/** Sends a representative message through one channel, for the settings page. */
export async function sendTest(channel: ChannelId) {
  const watch = {
    id: 0,
    name: 'Test watch',
    url: 'https://example.com/pricing',
    mode: 'text',
    interval_sec: 3600,
    notify_webhook: null,
  } as Watch

  const facts = describe(
    {
      kind: 'text',
      added: 2,
      removed: 2,
      changePct: 4.2,
      parts: [
        { t: 'del', lines: ['Standard plan: 199 USD / month', 'Seats included: 5'] },
        { t: 'add', lines: ['Standard plan: 149 USD / month', 'Seats included: 10'] },
      ],
    } as never,
    4.2,
  )

  const msg = buildMessage(watch, facts, `${config.baseUrl}/`, new Date())
  msg.subject = `[test] ${msg.subject}`
  msg.text = `[test] ${msg.text}`
  await deliver(
    channel,
    msg,
    facts,
    { watch, checkId: 0, summary: null, changePct: 4.2, diffPath: null },
    [],
  )
}
