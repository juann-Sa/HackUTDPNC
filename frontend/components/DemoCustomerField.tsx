'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_CUSTOMER } from '@/lib/demo-session'

/** Which synthetic customer's data to show after signing in (the demo has no real accounts). */
export default function DemoCustomerField({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [customers, setCustomers] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/customers')
      .then((r) => r.json())
      .then((list) => { if (Array.isArray(list)) setCustomers(list) })
      .catch(() => {})
  }, [])
  const options = customers.length ? customers : [DEFAULT_CUSTOMER]
  return (
    <div className="field">
      <label className="field__label" htmlFor="demo-customer">
        Demo customer
      </label>
      <div className="field__input-wrap">
        <select id="demo-customer" className="field__input" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>
      <span className="field__hint">Synthetic challenge data — pick whose finances to explore.</span>
    </div>
  )
}
