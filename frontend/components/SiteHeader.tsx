'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, UserRound } from 'lucide-react'
import { useRouter } from 'next/navigation'
import MainNav, { type AppSection } from '@/components/MainNav'
import { useLiveData } from '@/components/live-data-provider'
import { endSession, getSession } from '@/lib/demo-session'
import '@/app/home/dashboard.css'

export default function SiteHeader({ current }: { current: AppSection }) {
  const { customerId, setCustomerId, customers } = useLiveData()
  const [profile, setProfile] = useState(false)
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null)
  const router = useRouter()
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setUser(getSession())
  }, [])

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setProfile(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfile(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  const signOut = () => {
    endSession()
    router.push('/signin')
  }

  return (
    <div className="pnc-dash relative z-30">
      <header className="topbar">
        <div className="nav-inner">
          <a className="brand" href="/home" aria-label="PNC home">
            PNC
            <span className="brand-divider" />
            <span className="brand-product">360° Navigator</span>
          </a>
          <MainNav current={current} variant="dash" />
          <div className="account-wrap" ref={accountRef}>
            <button
              className="account-button"
              aria-label="Open account menu"
              aria-expanded={profile}
              onClick={() => setProfile(!profile)}
            >
              <span className="avatar">
                <UserRound size={17} />
              </span>
              <span>{customerId}</span>
              <ChevronDown size={14} />
            </button>
            {profile && (
              <div className="dropdown account-menu">
                <strong>{user ? user.name || user.email : `Customer ${customerId}`}</strong>
                <p>{user ? `${user.email} · viewing ${customerId}` : 'PNC 360° Financial Health Navigator'}</p>
                <label className="customer-picker">
                  Switch customer{' '}
                  <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                    {(customers.length ? customers : [customerId]).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
                <small>Synthetic challenge data, live from SpacetimeDB</small>
                {user ? <button onClick={signOut}>Sign out</button> : <button onClick={() => router.push('/signin')}>Sign in</button>}
                <button onClick={() => setProfile(false)}>Close menu</button>
              </div>
            )}
          </div>
        </div>
      </header>
    </div>
  )
}
