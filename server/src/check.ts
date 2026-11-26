import { readFileSync } from 'node:fs'
import { get, run, jsonArray } from './db.ts'
import type { Check, Watch } from './db.ts'
import { capture } from './capture.ts'
import { extractText } from './extract.ts'
import { textDiff } from './diff.ts'
import { visualDiff } from './visual.ts'
import { save, readText, abs, hash } from './storage.ts'
import { notifyChange } from './notify/index.ts'
import { pruneWatch } from './retention.ts'
import { isShuttingDown } from './lifecycle.ts'

const MAX_BACKOFF = 8
/** Guard against a pathological diff bloating the row. */
const MAX_PARTS = 400

export async function runCheck(watch: Watch): Promise<Check | undefined> {
  const started = Date.now()
  const checkId = Number(
    run('insert into checks (watch_id, started_at, status) values (?,?,?)', watch.id, started, 'running')
      .lastInsertRowid,
  )

  try {
    const cap = await capture(watch)
    const isVisual = watch.mode === 'visual'
    const prev = get<Check>(
      "select * from checks where watch_id=? and status='ok' and id<>? order by started_at desc limit 1",
      watch.id,
      checkId,
    )

    // Text is the primary signal for text/element mode and useful context in visual mode.
    let text: string | null = null
    try {
      text = extractText(cap.html, {
        selector: watch.selector,
        ignoreSelectors: jsonArray(watch.ignore_selectors),
        ignoreRegex: jsonArray(watch.ignore_regex),
      })
    } catch (e) {
      if (!isVisual) throw e
    }

    const textPath = text === null ? null : save(watch.id, checkId, 'txt', text)
    const textHash = text === null ? null : hash(text)
    const shotPath = cap.screenshot ? save(watch.id, checkId, 'png', cap.screenshot) : null
    const prevShotPath = prev?.shot_path ?? null

    let changePct = 0
    let added = 0
    let removed = 0
    let preview = ''
    let diffPath: string | null = null
    let summary: Record<string, unknown> = {}
    let changed = false

    const prevText = prev?.text_path ? readText(prev.text_path) : null
    if (text !== null && prevText !== null && prevText !== text) {
      const td = textDiff(prevText, text)
      changePct = td.changePct
      added = td.added
      removed = td.removed
      preview = td.preview
      summary = { kind: 'text', added, removed, changePct, preview, parts: td.parts.slice(0, MAX_PARTS) }
      changed = !isVisual && changePct >= watch.min_change_pct
    }

    let visual: { changedPct: number } | null = null
    if (isVisual && cap.screenshot && prevShotPath) {
      const before = safeRead(prevShotPath)
      if (before) {
        const vd = visualDiff(before, cap.screenshot)
        visual = { changedPct: vd.changedPct }
        // Only keep an overlay when there is something to look at — otherwise every
        // quiet check would leave a full-page PNG behind.
        if (vd.changedPixels > 0) diffPath = save(watch.id, checkId, 'diff.png', vd.overlay)
        summary = {
          ...summary,
          kind: 'visual',
          changedPct: vd.changedPct,
          changedPixels: vd.changedPixels,
          width: vd.width,
          height: vd.height,
          boxes: vd.boxes,
        }
        changePct = vd.changedPct
        changed = vd.changedPct >= Math.max(watch.min_change_pct, 0.01)
      }
    }

    run(
      `update checks set duration_ms=?, status='ok', changed=?, change_pct=?, text_hash=?,
       text_path=?, shot_path=?, diff_path=?, diff_summary=? where id=?`,
      Date.now() - started,
      changed ? 1 : 0,
      changePct,
      textHash,
      textPath,
      shotPath,
      diffPath,
      Object.keys(summary).length ? JSON.stringify(summary) : null,
      checkId,
    )

    run(
      `update watches set last_check_at=?, last_status='ok', last_error=null, consecutive_failures=0,
       next_run_at=?, last_change_at=case when ? then ? else last_change_at end where id=?`,
      Date.now(),
      Date.now() + watch.interval_sec * 1000,
      changed ? 1 : 0,
      Date.now(),
      watch.id,
    )

    if (changed) {
      await notifyChange({ watch, checkId, summary, changePct, diffPath, shotPath, prevShotPath })
      run('update checks set notified=1 where id=?', checkId)
    }

    pruneWatch(watch.id)
    return get<Check>('select * from checks where id=?', checkId)
  } catch (e) {
    // Our own shutdown tore the browser out from under this check — drop the row
    // and leave the watch's failure count and schedule alone.
    if (isShuttingDown()) {
      run('delete from checks where id=?', checkId)
      return undefined
    }
    const message = (e as Error).message.slice(0, 500)
    const failures = watch.consecutive_failures + 1
    const backoff = watch.interval_sec * 1000 * Math.min(2 ** failures, MAX_BACKOFF)
    run(
      "update checks set duration_ms=?, status='error', error=? where id=?",
      Date.now() - started,
      message,
      checkId,
    )
    run(
      `update watches set last_check_at=?, last_status='error', last_error=?,
       consecutive_failures=?, next_run_at=? where id=?`,
      Date.now(),
      message,
      failures,
      Date.now() + backoff,
      watch.id,
    )
    console.error(`[check] watch ${watch.id} (${watch.name}) failed:`, message)
    return get<Check>('select * from checks where id=?', checkId)
  }
}

function safeRead(rel: string): Buffer | null {
  try {
    return readFileSync(abs(rel))
  } catch {
    return null
  }
}
