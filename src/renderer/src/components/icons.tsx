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

export function EyeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M2.6 12S6.2 5.8 12 5.8 21.4 12 21.4 12 17.8 18.2 12 18.2 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </svg>
  )
}

export function EyeOffIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 4.5 20 19.5" />
      <path d="M9.9 6.2A9.6 9.6 0 0 1 12 5.8c5.8 0 9.4 6.2 9.4 6.2a17 17 0 0 1-3.2 4" />
      <path d="M6.4 8.1A16.6 16.6 0 0 0 2.6 12S6.2 18.2 12 18.2a9.4 9.4 0 0 0 3.6-.7" />
      <path d="M10.1 10.3a2.9 2.9 0 0 0 4 4" />
    </svg>
  )
}

export function AlertCircleIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.8v5" />
      <path d="M12 16.2h.01" />
    </svg>
  )
}

export function CheckIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} strokeWidth={2}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}

export function InfoIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.2" />
      <path d="M12 7.8h.01" />
    </svg>
  )
}

export function CornerDownLeftIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <polyline points="9 10 4 15 9 20" />
      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    </svg>
  )
}

export function SearchIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m16.2 16.2 4.3 4.3" />
    </svg>
  )
}

export function BellIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M18 8.6a6 6 0 1 0-12 0c0 5.2-2 6.4-2 6.4h16s-2-1.2-2-6.4Z" />
      <path d="M10.4 19a2 2 0 0 0 3.2 0" />
    </svg>
  )
}

export function UserIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="8.4" r="3.4" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  )
}

export function PlusIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  )
}

export function XIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

export function FolderIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M3 8.2a2 2 0 0 1 2-2h3.6l1.8 2H19a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

export function SquareIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
    </svg>
  )
}

export function ImageIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.5 17 4.6-4.2 3.4 3 2.6-2.3 4.4 3.9" />
    </svg>
  )
}

export function WindowIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.2h17" />
      <path d="M7 6.9h.01M9.6 6.9h.01" />
    </svg>
  )
}

export function MinusIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} strokeWidth={1.8}>
      <path d="M5 12h14" />
    </svg>
  )
}

export function MaximizeIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} strokeWidth={1.8}>
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  )
}

export function RestoreIcon({ size = 12, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base} strokeWidth={1.8}>
      <rect x="4.5" y="7.5" width="12" height="12" rx="1.5" />
      <path d="M8.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 19.5 6v8A1.5 1.5 0 0 1 18 15.5h-1.5" />
    </svg>
  )
}

export function DashboardIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  )
}

export function HomeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6.5 9.5V19a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  )
}

export function UsersIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.6 19.4c.6-3 3-4.9 5.9-4.9s5.3 1.9 5.9 4.9" />
      <path d="M16.4 5.7a3 3 0 0 1 0 5.7" />
      <path d="M18 14.9c1.6.6 2.7 2.1 3 4.1" />
    </svg>
  )
}

export function UserPlusIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="10" cy="8.5" r="3.2" />
      <path d="M4.1 19.4c.6-3 3-4.9 5.9-4.9 1.2 0 2.3.3 3.2.9" />
      <path d="M17.5 14v6M14.5 17h6" />
    </svg>
  )
}

export function PresentationIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3.2" y="4.4" width="17.6" height="11.2" rx="1.8" />
      <path d="M12 15.6v3.2M8.4 20h7.2" />
      <path d="M7 12.4V9.6M11 12.4V7.6M15 12.4v-1.6" />
    </svg>
  )
}

export function MailIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.4" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  )
}

export function RefreshIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V10h-5.4" />
    </svg>
  )
}

export function CloudOffIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7.4 18.4h9.2a3.6 3.6 0 0 0 .6-7.1 5.4 5.4 0 0 0-9.4-2.4" />
      <path d="M5.2 8.6A5.6 5.6 0 0 0 6 18.3" />
      <path d="m3.6 3.6 16.8 16.8" />
    </svg>
  )
}

export function CloudIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M7.4 18.4h9.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.2-1.4 4.3 4.3 0 0 0 .6 8.6Z" />
    </svg>
  )
}

export function TemplatesIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m12 3.4 8.2 4.3-8.2 4.3-8.2-4.3Z" />
      <path d="m4.4 12 7.6 4 7.6-4" />
      <path d="m4.4 16.4 7.6 4 7.6-4" />
    </svg>
  )
}

export function CodeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m9 8-4 4 4 4" />
      <path d="m15 8 4 4-4 4" />
    </svg>
  )
}

export function SettingsIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v2.1M12 18.7v2.1M20.8 12h-2.1M5.3 12H3.2M18.2 5.8l-1.5 1.5M7.3 16.7l-1.5 1.5M18.2 18.2l-1.5-1.5M7.3 7.3 5.8 5.8" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

export function SignOutIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <polyline points="10 8 6 12 10 16" />
      <line x1="6" y1="12" x2="16" y2="12" />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m14 6-6 6 6 6" />
    </svg>
  )
}

export function SaveIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5 4.5h10.2L19.5 8.8V19.5H5Z" />
      <path d="M8.2 4.5v4.6h6.8V4.5" />
      <path d="M8.2 13.4h7.6v6.1H8.2Z" />
    </svg>
  )
}

export function PlayIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M8.6 5.4 18 12l-9.4 6.6Z" />
    </svg>
  )
}

export function PublishIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 15.2V4.6" />
      <path d="m8 8.6 4-4 4 4" />
      <path d="M5 15.2v4.2h14v-4.2" />
    </svg>
  )
}

export function FileIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6.5 3.6h7l4.5 4.5v12.3H6.5Z" />
      <path d="M13.2 3.6v4.7h4.6" />
    </svg>
  )
}

export function SparkIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="m12 3.6 1.8 4.9 4.9 1.8-4.9 1.8L12 17l-1.8-4.9-4.9-1.8 4.9-1.8Z" />
      <path d="M18.4 16.2 19.2 18l1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8Z" />
    </svg>
  )
}

export function ChatIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4.2 7.2A2.2 2.2 0 0 1 6.4 5h11.2a2.2 2.2 0 0 1 2.2 2.2v7a2.2 2.2 0 0 1-2.2 2.2h-5.7L7.6 20v-3.6H6.4a2.2 2.2 0 0 1-2.2-2.2Z" />
    </svg>
  )
}

export function SunIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4" />
    </svg>
  )
}

export function MoonIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M20.2 14.4A8.4 8.4 0 0 1 9.6 3.8a8.5 8.5 0 1 0 10.6 10.6Z" />
    </svg>
  )
}

export function VideoIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="2.8" y="6.2" width="13.4" height="11.6" rx="2.4" />
      <path d="m16.2 11 4-2.4v6.8l-4-2.4Z" />
    </svg>
  )
}

export function PaletteIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.4-.7-.4-1.1 0-1 .8-1.8 1.9-1.8h1.3a4.4 4.4 0 0 0 4.4-4.4c0-3.8-3.9-6.8-8.6-6.8Z" />
      <circle cx="8.4" cy="9.6" r="1.1" />
      <circle cx="12" cy="7.8" r="1.1" />
      <circle cx="15.6" cy="9.6" r="1.1" />
      <circle cx="7.6" cy="13.6" r="1.1" />
    </svg>
  )
}

export function UploadIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M12 16V4.6" />
      <path d="m7.8 8.8 4.2-4.2 4.2 4.2" />
      <path d="M4.6 15.4v2.6a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-2.6" />
    </svg>
  )
}

export function TrashIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M4.6 7.2h14.8" />
      <path d="M9.4 7.2V5.6a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.6" />
      <path d="M6.6 7.2 7.4 19a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l.8-11.8" />
      <path d="M10.4 10.8v6M13.6 10.8v6" />
    </svg>
  )
}

/** Tokens: a stack of cards, the same shape whatever the tier. */
export function WalletIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3" y="6.4" width="18" height="12.2" rx="2.4" />
      <path d="M3 10.4h18" />
      <path d="M7 15.2h4" />
    </svg>
  )
}
