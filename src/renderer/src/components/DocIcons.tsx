interface IconProps {
  size?: number
  className?: string
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

export function BoldIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7 4.6h6.3a3.7 3.7 0 0 1 0 7.4H7z" />
      <path d="M7 12h6.9a3.8 3.8 0 0 1 0 7.6H7z" />
    </svg>
  )
}

export function ItalicIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M15.5 4.8h-4M12.5 19.2h-4M14.4 4.8 9.6 19.2" />
    </svg>
  )
}

export function UnderlineIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7.2 4.8v6a4.8 4.8 0 0 0 9.6 0v-6" />
      <path d="M6 19.4h12" />
    </svg>
  )
}

export function StrikeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M16.4 7.4A4.2 4.2 0 0 0 12.5 5c-2.3 0-4 1.3-4 3.1 0 1.3.8 2.1 2.4 2.7" />
      <path d="M4.4 12.2h15.2" />
      <path d="M7.8 16.2A4.4 4.4 0 0 0 12 19c2.4 0 4.2-1.3 4.2-3.3" />
    </svg>
  )
}

export function ListBulletIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9.4 6.6h10.4M9.4 12h10.4M9.4 17.4h10.4" />
      <circle cx="4.8" cy="6.6" r="1.1" />
      <circle cx="4.8" cy="12" r="1.1" />
      <circle cx="4.8" cy="17.4" r="1.1" />
    </svg>
  )
}

export function ListNumberedIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9.6 6.6h10.2M9.6 12h10.2M9.6 17.4h10.2" />
      <path d="M4.1 5.6 5.3 4.9v4" strokeWidth={1.3} />
      <path d="M3.8 10.9a1.5 1.5 0 0 1 2.8.6c0 .9-.7 1.5-1.5 2.2l-1.2.9h3" strokeWidth={1.3} />
      <path d="M3.9 16.2a1.5 1.5 0 0 1 2.7.8 1.3 1.3 0 0 1-1.3 1.3 1.3 1.3 0 0 1 1.4 1.3 1.5 1.5 0 0 1-2.7.8" strokeWidth={1.3} />
    </svg>
  )
}

export function QuoteIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9.6 6.6C7 7.4 5.4 9.5 5.4 12v5.4h5V12H7.7c0-1.9.7-3.2 1.9-3.9z" />
      <path d="M18.6 6.6c-2.6.8-4.2 2.9-4.2 5.4v5.4h5V12h-2.7c0-1.9.7-3.2 1.9-3.9z" />
    </svg>
  )
}

export function CodeInlineIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m9 7.8-4.2 4.2L9 16.2M15 7.8l4.2 4.2L15 16.2" />
    </svg>
  )
}

export function LinkIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M10.4 13.6a3.6 3.6 0 0 0 5.1 0l2.3-2.3a3.6 3.6 0 0 0-5.1-5.1L11.5 7.4" />
      <path d="M13.6 10.4a3.6 3.6 0 0 0-5.1 0l-2.3 2.3a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2" />
    </svg>
  )
}

export function TableIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.8" y="5" width="16.4" height="14" rx="1.6" />
      <path d="M3.8 9.6h16.4M3.8 14.4h16.4M10.2 9.6V19" />
    </svg>
  )
}

export function MediaIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.6" y="5" width="16.8" height="14" rx="1.8" />
      <circle cx="8.6" cy="9.8" r="1.3" />
      <path d="m4.6 17.4 4-3.9 3.2 3.1 2.6-2.5 5 4.9" />
    </svg>
  )
}

export function DividerIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 12h16" />
      <path d="M7.4 7.6h9.2M7.4 16.4h9.2" opacity=".45" />
    </svg>
  )
}

export function UndoIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M9.2 7.2 4.8 11.5l4.4 4.3" />
      <path d="M4.8 11.5h8.4a5.6 5.6 0 0 1 0 11.2h-1.7" />
    </svg>
  )
}

export function RedoIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m14.8 7.2 4.4 4.3-4.4 4.3" />
      <path d="M19.2 11.5h-8.4a5.6 5.6 0 0 0 0 11.2h1.7" />
    </svg>
  )
}

export function HistoryIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6v4.9l3.2 1.9" />
    </svg>
  )
}

export function PresentationIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.6" y="4.6" width="16.8" height="11.6" rx="1.6" />
      <path d="M12 16.2v3.4M8.6 19.6h6.8" />
    </svg>
  )
}
