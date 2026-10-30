<div align="center">

<img src="docs/hero.png" alt="argus — know the moment a page changes" width="720">

**Self-hosted page watching.** Compare a page's text, one element, or its pixels —
and get told *what* changed, not just *that* something did.

[![licence](https://img.shields.io/badge/licence-MIT-ff2060?style=flat-square)](LICENSE)
![self-hosted](https://img.shields.io/badge/self--hosted-single%20container-8da0ad?style=flat-square)
![storage](https://img.shields.io/badge/storage-SQLite-8da0ad?style=flat-square)
[![ci](https://github.com/zcag/argus/actions/workflows/ci.yml/badge.svg)](https://github.com/zcag/argus/actions/workflows/ci.yml)

</div>

---

<img src="docs/board.png" alt="The argus board: a card per watch with its latest capture and check history">

Point argus at a URL. It checks on a schedule, works out what changed, and tells you
through email, a webhook, or a local command. Everything runs on your own
machine — no account, no third-party service, no page contents leaving your network.

## Why argus and not changedetection.io

[changedetection.io](https://github.com/dgtlmoon/changedetection.io) is the established
self-hosted option and argus borrows its shape. These are the gaps it was built to close:

**It tells you what changed, not that something changed.** Lines that differ only in
their digits are paired up and reported with their label — *"2 numbers changed —
Standard plan: 199 → 149"*. That's the case people actually watch pages for: a price,
a stock count, a version, a date.

**Noise control that drives itself.** argus reads its own history. A line that changes
on most checks is a clock or a view counter, not news — so it offers you a ready-made
ignore rule instead of leaving you to reverse-engineer the noise yourself.

**Visual diff is first-class.** Changed regions are clustered and boxed, with swipe and
side-by-side compare, and a jump list of the regions that moved.

**A real element picker.** The target page is proxied script-free and you click the thing
you care about. No hand-writing CSS selectors against someone else's markup.

## Three ways to compare

| Mode | Compares | Good for |
|---|---|---|
| **Text** | the readable text of the whole page | articles, docs, changelogs |
| **Element** | the text inside one CSS selector | a price, a status, a listing table |
| **Visual** | screenshots, pixel by pixel | layout, images, anything visual |

Mode only decides which extractor and which differ run — the scheduler, history and
notifications are shared. `text` and `element` use a plain HTTP fetch unless you turn on
**Load with a browser**, which pages that build their content in JavaScript need.

### Text and element

<img src="docs/diff-text.png" alt="A word-level diff showing a price drop from $199 to $149">

### Visual

<img src="docs/diff-visual.png" alt="A pixel diff with four changed regions boxed in magenta">

Changed pixels are clustered into regions and boxed, so a 0.04% diff is still findable
on a full-page screenshot. The numbered chips jump to each region.

## Adding a watch

<img src="docs/add-watch.png" alt="The add page, showing a live preview of exactly what will be compared">

The right pane shows **exactly what argus will compare** and re-renders whenever you
change the comparison, so you find out before saving — not after the first false alarm.

### Picking an element

<img src="docs/picker.png" alt="The element picker: hovering the page highlights an element and shows its selector">

argus serves the page with its scripts stripped and an overlay injected, so it can't
navigate away while you're choosing. Click the element, get a selector.

It deliberately **refuses unstable ids** — numeric, long digit runs, hex hashes,
framework-generated (`ember-`, `react-`, `:r`). Those look unique and are worthless: a
Hacker News story row carries a numeric `id` that changes on the next render, so a
selector anchored to one silently breaks on the very next check.

### Preparing a page before capture

A watch can click things before argus extracts text or takes a screenshot, which is
how you get past a cookie or consent popup that covers the watched content. Add the
clicks from the add page or the watch's settings and pick each element on the page;
they run in order, each on the page as the previous one left it.

Watches with clicks always load in a browser, including text and element watches, so
they cost more than a plain HTTP fetch. A click that finds nothing to click (the popup
didn't show this time) is skipped with a warning instead of failing the check.

A click does whatever the page does with it: a link navigates and the capture is of
wherever it lands, and with a `Cookie` header it clicks as you on every check, so pick
dismiss buttons, not actions. Controls inside iframes, typing, and login flows aren't
supported yet.

## Notifications

<img src="docs/notification-email.png" alt="An argus notification email showing a what-moved table and the diff" width="620">

Every enabled channel gets the same description; a watch can narrow itself to a subset.

| Channel | What it sends |
|---|---|
| **Email** | Formatted HTML — headline, a *what moved* table, the diff, and the changed-regions image embedded by `cid` so it renders without reaching back into your network. |
| **Webhook** | A JSON POST with the full structured change. |
| **Local command** | Runs a notification CLI already on the host, as `<bin> <args> [--stream <stream>] [--file <screenshot.png>] <message>`. Visual watches attach the annotated screenshot. Off by default. |

Configure them in the UI at `/settings`, or entirely by environment variable so a
container needs no clicking:

<img src="docs/notifications.png" alt="The notification settings page with four channels" width="720">

## Quick start

```sh
curl -O https://raw.githubusercontent.com/zcag/argus/master/compose.yml
docker compose up -d
```

Then open **http://localhost:8797**.

That's the whole install — one file, one command, a prebuilt image from
`ghcr.io/zcag/argus`. Or without compose:

```sh
docker run -d --name argus -p 8797:8797 -v argus:/data --shm-size=1g \
  -e ARGUS_BASE_URL=http://localhost:8797 ghcr.io/zcag/argus:latest
```

`--shm-size` is not optional: Chromium crashes the tab taking full-page
screenshots on Docker's 64MB default. Watches, history and snapshots live in a Docker volume; add
notification settings in the UI when you want them, or drop a `.env` beside
`compose.yml` (see [`.env.example`](.env.example)).

<details>
<summary><b>Running from source instead</b></summary>

Needs **Node 26+** and a system Chrome or Chromium. There is no server build step —
Node runs the TypeScript directly.

```sh
pnpm install
pnpm build          # builds the web UI
pnpm start          # serves API + UI on :8797
```

For development, `pnpm dev` (backend, watch mode) alongside `pnpm dev:web` (Vite).

A systemd user unit is included at [`deploy/argus.service`](deploy/argus.service);
`make deploy` installs and restarts it.

To build the container yourself rather than pulling it:

```sh
docker build -t ghcr.io/zcag/argus:latest .
docker compose up -d
```
</details>

## Configuration

Everything is environment-driven. Nothing is required — argus runs with none of it set.

| Variable | Default | What it does |
|---|---|---|
| `ARGUS_PORT` | `8797` | Listen port |
| `ARGUS_BASE_URL` | `http://localhost:8797` | How you reach argus. Notification links are built from it, so localhost is wrong the moment you open argus from another machine. |
| `ARGUS_DATA` | `~/.local/share/argus` | Database and snapshots (`/data` in Docker) |
| `ARGUS_CHROME` | `/usr/bin/google-chrome-stable` | System browser to drive |
| `ARGUS_CDP` | — | Attach to an already-running Chrome instead of launching one. The hook for watching pages behind a login. |
| `ARGUS_CONCURRENCY` | `3` | Checks running at once |
| `ARGUS_HOST_GAP_MS` | `5000` | Minimum gap between two checks hitting the same host |
| `ARGUS_RETAIN_UNCHANGED` | `5` | Unchanged checks kept per watch |
| `ARGUS_RETAIN_CHANGED` | `100` | Changed checks that keep their artifacts |
| `ARGUS_WATCH_BYTE_CAP` | `200MB` | Per-watch snapshot allowance |

Notification variables (`ARGUS_SMTP_HOST`, `ARGUS_EMAIL_TO`, `ARGUS_WEBHOOK_URL`,
`ARGUS_COMMAND_BIN` and friends) are listed in [`.env.example`](.env.example). Anything set there simply pre-fills the settings page.

## How it works

```
scheduler ──► capture ──► extract ──► diff ──► notify
   │            │            │          │         │
 next_run_at   HTTP or     HTML to    text or   email · webhook
 + per-host    Chromium    text, or   pixels    command
 rate limit                a screenshot
```

Some deliberate choices, all of which reduce moving parts:

- **No server build step** — Node 26 runs the `.ts` sources directly via native type stripping.
- **No native modules** — storage is Node's built-in `node:sqlite`, not better-sqlite3.
- **No bundled browser** — `playwright-core` drives a Chromium that's already installed.
- **No job queue** — an in-process tick over `next_run_at` with per-host rate limiting.

### Retention

Snapshots are the only thing here that grows without bound, so it's enforced rather than
advisory:

- Unchanged checks are deleted wholesale beyond the newest few.
- Changed checks **keep their row forever** but shed their artifacts past the limit, so
  *when* something changed survives even after the pixels don't.
- A per-watch byte cap drops the oldest artifacts first.
- The newest successful check is never pruned — it is the baseline the next diff compares
  against.

## Not built yet

Semantic/LLM change summaries, multi-user and sharing, browser steps for multi-step
logins (typing, beyond the clicks above), RSS/JSON watch types, and region-level
ignore masks for visual mode.

## Licence

MIT — see [LICENSE](LICENSE).
