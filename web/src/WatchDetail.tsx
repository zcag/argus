import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, clock, humanInterval, parsePreCaptureSteps, pct, until } from './api'
import type { CheckDetail, WatchDetail as WatchDetailData } from './api'
import { VigilStrip, tickOf } from './components/VigilStrip'
import { VisualCompare } from './components/VisualCompare'
import { TextDiff } from './components/TextDiff'
import { Controls } from './components/Controls'
import { SelectorPicker } from './components/SelectorPicker'
import { ModeGlyph } from './components/ModeGlyph'
import { Mark } from './components/Mark'

export function WatchDetail() {
  const { id } = useParams()
  const watchId = Number(id)
  const navigate = useNavigate()

  const [data, setData] = useState<WatchDetailData | null>(null)
  const [checkId, setCheckId] = useState<number | null>(null)
  const [check, setCheck] = useState<CheckDetail | null>(null)
  const [rail, setRail] = useState<'history' | 'settings'>('history')
  const [view, setView] = useState<'visual' | 'text'>('visual')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState<'target' | 'pre-capture' | null>(null)

  const load = useCallback(
    async (select?: number) => {
      const d = await api.watch(watchId)
      setData(d)
      setCheckId((cur) => select ?? cur ?? d.checks.find((c) => c.changed)?.id ?? d.checks[0]?.id ?? null)
    },
    [watchId],
  )

  useEffect(() => {
    load().catch(() => navigate('/'))
  }, [load, navigate])

  useEffect(() => {
    if (checkId === null) return setCheck(null)
    api.check(checkId).then(setCheck).catch(() => setCheck(null))
  }, [checkId])

  useEffect(() => {
    if (!check) return
    setView(check.summary?.kind === 'visual' || check.has_shot ? 'visual' : 'text')
  }, [check?.id])

  const patch = async (body: Record<string, unknown>) => {
    await api.update(watchId, body)
    load()
  }

  const runNow = async () => {
    setBusy(true)
    try {
      const c = await api.runCheck(watchId)
      await load(c.id)
      setCheckId(c.id)
    } catch {
      await load()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? '')) return
      if (e.key === 'r') void runNow()
      if (e.key === 'Escape') navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!data) return <p className="py-24 text-center text-sm text-dim">Loading…</p>

  const summary = check?.summary ?? null
  const hasVisual = !!check?.has_shot
  const hasText = !!summary?.parts?.length

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ground/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
          <Link to="/" className="btn-ghost btn px-2 py-1" aria-label="Back to all watches">
            <Mark compact className="h-4 text-ink" />
          </Link>
          <div className="min-w-0 max-w-[46ch]">
            <h1 className="flex items-center gap-2 text-base leading-tight">
              <ModeGlyph mode={data.mode} className="text-faint h-4 w-4 shrink-0" />
              <span className="truncate">{data.name}</span>
            </h1>
            <a
              href={data.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate font-mono text-[12px] text-faint hover:text-change-ink"
            >
              {data.url}
            </a>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={`chip border ${
                data.enabled ? 'border-line text-faint' : 'border-warn/40 bg-warn/10 text-warn'
              }`}
            >
              {data.enabled
                ? `next ${until(data.next_run_at)} · every ${humanInterval(data.interval_sec)}`
                : 'paused'}
            </span>
            <span className="bg-line h-5 w-px" aria-hidden="true" />
            <button className="btn" onClick={runNow} disabled={busy}>
              {busy ? 'Checking…' : 'Check now'}
            </button>
            <button className="btn" onClick={() => patch({ enabled: data.enabled ? 0 : 1 })}>
              {data.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              className="btn-ghost btn hover:text-change-ink"
              onClick={async () => {
                if (!confirm(`Stop watching "${data.name}" and delete its history?`)) return
                await api.remove(watchId)
                navigate('/')
              }}
            >
              Delete
            </button>
          </div>
        </div>

        {data.last_status === 'error' && (
          <p className="border-t border-warn/30 bg-warn/8 px-5 py-1.5 font-mono text-[12px] text-warn">
            Last check failed — {data.last_error}
            {data.consecutive_failures > 1 && ` (${data.consecutive_failures} in a row; retrying less often)`}
          </p>
        )}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
        <section className="flex min-h-0 flex-col border-line lg:border-r">
          {check ? (
            <>
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2">
                <span className="font-mono text-[12px] text-dim">
                  {new Date(check.started_at).toLocaleString()}
                </span>
                {check.changed ? (
                  <span className="chip border border-change/50 bg-change/12 text-change-ink">
                    changed {pct(check.change_pct)}
                  </span>
                ) : check.status === 'error' ? (
                  <span className="chip border border-warn/50 bg-warn/12 text-warn">failed</span>
                ) : (
                  <span className="chip border border-line text-dim">no change</span>
                )}
                {summary?.added != null && (
                  <span className="font-mono text-[12px] text-faint">
                    +{summary.added} / −{summary.removed} lines
                  </span>
                )}
                {check.duration_ms != null && (
                  <span className="font-mono text-[12px] text-faint">{check.duration_ms}ms</span>
                )}

                {hasVisual && hasText && (
                  <div className="ml-auto flex rounded-md border border-line bg-ground p-0.5">
                    {(['visual', 'text'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setView(v)}
                        className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
                          view === v ? 'bg-raised text-ink' : 'text-dim hover:text-ink'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {check.status === 'error' ? (
                <p className="p-6 font-mono text-sm text-warn">{check.error}</p>
              ) : view === 'visual' && hasVisual ? (
                <VisualCompare
                  checkId={check.id}
                  prevId={check.has_prev_shot ? check.prev_id : null}
                  hasDiff={check.has_diff}
                  boxes={summary?.boxes ?? []}
                  sourceWidth={summary?.width ?? 0}
                />
              ) : hasText ? (
                <div className="min-h-0 flex-1 overflow-auto">
                  <TextDiff parts={summary!.parts!} />
                </div>
              ) : (
                <p className="p-6 text-sm text-dim">
                  Nothing changed in this check — this is the baseline argus compares against.
                </p>
              )}
            </>
          ) : (
            <p className="p-6 text-sm text-dim">
              No checks yet. Run one to record the baseline.
            </p>
          )}
        </section>

        <aside className="flex min-h-0 flex-col">
          <div className="flex gap-1 border-b border-line px-3 py-2">
            {(['history', 'settings'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setRail(t)}
                className={`rounded px-2.5 py-1 font-mono text-[12px] tracking-wide capitalize transition-colors ${
                  rail === t ? 'bg-raised text-ink' : 'text-faint hover:text-dim'
                }`}
              >
                {t}
                {t === 'settings' && data.suggestions.length > 0 && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warn align-middle" />
                )}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {rail === 'history' ? (
              <div>
                <div className="border-b border-line p-4">
                  <p className="lbl mb-2">
                    {data.change_count} {data.change_count === 1 ? 'change' : 'changes'} ·{' '}
                    {data.checks.length} checks kept
                  </p>
                  <VigilStrip
                    ticks={data.checks.map(tickOf).sort((a, b) => a.id - b.id)}
                    onPick={setCheckId}
                    activeId={checkId}
                  />
                </div>
                <ul className="divide-y divide-line-soft">
                  {data.checks.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setCheckId(c.id)}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-panel ${
                          checkId === c.id ? 'bg-panel' : ''
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            c.status === 'error' ? 'bg-warn' : c.changed ? 'bg-change' : 'bg-faint/50'
                          }`}
                        />
                        <span
                          className="flex-1 font-mono text-[12px] text-dim"
                          title={new Date(c.started_at).toLocaleString()}
                        >
                          {clock(c.started_at)}
                        </span>
                        {c.changed ? (
                          <span className="font-mono text-[12px] text-change-ink">
                            {pct(c.change_pct)}
                          </span>
                        ) : c.status === 'error' ? (
                          <span className="font-mono text-[12px] text-warn">failed</span>
                        ) : (
                          <span className="font-mono text-[12px] text-faint">—</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Controls
                watch={data}
                suggestions={data.suggestions}
                onChange={patch}
                onPickSelector={() => setPicking('target')}
                onAddAction={() => setPicking('pre-capture')}
              />
            )}
          </div>
        </aside>
      </div>

      {picking && (
        <SelectorPicker
          url={data.url}
          render={!!data.render || !!data.pre_capture_steps}
          current={picking === 'target' ? data.selector : null}
          purpose={picking}
          preCaptureSteps={data.pre_capture_steps}
          onClose={() => setPicking(null)}
          onPick={async (sel) => {
            setPicking(null)
            if (picking === 'target') {
              await patch({ selector: sel })
            } else {
              const steps = parsePreCaptureSteps(data.pre_capture_steps)
              await patch({ pre_capture_steps: [...steps, { type: 'click', selector: sel }] })
            }
          }}
        />
      )}
    </div>
  )
}
