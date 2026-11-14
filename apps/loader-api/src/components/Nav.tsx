'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Nav(): React.JSX.Element {
  const path = usePathname()

  return (
    <>
      <Link href="/admin/apps" data-active={path === '/admin/apps'}>
        Products
      </Link>
      <Link href="/admin/settings" data-active={path === '/admin/settings'}>
        Settings
      </Link>
    </>
  )
}
