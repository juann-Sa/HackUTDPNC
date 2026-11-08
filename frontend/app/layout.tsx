import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist/600.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'PNC | 360° Financial Advisor',
  description: 'See your whole financial picture in one place.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
