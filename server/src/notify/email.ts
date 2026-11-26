import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import type { Settings } from '../settings.ts'
import type { Message } from './render.ts'

const LOCKUP = join(dirname(fileURLToPath(import.meta.url)), '../../assets/lockup@2x.png')

/** `"Name" <addr>` or a bare address — we only want the address part back. */
const addressOf = (from: string) => {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim() || 'argus@localhost'
}

export async function sendEmail(
  cfg: Settings['email'],
  msg: Message,
  images: string[],
  watchName?: string,
) {
  if (!cfg.host) throw new Error('email: SMTP host is required')
  if (!cfg.to) throw new Error('email: a recipient is required')

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  })

  await transport.sendMail({
    // The sender line names the watch that fired, so a mailbox full of alerts
    // is scannable without opening any of them. Object form so nodemailer does
    // the quoting and RFC 2047 encoding — watch names are free text.
    from: {
      name: watchName ? `argus · ${watchName}`.slice(0, 64) : 'argus',
      address: addressOf(cfg.from),
    },
    to: cfg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.emailHtml,
    // The template references this by cid, so the image travels with the mail
    // instead of pointing at a LAN-only URL the reader can't reach.
    attachments: [
      // Gmail and friends strip inline SVG, so the wordmark travels as a raster.
      { filename: 'argus.png', path: LOCKUP, cid: 'arguslogo' },
      // The template references this by cid, so the image travels with the mail
      // instead of pointing at a LAN-only URL the reader can't reach.
      ...images.map((image, index) => ({
        filename: `change-${index}.png`,
        path: image,
        cid: `argusdiff-${index}`,
      })),
    ],
  })
}
