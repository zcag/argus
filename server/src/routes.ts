import { readFileSync, statSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { all, get, run, bind, preCaptureSteps } from './db.ts'
import type { Check, PreCaptureStep, Watch } from './db.ts'
import { config } from './config.ts'
import { abs, readText, removeWatchDir } from './storage.ts'
import { checkNow, isRunning } from './scheduler.ts'
import { httpFetch } from './fetch.ts'
import { extractText, pageTitle } from './extract.ts'
import { wordDiff } from './diff.ts'
import { suggestIgnores } from './suggest.ts'
import { makePreview, previewShot } from './preview.ts'
import { normalizeUrl } from './url.ts'
import { redactedSettings, saveSettings, settings, unmask } from './settings.ts'
import type { ChannelId } from './settings.ts'
import { sendTest } from './notify/index.ts'

const WRITABLE = [
  'name',
  'url',
  'mode',
  'selector',
  'render',
  'interval_sec',
  'enabled',
  'ignore_selectors',
  'ignore_regex',
  'min_change_pct',
  'notify_stream',
  'notify_webhook',
  'notify_channels',
  'headers',
  'wait_ms',
  'pre_capture_steps',
] as const

/** Arrays/objects arrive as JSON values from the UI but are stored as text. */
const packed = (key: string, value: unknown) =>
  ['ignore_selectors', 'ignore_regex', 'headers', 'notify_channels', 'pre_capture_steps'].includes(key) &&
  value !== null &&
  typeof value === 'object'
    ? JSON.stringify(value)
    : bind(value)

function stepsError(body: Record<string, unknown>): string | null {
  if (!('pre_capture_steps' in body)) return null
  try {
    const steps = preCaptureSteps(body.pre_capture_steps)
    body.pre_capture_steps = steps.length ? steps : null
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const LIST_SQL = `
  select w.*,
    (select id from checks c where c.watch_id=w.id and c.status='ok' order by c.started_at desc limit 1) as last_check_id,
    (select c.id from checks c where c.watch_id=w.id and c.shot_path is not null order by c.started_at desc limit 1) as last_shot_id,
    (select c.id from checks c where c.watch_id=w.id and c.changed=1 order by c.started_at desc limit 1) as last_change_id,
    (select c.diff_summary from checks c where c.watch_id=w.id and c.changed=1 and c.diff_summary is not null order by c.started_at desc limit 1) as last_summary,
    (select count(*) from checks c where c.watch_id=w.id and c.changed=1) as change_count,
    (select group_concat(t.tick, ',') from (
       select (case when c.status='error' then 'e' when c.changed=1 then 'c' else 'q' end) || c.id as tick
       from checks c where c.watch_id=w.id order by c.started_at desc limit 34
     ) t) as ticks
  from watches w`

export function routes(app: FastifyInstance) {
  app.get('/api/watches', () => {
    const rows = all<Watch & { last_summary: string | null }>(`${LIST_SQL} order by w.id desc`)
    // Send the preview line only, not the whole diff payload, to keep the board light.
    return rows.map(({ last_summary, ...w }) => ({
      ...w,
      running: isRunning(w.id),
      preview: previewOf(last_summary),
    }))
  })

  app.get('/api/watches/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const watch = get<Watch>(`${LIST_SQL} where w.id=?`, id)
    if (!watch) return reply.code(404).send({ error: 'not found' })
    const checks = all<Check>(
      'select id, started_at, duration_ms, status, error, changed, change_pct, shot_path, diff_path, notified from checks where watch_id=? order by started_at desc limit 100',
      id,
    )
    return { ...watch, running: isRunning(id), checks, suggestions: suggestIgnores(id) }
  })

  app.post('/api/watches', async (req, reply) => {
    const body = req.body as Record<string, unknown>
    if (!body?.url || typeof body.url !== 'string') return reply.code(400).send({ error: 'url required' })
    body.url = normalizeUrl(body.url)
    const badSteps = stepsError(body)
    if (badSteps) return reply.code(400).send({ error: badSteps })

    let name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ''
    if (!name) name = await deriveName(body.url)

    const cols: string[] = ['name', 'created_at', 'next_run_at']
    const vals: unknown[] = [name, Date.now(), Date.now()]
    for (const key of WRITABLE) {
      if (key === 'name' || !(key in body)) continue
      cols.push(key)
      vals.push(packed(key, body[key]))
    }

    const res = run(
      `insert into watches (${cols.join(',')}) values (${cols.map(() => '?').join(',')})`,
      ...vals.map((v) => bind(v)),
    )
    return get<Watch>('select * from watches where id=?', Number(res.lastInsertRowid))
  })

  app.patch('/api/watches/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!get('select id from watches where id=?', id)) return reply.code(404).send({ error: 'not found' })
    const body = (req.body ?? {}) as Record<string, unknown>
    const badSteps = stepsError(body)
    if (badSteps) return reply.code(400).send({ error: badSteps })

    const sets: string[] = []
    const vals: unknown[] = []
    for (const key of WRITABLE) {
      if (!(key in body)) continue
      sets.push(`${key}=?`)
      vals.push(packed(key, body[key]))
    }
    if (!sets.length) return get<Watch>('select * from watches where id=?', id)

    // Interval or scope changes should take effect on the next tick, not later.
    if ('interval_sec' in body || 'enabled' in body) {
      sets.push('next_run_at=?')
      vals.push(Date.now())
    }
    run(`update watches set ${sets.join(',')} where id=?`, ...vals.map((v) => bind(v)), id)
    return get<Watch>('select * from watches where id=?', id)
  })

  app.delete('/api/watches/:id', (req) => {
    const id = Number((req.params as { id: string }).id)
    run('delete from checks where watch_id=?', id)
    run('delete from watches where id=?', id)
    removeWatchDir(id)
    return { ok: true }
  })

  app.post('/api/watches/:id/check', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const check = await checkNow(id)
    if (!check) return reply.code(409).send({ error: 'already running or missing' })
    return check
  })

  app.get('/api/checks/:id', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const check = get<Check>('select * from checks where id=?', id)
    if (!check) return reply.code(404).send({ error: 'not found' })
    const prev = get<Check>(
      "select * from checks where watch_id=? and status='ok' and started_at<? order by started_at desc limit 1",
      check.watch_id,
      check.started_at,
    )
    return {
      ...check,
      summary: check.diff_summary ? JSON.parse(check.diff_summary) : null,
      prev_id: prev?.id ?? null,
      has_shot: !!check.shot_path,
      has_prev_shot: !!prev?.shot_path,
      has_diff: !!check.diff_path,
    }
  })

  app.get('/api/checks/:id/text', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const check = get<Check>('select text_path from checks where id=?', id)
    const text = check?.text_path ? readText(check.text_path) : null
    if (text === null) return reply.code(404).send({ error: 'no snapshot' })
    return reply.type('text/plain; charset=utf-8').send(text)
  })

  /** Word-level diff between a check and the one before it, for inline highlighting. */
  app.get('/api/checks/:id/worddiff', (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const check = get<Check>('select * from checks where id=?', id)
    if (!check?.text_path) return reply.code(404).send({ error: 'no snapshot' })
    const prev = get<Check>(
      "select * from checks where watch_id=? and status='ok' and started_at<? and text_path is not null order by started_at desc limit 1",
      check.watch_id,
      check.started_at,
    )
    const before = prev?.text_path ? readText(prev.text_path) : ''
    const after = readText(check.text_path)
    if (after === null) return reply.code(404).send({ error: 'no snapshot' })
    return { parts: wordDiff(before ?? '', after) }
  })

  for (const [route, column] of [
    ['shot.png', 'shot_path'],
    ['diff.png', 'diff_path'],
  ] as const) {
    app.get(`/api/checks/:id/${route}`, (req, reply) => {
      const id = Number((req.params as { id: string }).id)
      const check = get<Record<string, string | null>>(`select ${column} from checks where id=?`, id)
      const rel = check?.[column]
      if (!rel) return reply.code(404).send({ error: 'no image' })
      try {
        // A check id is a SQLite rowid: reused after deletion, and meaningless
        // across instances that shared an origin. Caching these URLs blind
        // serves one watch's screenshot on another watch's page, so the client
        // must revalidate — an ETag keeps that to a 304 in the normal case.
        const st = statSync(abs(rel))
        const tag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`
        reply.header('etag', tag).header('cache-control', 'private, no-cache')
        if (req.headers['if-none-match'] === tag) return reply.code(304).send()
        return reply.type('image/png').send(readFileSync(abs(rel)))
      } catch {
        return reply.code(404).send({ error: 'missing file' })
      }
    })
  }

  /** Preview a URL before saving it as a watch — powers the add page. */
  app.post('/api/preview', async (req, reply) => {
    const { url, selector, render, mode, pre_capture_steps } = (req.body ?? {}) as {
      url?: string
      selector?: string
      render?: boolean
      mode?: string
      pre_capture_steps?: unknown
    }
    if (!url) return reply.code(400).send({ error: 'url required' })
    let steps: PreCaptureStep[]
    try {
      steps = preCaptureSteps(pre_capture_steps)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    try {
      return await makePreview({
        url: normalizeUrl(url),
        render: !!render || mode === 'visual',
        selector,
        wantShot: mode === 'visual',
        preCaptureSteps: steps,
      })
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message })
    }
  })

  app.get('/api/preview/:token/shot.png', (req, reply) => {
    const shot = previewShot((req.params as { token: string }).token)
    if (!shot) return reply.code(404).send({ error: 'preview expired' })
    return reply.type('image/png').header('cache-control', 'no-store').send(shot)
  })

  /**
   * Serves the target page, script-free, with the picker overlay injected.
   * Always renders in a browser regardless of the watch's own setting: the
   * picker needs the post-JS DOM, since that's the page a human would click on.
   */
  app.get('/api/pick', async (req, reply) => {
    const query = req.query as { url?: string; pre_capture_steps?: string }
    const raw = query.url
    if (!raw) return reply.code(400).send({ error: 'url required' })
    const url = normalizeUrl(raw)
    let steps: string | null
    try {
      const parsed = preCaptureSteps(query.pre_capture_steps)
      steps = parsed.length ? JSON.stringify(parsed) : null
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    try {
      let html: string
      let finalUrl = url
      try {
        const { renderPage } = await import('./render.ts')
        const out = await renderPage(
          { url, selector: null, headers: null, wait_ms: 0, pre_capture_steps: steps } as Watch,
          {},
        )
        html = out.html
        finalUrl = out.finalUrl
      } catch (e) {
        if (steps) throw e
        // No browser available — a static fetch still beats failing outright.
        const out = await httpFetch(url)
        html = out.html
        finalUrl = out.finalUrl
      }
      const { buildPickerHtml } = await import('./picker.ts')
      return reply.type('text/html; charset=utf-8').send(buildPickerHtml(html, finalUrl))
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message })
    }
  })

  app.get('/api/settings', () => redactedSettings())

  app.put('/api/settings', (req) => {
    const body = (req.body ?? {}) as Record<string, Record<string, unknown>>
    const current = settings()
    // Masked secrets mean "leave it alone" — never let the UI blank one by echoing dots back.
    if (body.email) body.email.pass = unmask(body.email.pass as string, current.email.pass)
    saveSettings(body as never)
    return redactedSettings()
  })

  app.post('/api/settings/test/:channel', async (req, reply) => {
    const channel = (req.params as { channel: string }).channel as ChannelId
    if (!['email', 'webhook', 'command'].includes(channel))
      return reply.code(400).send({ error: 'unknown channel' })
    try {
      await sendTest(channel)
      return { ok: true }
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message })
    }
  })

  app.get('/api/stats', () => {
    const row = get<{ watches: number; checks: number; changes: number }>(
      'select (select count(*) from watches) as watches, (select count(*) from checks) as checks, (select count(*) from checks where changed=1) as changes',
    )
    return { ...row, baseUrl: config.baseUrl }
  })
}

function previewOf(summary: string | null): string | null {
  if (!summary) return null
  try {
    return (JSON.parse(summary) as { preview?: string }).preview ?? null
  } catch {
    return null
  }
}

async function deriveName(url: string): Promise<string> {
  try {
    const { html } = await httpFetch(url, { timeoutMs: 10_000 })
    const title = pageTitle(html)
    if (title) return title.slice(0, 120)
  } catch {
    // fall through to the URL-derived name
  }
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 120)
  } catch {
    return url.slice(0, 120)
  }
}
