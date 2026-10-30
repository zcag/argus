import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from './config.ts'

export type WatchMode = 'text' | 'element' | 'visual'

export type PreCaptureStep = {
  type: 'click'
  selector: string
}

export type Watch = {
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
  notify_channels: string | null
  headers: string | null
  wait_ms: number
  next_run_at: number | null
  last_check_at: number | null
  last_change_at: number | null
  last_status: string | null
  last_error: string | null
  consecutive_failures: number
  created_at: number
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
  text_hash: string | null
  text_path: string | null
  shot_path: string | null
  diff_path: string | null
  diff_summary: string | null
  notified: number
}

const migrations = [
  `
  create table watches (
    id integer primary key,
    name text not null,
    url text not null,
    mode text not null default 'text',
    selector text,
    render integer not null default 0,
    interval_sec integer not null default 3600,
    enabled integer not null default 1,
    ignore_selectors text,
    ignore_regex text,
    min_change_pct real not null default 0,
    notify_stream text,
    notify_webhook text,
    headers text,
    wait_ms integer not null default 0,
    next_run_at integer,
    last_check_at integer,
    last_change_at integer,
    last_status text,
    last_error text,
    consecutive_failures integer not null default 0,
    created_at integer not null
  );
  create table checks (
    id integer primary key,
    watch_id integer not null references watches(id) on delete cascade,
    started_at integer not null,
    duration_ms integer,
    status text not null,
    error text,
    changed integer not null default 0,
    change_pct real,
    text_hash text,
    text_path text,
    shot_path text,
    diff_path text,
    diff_summary text,
    notified integer not null default 0
  );
  create index checks_watch_idx on checks(watch_id, started_at desc);
  create index watches_due_idx on watches(enabled, next_run_at);
  `,
  `
  create table settings (key text primary key, value text not null);
  alter table watches add column notify_channels text;
  `,
  `alter table watches add column pre_capture_steps text;`,
]

mkdirSync(dirname(config.dbPath), { recursive: true })
mkdirSync(config.snapDir, { recursive: true })

export const db = new DatabaseSync(config.dbPath)
db.exec('pragma journal_mode = wal')
db.exec('pragma foreign_keys = on')
db.exec('pragma busy_timeout = 5000')

const version = (db.prepare('pragma user_version').get() as { user_version: number }).user_version
for (let i = version; i < migrations.length; i++) {
  db.exec(migrations[i])
  db.exec(`pragma user_version = ${i + 1}`)
}

type Param = string | number | null | bigint | Uint8Array

export const all = <T>(sql: string, ...args: Param[]) => db.prepare(sql).all(...args) as T[]
export const get = <T>(sql: string, ...args: Param[]) => db.prepare(sql).get(...args) as T | undefined
export const run = (sql: string, ...args: Param[]) => db.prepare(sql).run(...args)

/** SQLite rejects booleans and undefined; normalise before binding. */
export const bind = (v: unknown): Param => {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v
  return JSON.stringify(v)
}

export const jsonArray = (s: string | null): string[] => {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const preCaptureSteps = (v: unknown): PreCaptureStep[] => {
  if (v === null || v === undefined || v === '') return []
  const steps = typeof v === 'string' ? JSON.parse(v) : v
  if (!Array.isArray(steps)) throw new Error('pre_capture_steps must be an array')
  return steps.map((s) => {
    if (s?.type !== 'click') throw new Error(`unsupported pre-capture step: ${s?.type}`)
    if (typeof s.selector !== 'string' || !s.selector.trim()) throw new Error('a click step needs a selector')
    return { type: 'click', selector: s.selector.trim() }
  })
}
