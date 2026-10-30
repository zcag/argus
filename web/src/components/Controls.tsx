import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, humanInterval, parseList, parsePreCaptureSteps } from '../api'
import type { ChannelId, Suggestion, Watch, WatchMode } from '../api'
import { ModeGlyph, MODE_LABEL, MODE_BLURB } from './ModeGlyph'

const MODES: WatchMode[] = ['text', 'element', 'visual']

const INTERVALS = [
  { label: '5m', sec: 300 },
  { label: '15m', sec: 900 },
  { label: '1h', sec: 3600 },
  { label: '6h', sec: 21600 },
  { label: '1d', sec: 86400 },
]

const STREAMS = ['', 'alarms']

export function Controls({
  watch,
  suggestions,
  onChange,
  onPickSelector,
  onAddAction,
}: {
  watch: Watch
  suggestions: Suggestion[]
  onChange: (patch: Record<string, unknown>) => void
  onPickSelector: () => void
  onAddAction: () => void
}) {
  const ignoreSelectors = parseList(watch.ignore_selectors)
  const ignoreRegex = parseList(watch.ignore_regex)
  const actions = parsePreCaptureSteps(watch.pre_capture_steps)

  const [enabled, setEnabled] = useState<ChannelId[]>([])
  useEffect(() => {
    api
      .settings()
      .then((s) =>
        setEnabled(
          (['email', 'webhook', 'command'] as ChannelId[]).filter((c) => s[c].enabled),
        ),
      )
      .catch(() => {})
  }, [])

  // No explicit selection means every enabled channel, which is what a new watch wants.
  const stored = parseList(watch.notify_channels)
  const picked = stored.length ? (stored as ChannelId[]) : enabled

  return (
    <div className="divide-y divide-line">
      <Section title="Target">
        <Row label="Name">
          <Text value={watch.name} onCommit={(v) => onChange({ name: v })} />
        </Row>
        <Row label="URL">
          <Text value={watch.url} mono onCommit={(v) => onChange({ url: v })} />
        </Row>
        <Row label="What to compare">
          <div className="flex rounded-md border border-line bg-ground p-0.5">
            {MODES.map((m) => (
              <button
                key={m}
                aria-pressed={watch.mode === m}
                onClick={() => onChange({ mode: m, ...(m === 'visual' ? { render: 1 } : {}) })}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors ${
                  watch.mode === m ? 'bg-raised text-ink' : 'text-dim hover:text-ink'
                }`}
              >
                <ModeGlyph mode={m} className="h-3.5 w-3.5 opacity-80" />
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-dim">{MODE_BLURB[watch.mode]}</p>
        </Row>
        <Row
          label="Element selector"
          hint={watch.mode === 'element' ? 'Required for element mode.' : 'Optional — narrows the comparison.'}
        >
          <div className="flex gap-1.5">
            <Text
              value={watch.selector ?? ''}
              mono
              placeholder="#main .price"
              onCommit={(v) => onChange({ selector: v || null })}
            />
            <button className="btn shrink-0" onClick={onPickSelector} title="Pick an element on the page">
              Pick
            </button>
          </div>
        </Row>
      </Section>

      <Section title="Actions before capture">
        <p className="mb-3 text-[12px] text-dim">
          These actions run in order before each check. Actions require browser-backed capture.
        </p>
        {actions.length > 0 && (
          <ol className="mb-3 space-y-2">
            {actions.map((action, index) => (
              <li key={`${action.selector}-${index}`} className="flex items-center gap-2">
                <span className="lbl w-4 shrink-0">{index + 1}</span>
                <span className="shrink-0 text-[12px] text-dim">Click</span>
                <Text
                  value={action.selector}
                  mono
                  onCommit={(selector) => {
                    const next = selector.trim()
                      ? actions.map((current, i) => (i === index ? { ...current, selector } : current))
                      : actions.filter((_, i) => i !== index)
                    onChange({ pre_capture_steps: next })
                  }}
                />
                <button
                  className="btn shrink-0 px-2 py-1 text-xs"
                  onClick={() =>
                    onChange({
                      pre_capture_steps: actions.filter((_, actionIndex) => actionIndex !== index),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
        <button className="btn" onClick={onAddAction}>
          Add click action
        </button>
      </Section>

      <Section title="Schedule">
        <Row label="Check every">
          <div className="flex flex-wrap items-center gap-1.5">
            {INTERVALS.map((i) => (
              <button
                key={i.sec}
                onClick={() => onChange({ interval_sec: i.sec })}
                className={`chip border transition-colors ${
                  watch.interval_sec === i.sec
                    ? 'border-change/60 bg-change/12 text-change-ink'
                    : 'border-line text-dim hover:text-ink'
                }`}
              >
                {i.label}
              </button>
            ))}
            <Number
              value={watch.interval_sec}
              min={30}
              suffix="sec"
              onCommit={(v) => onChange({ interval_sec: Math.max(30, v) })}
            />
          </div>
          <p className="mt-1.5 text-[12px] text-dim">Currently every {humanInterval(watch.interval_sec)}.</p>
        </Row>
        <Row label="Load with a browser" hint="Needed for pages that build their content in JavaScript.">
          <Toggle
            on={!!watch.render || watch.mode === 'visual' || actions.length > 0}
            disabled={watch.mode === 'visual' || actions.length > 0}
            onToggle={(v) => onChange({ render: v ? 1 : 0 })}
            label={
              watch.mode === 'visual'
                ? 'Always on for visual watches'
                : actions.length > 0
                  ? 'Always on for watches with actions'
                  : watch.render
                    ? 'On'
                    : 'Off'
            }
          />
        </Row>
        <Row label="Settle delay" hint="Extra wait after load, for slow widgets.">
          <Number value={watch.wait_ms} min={0} step={250} suffix="ms" onCommit={(v) => onChange({ wait_ms: v })} />
        </Row>
      </Section>

      <Section title="What counts as a change">
        <Row label="Ignore changes under" hint="Anything smaller is recorded but not announced.">
          <Number
            value={watch.min_change_pct}
            min={0}
            max={100}
            step={0.1}
            suffix="%"
            onCommit={(v) => onChange({ min_change_pct: v })}
          />
        </Row>

        {suggestions.length > 0 && (
          <div className="rounded-md border border-warn/40 bg-warn/8 p-2.5">
            <p className="lbl mb-2 text-warn">Noticed repeating noise</p>
            <div className="space-y-2">
              {suggestions.map((s) => (
                <div key={s.pattern} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px] text-ink" title={s.sample}>
                      {s.sample}
                    </p>
                    <p className="text-[12px] text-dim">
                      changed in {s.hits} of the last {s.total} checks
                    </p>
                  </div>
                  <button
                    className="btn shrink-0 py-1 text-xs"
                    onClick={() => onChange({ ignore_regex: [...ignoreRegex, s.pattern] })}
                  >
                    Ignore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Row label="Ignore lines matching" hint="Regular expressions, one per line.">
          <ListEditor
            items={ignoreRegex}
            placeholder="^Updated \d+:\d+$"
            onChange={(v) => onChange({ ignore_regex: v })}
          />
        </Row>
        <Row label="Ignore elements" hint="CSS selectors removed before comparing.">
          <ListEditor
            items={ignoreSelectors}
            placeholder=".ads, #carousel"
            onChange={(v) => onChange({ ignore_selectors: v })}
          />
        </Row>
      </Section>

      <Section title="When it changes">
        <Row
          label="Send through"
          hint={
            enabled.length
              ? 'Unticking everything here silences this watch without pausing it.'
              : undefined
          }
        >
          {enabled.length === 0 ? (
            <p className="text-[12px] text-warn">
              No channels are switched on.{' '}
              <Link to="/settings" className="underline">
                Set one up
              </Link>{' '}
              and changes will be delivered.
            </p>
          ) : (
            <div className="space-y-1.5">
              {enabled.map((c) => (
                <label key={c} className="flex items-center gap-2 text-[13px] text-dim">
                  <input
                    type="checkbox"
                    className="accent-[var(--color-change)]"
                    checked={picked.includes(c)}
                    onChange={(e) =>
                      onChange({
                        notify_channels: e.target.checked
                          ? [...picked, c]
                          : picked.filter((x) => x !== c),
                      })
                    }
                  />
                  <span className="capitalize">{c === 'command' ? 'Local command' : c}</span>
                </label>
              ))}
            </div>
          )}
        </Row>

        <Row label="Stream" hint="Only used by the local-command channel.">
          <select
            className="field"
            value={watch.notify_stream ?? ''}
            onChange={(e) => onChange({ notify_stream: e.target.value || null })}
          >
            {STREAMS.map((s) => (
              <option key={s} value={s}>
                {s || 'Default'}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Webhook" hint="Optional POST with the change details.">
          <Text
            value={watch.notify_webhook ?? ''}
            mono
            placeholder="https://…"
            onCommit={(v) => onChange({ notify_webhook: v || null })}
          />
        </Row>
        <Row label="Request headers" hint="JSON — for cookies or tokens.">
          <Text
            value={watch.headers ?? ''}
            mono
            placeholder='{"cookie":"session=…"}'
            onCommit={(v) => onChange({ headers: v || null })}
          />
        </Row>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 p-4">
      <h3 className="lbl">{title}</h3>
      {children}
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-dim">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-faint">{hint}</p>}
    </div>
  )
}

/** Commits on blur or Enter so every keystroke isn't a write. */
function Text({
  value,
  onCommit,
  mono,
  placeholder,
}: {
  value: string
  onCommit: (v: string) => void
  mono?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) setDraft(value)
  }, [value])

  const commit = () => {
    dirty.current = false
    if (draft !== value) onCommit(draft)
  }

  return (
    <input
      className={`field ${mono ? 'font-mono text-[13px]' : ''}`}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        dirty.current = true
        setDraft(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          dirty.current = false
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}

function Number({
  value,
  onCommit,
  min,
  max,
  step,
  suffix,
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="number"
        className="field w-24 font-mono text-[13px]"
        defaultValue={value}
        key={value}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v) && v !== value) onCommit(v)
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {suffix && <span className="lbl">{suffix}</span>}
    </div>
  )
}

function Toggle({
  on,
  onToggle,
  label,
  disabled,
}: {
  on: boolean
  onToggle: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className="flex items-center gap-2 text-sm disabled:opacity-60"
    >
      <span
        className={`relative h-5 w-9 rounded-full border transition-colors ${
          on ? 'border-quiet/60 bg-quiet/25' : 'border-line bg-ground'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
            on ? 'left-[18px] bg-quiet' : 'left-0.5 bg-faint'
          }`}
        />
      </span>
      <span className={on ? 'text-ink' : 'text-dim'}>{label}</span>
    </button>
  )
}

function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (v: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (!v || items.includes(v)) return
    onChange([...items, v])
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={`${item}-${i}`} className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded border border-line bg-ground px-2 py-1 font-mono text-[12px] text-ink">
            {item}
          </code>
          <button
            className="btn-ghost btn px-1.5 py-1 text-xs hover:text-change-ink"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label={`Remove ${item}`}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input
          className="field font-mono text-[12px]"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn shrink-0" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  )
}
