'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, UserRound } from 'lucide-react'
import MainNav, { type AppSection } from '@/components/MainNav'
import { endSession, getSession } from '@/lib/demo-session'

export default function AppHeader({ current }: { current: AppSection }) {
  const router = useRouter()
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null)
  const [customer, setCustomer] = useState('C006')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setUser(getSession())
    try { setCustomer(localStorage.getItem('pnc-navigator-customer-v1') || 'C006') } catch { /* storage unavailable */ }
  }, [])
  return <div className="pnc-dash health-header"><header className="topbar"><div className="nav-inner">
    <Link className="brand" style={{ color: "#F58025" }} href="/home" aria-label="Orbit360° home">Orbit360°</Link>
    <MainNav current={current} variant="dash" />
    <div className="account-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <button className="account-button" aria-label="My Account" onClick={() => router.push("/account")}><span className="avatar"><UserRound size={17} /></span><span>{customer}</span></button><button className="account-options-button" aria-label="Account options" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={14} /></button>
      {open && <div className="dropdown account-menu"><strong>{user ? user.name || user.email : 'Guest'}</strong><p>Viewing {customer}</p><button onClick={() => { if (user) endSession(); router.push('/signin') }}>{user ? 'Sign out' : 'Sign in'}</button><button onClick={() => setOpen(false)}>Close menu</button></div>}
    </div>
  </div></header></div>
}
