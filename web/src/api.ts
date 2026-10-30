export type WatchMode = 'text' | 'element' | 'visual'

export type PreCaptureStep = {
  type: 'click'
  selector: string
}

export function parsePreCaptureSteps(raw: string | null | undefined): PreCaptureStep[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter(
      (step): step is PreCaptureStep =>
        !!step &&
        typeof step === 'object' &&
        (step as { type?: unknown }).type === 'click' &&
        typeof (step as { selector?: unknown }).selector === 'string',
    )
  } catch {
    return []
  }
}

export type Watch = {
  notify_channels: string | null
  id: number
  name: string
  url: string
  mode: WatchMode
  selector: string | null
  render: number
  interval_sec: number
  enabled: number
  ignore_selectors: string | null
  ignore_regex: string | null
  min_change_pct: number
  notify_stream: string | null
  notify_webhook: string | null
  headers: string | null
  wait_ms: number
  next_run_at: number | null
  last_check_at: number | null
  last_change_at: number | null
  last_status: string | null
  last_error: string | null
  consecutive_failures: number
  created_at: number
  last_check_id: number | null
  last_shot_id: number | null
  last_change_id: number | null
  change_count: number
  ticks: string | null
  preview?: string | null
  running?: boolean
  pre_capture_steps: string | null
}

export type Check = {
  id: number
  watch_id: number
  started_at: number
  duration_ms: number | null
  status: string
  error: string | null
  changed: number
  change_pct: number | null
  shot_path?: string | null
  diff_path?: string | null
  notified: number
}

export type DiffPart =
  | { t: 'ctx' | 'add' | 'del'; lines: string[] }
  | { t: 'gap'; n: number }

export type Box = { x: number; y: number; w: number; h: number }

export type Summary = {
  kind?: 'text' | 'visual'
  added?: number
  removed?: number
  changePct?: number
  preview?: string
  parts?: DiffPart[]
  changedPct?: number
  changedPixels?: number
  width?: number
  height?: number
  boxes?: Box[]
}

export type CheckDetail = Check & {
  summary: Summary | null
  prev_id: number | null
  has_shot: boolean
  has_prev_shot: boolean
  has_diff: boolean
}

export type Suggestion = { pattern: string; hits: number; total: number; sample: string }

export type WatchDetail = Watch & {
  checks: Check[]
  suggestions: Suggestion[]
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(detail.error ?? `request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const api = {
  watches: () => req<Watch[]>('/api/watches'),
  watch: (id: number) => req<WatchDetail>(`/api/watches/${id}`),
  create: (body: Record<string, unknown>) =>
    req<Watch>('/api/watches', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: Record<string, unknown>) =>
    req<Watch>(`/api/watches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: number) => req<{ ok: true }>(`/api/watches/${id}`, { method: 'DELETE' }),
  runCheck: (id: number) => req<Check>(`/api/watches/${id}/check`, { method: 'POST' }),
  check: (id: number) => req<CheckDetail>(`/api/checks/${id}`),
  preview: (body: {
    url: string
    selector?: string
    render?: boolean
    mode?: WatchMode
    pre_capture_steps?: PreCaptureStep[] | null
  }) =>
    req<Preview>('/api/preview', { method: 'POST', body: JSON.stringify(body) }),
  settings: () => req<AllSettings>('/api/settings'),
  saveSettings: (body: AllSettings) =>
    req<AllSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  testChannel: (channel: ChannelId) =>
    req<{ ok: true }>(`/api/settings/test/${channel}`, { method: 'POST' }),
}

export type Preview = {
  token: string
  title: string | null
  finalUrl: string
  chars: number
  sample: string
  hasShot: boolean
  selectorMatched: boolean
}

export const previewShotUrl = (token: string) => `/api/preview/${token}/shot.png`

export type ChannelId = 'email' | 'webhook' | 'command'

export type AllSettings = {
  email: {
    enabled: boolean
    host: string
    port: number
    secure: boolean
    user: string
    pass: string
    from: string
    to: string
  }
  webhook: { enabled: boolean; url: string }
  command: { enabled: boolean; bin: string; args: string }
}

export const shotUrl = (checkId: number) => `/api/checks/${checkId}/shot.png`
export const diffUrl = (checkId: number) => `/api/checks/${checkId}/diff.png`

export const parseList = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function ago(ts: number | null): string {
  if (!ts) return 'never'
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Wall-clock label — relative time is useless when checks cluster together. */
export function clock(ts: number): string {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function until(ts: number | null): string {
  if (!ts) return '—'
  const s = Math.round((ts - Date.now()) / 1000)
  if (s <= 0) return 'due'
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/**
 * A pixel diff can be a real change and still round to 0.0% — showing
 * "changed 0.0%" reads as a contradiction, so small values get a floor label.
 */
export function pct(v: number | null | undefined): string {
  const n = v ?? 0
  if (n > 0 && n < 0.05) return '<0.05%'
  if (n > 0 && n < 0.1) return n.toFixed(2) + '%'
  return n.toFixed(1) + '%'
}

export function humanInterval(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400}d`
  if (sec % 3600 === 0) return `${sec / 3600}h`
  if (sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}

export const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
