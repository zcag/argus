import { VisualMode } from '../../../shared/visual.ts'
import type { Watch } from '../db.ts'
import type { ChangeFacts } from './describe.ts'

export type Message = {
  subject: string
  emailHtml: string
  text: string
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const MODE_WORD = { text: 'text', element: 'element', visual: 'appearance' } as const

export function buildMessage(
  watch: Watch,
  facts: ChangeFacts,
  link: string,
  when: Date,
): Message {
  const subject = `${watch.name} — ${facts.headline}`
  const host = safeHost(watch.url)

  const text = [
    `${watch.name} changed`,
    facts.headline,
    ...facts.details,
    '',
    ...facts.excerpt.map((e) => `${e.t === 'add' ? '+' : '-'} ${clip(e.line, 160)}`),
    '',
    watch.url,
    link,
  ]
    .filter((l) => l !== undefined)
    .join('\n')

  return { subject, text, emailHtml: email(watch, facts, link, host, when) }
}

function email(
  watch: Watch,
  facts: ChangeFacts,
  link: string,
  host: string,
  when: Date,
): string {
  const accent = '#c8134b'
  const addBg = '#e8f7f1'
  const delBg = '#fdecf1'

  const numberRows = facts.numbers
    .slice(0, 6)
    .map(
      (n) => `
      <tr>
        <td style="padding:7px 12px;border-bottom:1px solid #eceff1;color:#5b6b76;font-size:13px;">
          ${esc(clip(n.context || 'value', 48))}
        </td>
        <td style="padding:7px 12px;border-bottom:1px solid #eceff1;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;font-size:13px;color:#8a94a0;text-decoration:line-through;">
          ${esc(n.before)}
        </td>
        <td style="padding:7px 12px;border-bottom:1px solid #eceff1;font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;font-size:13px;color:${accent};font-weight:600;">
          ${esc(n.after)}
        </td>
      </tr>`,
    )
    .join('')

  // Emitted without internal whitespace: the cell is pre-wrap, so any newline or
  // indentation in this template would render as a blank line in the mail.
  const excerptRows = facts.excerpt
    .map(
      (e) =>
        `<tr><td style="padding:5px 12px;background:${e.t === 'add' ? addBg : delBg};border-left:3px solid ${e.t === 'add' ? '#1f9d76' : accent};font-family:ui-monospace,'SFMono-Regular',Menlo,monospace;font-size:12.5px;line-height:1.55;color:#26323b;white-space:pre-wrap;word-break:break-word;"><span style="color:#8a94a0;">${e.t === 'add' ? '+' : '−'}</span> ${esc(clip(e.line, 300))}</td></tr>`,
    )
    .join('')

  let imageHeader = ''
  let visualImages = `<img src="cid:argusdiff-0" alt="${imageHeader}" style="display:block;width:100%;border:1px solid #e3e8ea;border-radius:6px;" />`
  const visualMode = watch.visual_mode ?? VisualMode.OVERLAY
  switch (visualMode) {
    case VisualMode.SIDE:
      imageHeader = 'Before/After.'
      visualImages = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="width:50%;padding-right:4px;"><img src="cid:argusdiff-0" alt="Before" style="display:block;width:100%;border:1px solid #e3e8ea;border-radius:6px;" /></td><td style="width:50%;padding-left:4px;"><img src="cid:argusdiff-1" alt="After" style="display:block;width:100%;border:1px solid #e3e8ea;border-radius:6px;" /></td></tr></table>'
      break
    case VisualMode.AFTER:
      imageHeader = 'Latest capture.'
      break
    case VisualMode.SWIPE:
      // swipe unsupported in notifications, fallback to overlay
    case VisualMode.OVERLAY:
      imageHeader = 'Changed regions highlighted.'
      break
    default:
      throw new Error(`Unhandled case: ${visualMode satisfies never}`)
  }

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f7;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e3e8ea;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

        <tr><td style="padding:16px 22px;background:#0b1215;">
          <img src="cid:arguslogo" alt="argus" width="162" height="31" style="display:block;border:0;" />
        </td></tr>

        <tr><td style="padding:24px 22px 6px;">
          <div style="font-size:12px;color:#8a94a0;text-transform:uppercase;letter-spacing:.1em;">${esc(
            MODE_WORD[watch.mode] ?? 'page',
          )} changed</div>
          <h1 style="margin:8px 0 4px;font-size:21px;line-height:1.3;color:#141e24;font-weight:600;">${esc(
            watch.name,
          )}</h1>
          <a href="${esc(watch.url)}" style="font-size:13px;color:#5b6b76;text-decoration:none;">${esc(host)}</a>
        </td></tr>

        <tr><td style="padding:14px 22px 0;">
          <div style="padding:14px 16px;background:#fbfcfc;border:1px solid #e3e8ea;border-left:3px solid ${accent};border-radius:6px;">
            <div style="font-size:16px;color:#141e24;font-weight:600;">${esc(facts.headline)}</div>
            ${
              facts.details.length
                ? `<div style="margin-top:6px;font-size:13px;color:#5b6b76;">${esc(
                    facts.details.join(' · '),
                  )}</div>`
                : ''
            }
          </div>
        </td></tr>

        ${
          numberRows
            ? `<tr><td style="padding:18px 22px 0;">
                 <div style="font-size:12px;color:#8a94a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">What moved</div>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eceff1;border-radius:6px;">${numberRows}</table>
               </td></tr>`
            : ''
        }

        ${
          excerptRows
            ? `<tr><td style="padding:18px 22px 0;">
                 <div style="font-size:12px;color:#8a94a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">The change</div>
                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${excerptRows}</table>
               </td></tr>`
            : ''
        }

        ${
          facts.kind === 'visual'
            ? `<tr><td style="padding:18px 22px 0;">
                 <div style="font-size:12px;color:#8a94a0;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">${imageHeader}</div>
                 ${visualImages}
               </td></tr>`
            : ''
        }

        <tr><td style="padding:22px;">
          <a href="${esc(link)}" style="display:inline-block;background:${accent};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:11px 18px;border-radius:7px;">Open in argus</a>
        </td></tr>

        <tr><td style="padding:14px 22px 20px;border-top:1px solid #eceff1;color:#8a94a0;font-size:12px;">
          Checked ${esc(when.toLocaleString())} · every ${esc(humanInterval(watch.interval_sec))}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function humanInterval(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400}d`
  if (sec % 3600 === 0) return `${sec / 3600}h`
  if (sec % 60 === 0) return `${sec / 60}m`
  return `${sec}s`
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
