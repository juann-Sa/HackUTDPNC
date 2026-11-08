import type { ReactNode } from 'react'
import Link from 'next/link'
import './AuthLayout.css'
import FinancialPictureDiagram from './FinancialPictureDiagram'

function Logo() {
  return (
    <div className="brand-logo">
      <span className="brand-logo__mark" style={{ color: "#F58025" }}>Orbit360°</span>
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
      <header className="auth__top"><div className="auth__top-inner"><Logo /></div></header>
      <aside className="auth__brand">

        <div className="auth__brand-body"><FinancialPictureDiagram /></div>
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
