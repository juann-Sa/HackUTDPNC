'use client'

import Link from 'next/link'

export type AppSection = 'past' | 'home' | 'coach' | 'health' | 'future' | 'cars'

const TABS: { id: AppSection; href: string; label: string }[] = [
  { id: 'past', href: '/past', label: 'Past' },
  { id: 'home', href: '/home', label: 'Home' },
  { id: 'future', href: '/future', label: 'Future' },
  { id: 'cars', href: '/car-loans', label: 'Car loans' },
]

interface MainNavProps {
  current: AppSection
  variant: 'dash' | 'life'
}

export default function MainNav({ current, variant }: MainNavProps) {
  if (variant === 'dash') {
    return (
      <nav aria-label="Main navigation">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className={current === tab.id ? 'nav-active' : undefined}
            aria-current={current === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    )
  }

  return (
    <nav
      aria-label="Main navigation"
      className="absolute left-1/2 flex -translate-x-1/2 items-center gap-6 sm:gap-8"
    >
      {TABS.map((tab) => {
        const active = current === tab.id
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`relative py-2 text-sm transition ${
              active
                ? 'font-semibold text-slate-900 after:absolute after:inset-x-0 after:-bottom-[18px] after:h-[3px] after:rounded-full after:bg-brand'
                : 'font-medium text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
