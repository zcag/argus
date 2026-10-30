import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, host, previewShotUrl } from './api'
import type { Preview, WatchMode, PreCaptureStep } from './api'
import { SelectorPicker } from './components/SelectorPicker'
import { ModeGlyph, MODE_LABEL, MODE_BLURB } from './components/ModeGlyph'
import { Mark } from './components/Mark'

const MODES: WatchMode[] = ['text', 'element', 'visual']

const INTERVALS = [
  { label: '5 min', sec: 300 },
  { label: '15 min', sec: 900 },
  { label: '1 hour', sec: 3600 },
  { label: '6 hours', sec: 21600 },
  { label: 'Daily', sec: 86400 },
]

const STREAMS = ['', 'alarms']

export function AddWatch() {
  const navigate = useNavigate()

  const [url, setUrl] = useState('')
  const [mode, setMode] = useState<WatchMode>('text')
  const [selector, setSelector] = useState('')
  const [interval, setInterval] = useState(3600)
  const [render, setRender] = useState(false)
  const [waitMs, setWaitMs] = useState(0)
  const [minChangePct, setMinChangePct] = useState(0)
  const [name, setName] = useState('')
  const [stream, setStream] = useState('')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickingPurpose, setPickingPurpose] = useState<'target' | 'pre-capture'>('target')
  const [preCaptureSteps, setPreCaptureSteps] = useState<PreCaptureStep[]>([])
  const effectiveRender = render || mode === 'visual' || preCaptureSteps.length > 0
  const read = useRef(false)

  const runPreview = useCallback(
    async (over?: { mode?: WatchMode; selector?: string; render?: boolean }) => {
      const target = url.trim()
      if (!target) return
      setLoading(true)
      setError(null)
      try {
        const p = await api.preview({
          url: target,
          mode: over?.mode ?? mode,
          selector: over?.selector ?? selector,
          render: over?.render ?? effectiveRender,
          pre_capture_steps: preCaptureSteps.length ? preCaptureSteps : null,
        })
        setPreview(p)
        read.current = true
        if (!name && p.title) setName(p.title)
      } catch (e) {
        setPreview(null)
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [url, mode, selector, effectiveRender, name, preCaptureSteps],
  )

  // Once the page has been read, changing what's compared re-previews on its own.
  useEffect(() => {
    if (!read.current) return
    const t = setTimeout(() => void runPreview(), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selector, render, preCaptureSteps])

  const create = async () => {
    setSaving(true)
    setError(null)
    try {
      const watch = await api.create({
        url: url.trim(),
        name: name.trim() || undefined,
        mode,
        selector: selector.trim() || null,
        interval_sec: interval,
        render: render || mode === 'visual' ? 1 : 0,
        wait_ms: waitMs,
        min_change_pct: minChangePct,
        notify_stream: stream || null,
        pre_capture_steps: preCaptureSteps.length ? preCaptureSteps : null,
      })
      navigate(`/w/${watch.id}`)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const canSave = !!url.trim() && read.current && (mode !== 'element' || !!selector.trim())
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-ground/90 px-5 py-3 backdrop-blur">
        <Link to="/" className="btn-ghost btn px-2 py-1" aria-label="Back to all watches">
          <Mark compact className="h-4 text-ink" />
        </Link>
        <h1 className="font-mono text-xs tracking-[0.16em] uppercase">Watch a page</h1>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,520px)_1fr]">
        {/* ---- form ---- */}
        <div className="min-h-0 divide-y divide-line overflow-auto border-line lg:border-r">
          <Step n={1} title="The page">
            <div className="flex gap-1.5">
              <input
                className="field font-mono text-[13px]"
                placeholder="https://example.com/pricing"
                value={url}
                autoFocus
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runPreview()}
              />
              <button className="btn shrink-0" onClick={() => runPreview()} disabled={!url.trim() || loading}>
                {loading ? 'Reading…' : read.current ? 'Read again' : 'Read the page'}
              </button>
            </div>
            {preview?.title && (
              <p className="mt-2 flex items-center gap-1.5 text-[13px]" title={preview.title}>
                <span className="text-quiet shrink-0" aria-hidden="true">
                  ✓
                </span>
                <span className="text-ink truncate">{preview.title}</span>
              </p>
            )}
            {error && (
              <p className="mt-2 rounded border border-warn/40 bg-warn/8 px-3 py-2 text-xs text-warn">
                Couldn't read that page — {error}
              </p>
            )}
          </Step>

          <Step n={2} title="What counts as a change" muted={!read.current}>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => {
                    setMode(m)
                    if (m === 'visual') setRender(true)
                  }}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    mode === m
                      ? 'border-change/60 bg-change/8'
                      : 'border-line bg-panel hover:border-edge'
                  }`}
                >
                  <ModeGlyph
                    mode={m}
                    className={`mb-2 h-6 w-6 ${mode === m ? 'text-change-ink' : 'text-faint'}`}
                  />
                  <span className={`block text-sm ${mode === m ? 'text-ink' : 'text-dim'}`}>
                    {MODE_LABEL[m]}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[12px] text-dim">{MODE_BLURB[mode]}</p>

            {(mode === 'element' || mode === 'visual') && (
              <div className="mt-3">
                <label className="mb-1 block text-xs text-dim">
                  {mode === 'element' ? 'Which element' : 'Limit to one element (optional)'}
                </label>
                <div className="flex gap-1.5">
                  <input
                    className="field font-mono text-[13px]"
                    placeholder="#main .price"
                    value={selector}
                    onChange={(e) => setSelector(e.target.value)}
                  />
                  <button
                    className="btn shrink-0"
                    onClick={() => {
                      setPickingPurpose('target')
                      setPicking(true)
                    }}
                    disabled={!url.trim()}
                    title="Open the page and click the element"
                  >
                    Pick it
                  </button>
                </div>
                {selector && preview && !preview.selectorMatched && (
                  <p className="mt-1.5 text-[12px] text-warn">
                    That selector doesn't match anything on the page.
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-xs text-dim">
              <details className="relative">
                <summary
                  className={`btn shrink-0 list-none px-2 py-1 ${
                    !url.trim() ? 'pointer-events-none opacity-50' : ''
                  }`}
                >
                  Add action before capture
                </summary>
                <div className="panel absolute bottom-full left-0 z-10 mb-1 min-w-48 p-1 shadow-lg">
                  <button
                    className="btn-ghost btn w-full justify-start px-2 py-1.5 text-xs"
                    onClick={(e) => {
                      e.currentTarget.closest('details')?.removeAttribute('open')
                      setPickingPurpose('pre-capture')
                      setPicking(true)
                    }}
                    disabled={!url.trim()}
                  >
                    Click an element
                  </button>
                </div>
              </details>
              {preCaptureSteps.length > 0 && (
                <span className="text-faint">
                  {preCaptureSteps.length} action{preCaptureSteps.length === 1 ? '' : 's'} configured
                </span>
              )}
            </div>
            {preCaptureSteps.length > 0 && (
              <ol className="mt-2 space-y-1 text-xs text-dim">
                {preCaptureSteps.map((step, index) => (
                  <li key={`${step.selector}-${index}`} className="flex items-center gap-2">
                    <span className="lbl w-4">{index + 1}</span>
                    <span className="shrink-0 text-dim">Click</span>
                    <input
                      className="field min-w-0 flex-1 font-mono text-[13px]"
                      value={step.selector}
                      aria-label={`Selector for pre-capture action ${index + 1}`}
                      onChange={(e) =>
                        setPreCaptureSteps((steps) =>
                          steps.map((current, i) =>
                            i === index ? { ...current, selector: e.target.value } : current,
                          ),
                        )
                      }
                    />
                    <button
                      className="btn ml-auto shrink-0 px-2 py-0.5"
                      onClick={() => setPreCaptureSteps((steps) => steps.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Step>

          <Step n={3} title="How often" muted={!read.current}>
            <div className="flex flex-wrap gap-1.5">
              {INTERVALS.map((i) => (
                <button
                  key={i.sec}
                  onClick={() => setInterval(i.sec)}
                  className={`chip border px-2 py-1 transition-colors ${
                    interval === i.sec
                      ? 'border-change/60 bg-change/12 text-change-ink'
                      : 'border-line text-dim hover:text-ink'
                  }`}
                >
                  {i.label}
                </button>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <input
                  type="number"
                  min={30}
                  className="field w-24 font-mono text-[13px]"
                  value={interval}
                  onChange={(e) => setInterval(Math.max(30, Number(e.target.value) || 30))}
                />
                <span className="lbl">sec</span>
              </span>
            </div>

            <label className="mt-3 flex items-start gap-2 text-xs text-dim">
              <input
                type="checkbox"
                checked={effectiveRender}
                disabled={mode === 'visual' || preCaptureSteps.length > 0}
                onChange={(e) => setRender(e.target.checked)}
                className="mt-0.5 accent-[var(--color-change)]"
              />
              <span>
                Load it with a browser first
                <span className="block text-[12px] text-dim">
                  {mode === 'visual'
                    ? 'Always on for visual watches.'
                    : 'Needed for pages that build their content in JavaScript.'}
                </span>
              </span>
            </label>
          </Step>

          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-xs text-dim hover:text-ink">
              <span className="lbl">4</span> More options
              <span className="ml-auto text-faint transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="space-y-3 px-5 pb-5">
              <div>
                <label className="mb-1 block text-xs text-dim">Name</label>
                <input
                  className="field"
                  placeholder={preview?.title ?? 'Taken from the page title'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-dim">Ignore changes under</label>
                <span className="inline-flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    className="field w-24 font-mono text-[13px]"
                    value={minChangePct}
                    onChange={(e) => setMinChangePct(Number(e.target.value) || 0)}
                  />
                  <span className="lbl">%</span>
                </span>
                <p className="mt-1 text-[12px] text-faint">
                  Anything smaller is recorded but not announced.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-dim">Settle delay</label>
                <span className="inline-flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    step={250}
                    className="field w-24 font-mono text-[13px]"
                    value={waitMs}
                    onChange={(e) => setWaitMs(Number(e.target.value) || 0)}
                  />
                  <span className="lbl">ms</span>
                </span>
                <p className="mt-1 text-[12px] text-faint">Extra wait after load, for slow widgets.</p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-dim">Stream</label>
                <select className="field" value={stream} onChange={(e) => setStream(e.target.value)}>
                  {STREAMS.map((s) => (
                    <option key={s} value={s}>
                      {s || 'Default'}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[12px] text-faint">
                  Ignore rules and webhooks can be set once the watch exists.
                </p>
              </div>
            </div>
          </details>

          {read.current && (
            <Summary {...{ url, mode, selector, interval, stream, minChangePct, preCaptureSteps }} />
          )}
        </div>

        {/* ---- preview ---- */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <span className="lbl text-dim">This is what argus will compare</span>
            {preview && (
              <span className="ml-auto font-mono text-[12px] text-dim">
                {mode === 'visual' && preview.hasShot
                  ? selector
                    ? 'element screenshot'
                    : 'full-page screenshot'
                  : `${preview.chars.toLocaleString()} characters`}
              </span>
            )}
          </div>

          <div className={`min-h-0 flex-1 overflow-auto ${mode === 'visual' ? 'shot-bg' : ''}`}>
            {loading ? (
              <p className="p-6 text-sm text-dim">Reading the page…</p>
            ) : !preview ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <Mark className="h-9 text-faint/50" />
                <p className="max-w-xs text-sm text-dim">
                  Give argus an address and it will show you exactly what it's going to compare.
                </p>
              </div>
            ) : mode === 'visual' && preview.hasShot ? (
              <div className="p-4">
                <img
                  src={previewShotUrl(preview.token)}
                  alt="Preview capture"
                  className="block w-full rounded border border-line"
                />
              </div>
            ) : preview.sample ? (
              <TextPreview text={preview.sample} />
            ) : (
              <p className="p-6 text-sm text-warn">
                Nothing was extracted. Try a different element, or turn on “Load it with a browser”.
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="border-line bg-ground/90 sticky bottom-0 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-5 py-3 backdrop-blur">
        {!read.current && (
          <p className="text-faint text-xs">Read the page first to see what will be compared.</p>
        )}
        {mode === 'element' && read.current && !selector.trim() && (
          <p className="text-warn text-xs">Pick an element to watch.</p>
        )}
        <div className="ml-auto flex gap-2">
          <Link to="/" className="btn whitespace-nowrap">
            Cancel
          </Link>
          <button
            className="btn btn-primary whitespace-nowrap"
            onClick={create}
            disabled={!canSave || saving}
          >
            {saving ? 'Saving…' : 'Start watching'}
          </button>
        </div>
      </footer>

      {picking && (
        <SelectorPicker
          url={url.trim()}
          render={effectiveRender}
          current={pickingPurpose === 'target' ? selector || null : null}
          purpose={pickingPurpose}
          preCaptureSteps={preCaptureSteps.length ? JSON.stringify(preCaptureSteps) : null}
          onClose={() => setPicking(false)}
          onPick={(sel) => {
            if (pickingPurpose === 'pre-capture') {
              setPreCaptureSteps((steps) => [...steps, { type: 'click', selector: sel }])
              setPicking(false)
            } else {
              setPicking(false)
              setSelector(sel)
              if (mode === 'text') setMode('element')
            }
          }}
        />
      )}
    </div>
  )
}

function Step({
  n,
  title,
  children,
  muted,
}: {
  n: number
  title: string
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <section className={`px-5 py-4 transition-opacity ${muted ? 'opacity-60' : ''}`}>
      <h2 className="mb-3 flex items-center gap-2.5">
        <span className="border-edge/70 text-dim flex h-5 w-5 items-center justify-center rounded border font-mono text-[11px]">
          {n}
        </span>
        <span className="text-ink text-sm">{title}</span>
      </h2>
      {children}
    </section>
  )
}

/** `1h` is fine on a dense card but reads wrong inside a sentence. */
function spokenInterval(sec: number): string {
  const named: Record<number, string> = {
    300: 'five minutes',
    900: 'fifteen minutes',
    3600: 'hour',
    21600: 'six hours',
    86400: 'day',
  }
  if (named[sec]) return named[sec]
  if (sec % 3600 === 0) return `${sec / 3600} hours`
  if (sec % 60 === 0) return `${sec / 60} minutes`
  return `${sec} seconds`
}

/** Reads back the whole configuration as one sentence, so it can be checked at a glance. */
function Summary({
  url,
  mode,
  selector,
  interval,
  stream,
  minChangePct,
  preCaptureSteps,
}: {
  url: string
  mode: WatchMode
  selector: string
  interval: number
  stream: string
  minChangePct: number
  preCaptureSteps: PreCaptureStep[]
}) {
  const what =
    mode === 'visual'
      ? selector.trim()
        ? 'a screenshot of one element on'
        : 'a full-page screenshot of'
      : mode === 'element'
        ? 'the text of one element on'
        : 'the readable text of'

  return (
    <div className="px-5 py-4">
      <div className="panel bg-panel/60 space-y-2 p-3.5">
        <p className="lbl">What happens</p>
        <p className="text-dim text-[13px] leading-relaxed">
          Every <span className="text-ink">{spokenInterval(interval)}</span>, argus compares {what}{' '}
          <span className="text-ink font-mono text-[12px]">{host(url) || 'the page'}</span>. When it
          changes you get a notification
          {stream && <span className="text-ink"> on {stream}</span>}.
        </p>
        {preCaptureSteps.length > 0 && (
          <p className="text-faint text-[12px]">
            Before comparing, argus runs the {preCaptureSteps.length === 1 ? 'click' : `${preCaptureSteps.length} clicks`} you set up.
          </p>
        )}
        {minChangePct > 0 && (
          <p className="text-faint text-[12px]">
            Changes smaller than {minChangePct}% are recorded but not announced.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The extracted text IS the content of this pane, so it gets primary ink and a
 * line gutter — a numbered document reads as something to inspect, where an
 * undifferentiated wall of grey monospace reads as a dump.
 */
function TextPreview({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="py-2 font-mono text-[13px] leading-[1.75]">
      {lines.map((line, i) => (
        <div key={i} className="hover:bg-panel/70 flex gap-3 px-4">
          <span className="text-faint/55 w-8 shrink-0 text-right tabular-nums select-none">
            {i + 1}
          </span>
          <span className="text-ink break-words whitespace-pre-wrap">{line}</span>
        </div>
      ))}
    </div>
  )
}
