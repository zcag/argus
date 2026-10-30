import { useEffect, useState } from 'react'

type Message = { source: 'argus-picker'; type: 'hover' | 'pick'; selector: string; text: string }

export function SelectorPicker({
  url,
  render,
  current,
  purpose,
  preCaptureSteps,
  onPick,
  onClose,
}: {
  url: string
  render: boolean
  current: string | null
  purpose: 'target' | 'pre-capture'
  preCaptureSteps: string | null
  onPick: (selector: string) => void
  onClose: () => void
}) {
  const [hover, setHover] = useState<Message | null>(null)
  const [picked, setPicked] = useState<Message | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const onMessage = (e: MessageEvent<Message>) => {
      if (e.data?.source !== 'argus-picker') return
      if (e.data.type === 'hover') setHover(e.data)
      if (e.data.type === 'pick') setPicked(e.data)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('message', onMessage)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const shown = picked ?? hover

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ground/95 backdrop-blur-sm">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-xs tracking-[0.16em] uppercase">
          {purpose === 'pre-capture' ? 'Pick a button to click first' : 'Pick an element to watch'}
        </h2>
        <p className="text-xs text-dim">
          {picked
            ? 'Click another element to change your choice.'
            : purpose === 'pre-capture'
              ? 'Choose the element argus should click before capture.'
              : 'Move over the page and click the part you want to watch.'}
        </p>
        <button className="btn-ghost btn ml-auto px-2 py-1 text-xs" onClick={onClose}>
          Esc
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-white">
        {loading && (
          <p className="absolute inset-0 flex items-center justify-center bg-ground text-sm text-dim">
            Loading the page…
          </p>
        )}
        <iframe
          title="Element picker"
          src={`/api/pick?url=${encodeURIComponent(url)}${render ? '&render=1' : ''}${
            preCaptureSteps ? `&pre_capture_steps=${encodeURIComponent(preCaptureSteps)}` : ''
          }`}
          className="h-full w-full border-0"
          sandbox="allow-same-origin allow-scripts"
          onLoad={() => setLoading(false)}
        />
      </div>

      <footer className="border-t border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="lbl mb-1">{picked ? 'Selected' : 'Under the cursor'}</p>
            <code className="block truncate font-mono text-[13px] text-ink">
              {shown?.selector ?? current ?? '—'}
            </code>
            {shown?.text && <p className="mt-1 truncate text-[12px] text-dim">“{shown.text}”</p>}
          </div>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!picked}
            onClick={() => picked && onPick(picked.selector)}
          >
            {purpose === 'pre-capture' ? 'Click this first' : 'Use this element'}
          </button>
        </div>
      </footer>
    </div>
  )
}
