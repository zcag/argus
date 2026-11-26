export const VisualMode = {
  OVERLAY: 'overlay',
  SWIPE: 'swipe',
  SIDE: 'side',
  AFTER: 'after',
} as const

export type VisualMode =
  (typeof VisualMode)[keyof typeof VisualMode]

export const VISUAL_MODES = [
  { id: VisualMode.OVERLAY, label: 'Overlay', needsPrev: false },
  { id: VisualMode.SWIPE, label: 'Swipe', needsPrev: true },
  { id: VisualMode.SIDE, label: 'Side by side', needsPrev: true },
  { id: VisualMode.AFTER, label: 'Latest only', needsPrev: false },
] as const