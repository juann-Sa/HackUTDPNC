import type { ReactNode } from 'react'
import Link from 'next/link'
import './AuthLayout.css'

function Logo() {
  return (
    <div className="brand-logo">
      <span className="brand-logo__mark">PNC</span>
      <span className="brand-logo__divider" aria-hidden="true" />
      <span className="brand-logo__product">360° Financial Advisor</span>
    </div>
  )
}

interface AuthLayoutProps {
  title: string
  children: ReactNode
  eyebrow?: string
  subtitle?: string
  altPrompt?: string
  altLinkText?: string
  altLinkTo?: string
}

/**
 * Shared split-screen shell for the auth pages: an orange brand panel on the
 * left and a white form panel on the right. Pages pass their form as children.
 */
export default function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  altPrompt,
  altLinkText,
  altLinkTo,
}: AuthLayoutProps) {
  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__brand-top">
          <Logo />
        </div>

        <div className="auth__brand-body">
          <h1 className="auth__brand-title">See your whole financial picture.</h1>
          <p className="auth__brand-text">
            Accounts, savings and goals in one place — with a coach that explains the
            numbers in plain language.
          </p>
          <ul className="auth__brand-list">
            <li>Consolidate every account into one profile</li>
            <li>Understand your financial health at a glance</li>
            <li>Plan your next move with confidence</li>
          </ul>
        </div>

        <span className="auth__blob auth__blob--1" aria-hidden="true" />
        <span className="auth__blob auth__blob--2" aria-hidden="true" />
      </aside>

      <main className="auth__panel">
        <div className="auth__card">
          <header className="auth__header">
            {eyebrow && <span className="auth__eyebrow">{eyebrow}</span>}
            <h2 className="auth__title">{title}</h2>
            {subtitle && <p className="auth__subtitle">{subtitle}</p>}
          </header>

          {children}

          {altPrompt && altLinkTo && (
            <p className="auth__alt">
              {altPrompt} <Link href={altLinkTo}>{altLinkText}</Link>
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
