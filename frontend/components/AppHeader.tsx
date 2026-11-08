'use client'

import SiteHeader from '@/components/SiteHeader'
import type { AppSection } from '@/components/MainNav'

export default function AppHeader({ current }: { current: AppSection }) {
  return <SiteHeader current={current} />
}
