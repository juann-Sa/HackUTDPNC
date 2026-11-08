'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import AuthLayout from '@/components/AuthLayout/AuthLayout'
import DemoCustomerField from '@/components/DemoCustomerField'
import { DEFAULT_CUSTOMER, startSession } from '@/lib/demo-session'
import './signup.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong']

interface SignUpValues {
  name: string
  email: string
  password: string
  confirm: string
  terms: boolean
}

type SignUpErrors = Partial<Record<keyof SignUpValues, string>>

function scorePassword(pw: string): number {
  if (!pw) return 0
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return Math.min(score, 4)
}

export default function SignUp() {
  const [values, setValues] = useState<SignUpValues>({
    name: '',
    email: '',
    password: '',
    confirm: '',
    terms: false,
  })
  const [errors, setErrors] = useState<SignUpErrors>({})
  const [showPassword, setShowPassword] = useState(false)
  const [customerId, setCustomerId] = useState(DEFAULT_CUSTOMER)
  const router = useRouter()

  const strength = scorePassword(values.password)

  const update = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    const fieldValue = type === 'checkbox' ? checked : value
    setValues((prev) => ({ ...prev, [name]: fieldValue }) as SignUpValues)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[name as keyof SignUpValues]
      return next
    })
  }

  const validate = (values: SignUpValues): SignUpErrors => {
    const next: SignUpErrors = {}
    if (!values.name.trim()) next.name = 'Please enter your name.'
    if (!values.email) next.email = 'Email is required.'
    else if (!EMAIL_RE.test(values.email)) next.email = 'Enter a valid email address.'
    if (!values.password) next.password = 'Password is required.'
    else if (values.password.length < 8) next.password = 'Use at least 8 characters.'
    if (!values.confirm) next.confirm = 'Please confirm your password.'
    else if (values.confirm !== values.password) next.confirm = 'Passwords do not match.'
    if (!values.terms) next.terms = 'Please accept the terms to continue.'
    return next
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // read the form itself so browser-autofilled fields count even if React never saw a change
    const form = new FormData(e.currentTarget)
    const field = (k: string) => String(form.get(k) ?? '')
    const v = { ...values, name: field('name'), email: field('email').trim(), password: field('password'), confirm: field('confirm') }
    const next = validate(v)
    setErrors(next)
    if (Object.keys(next).length === 0) {
      // Demo sign-up: no account is created; remember the name, email and chosen customer in this browser only.
      startSession({ email: v.email, name: v.name.trim(), customerId })
      router.push('/home')
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      altPrompt="Already have an account?"
      altLinkText="Sign in"
      altLinkTo="/signin"
    >
      <div className="alert" role="note">
        <span>Demo: no real account is created. Nothing is stored or sent.</span>
      </div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="name">
            Full name
          </label>
          <div className="field__input-wrap">
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              className={`field__input ${errors.name ? 'field__input--error' : ''}`}
              placeholder="Alex Johnson"
              value={values.name}
              onChange={update}
            />
          </div>
          {errors.name && <span className="field__error">{errors.name}</span>}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <div className="field__input-wrap">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              className={`field__input ${errors.email ? 'field__input--error' : ''}`}
              placeholder="you@example.com"
              value={values.email}
              onChange={update}
            />
          </div>
          {errors.email && <span className="field__error">{errors.email}</span>}
        </div>

        <div className="field field--pad-toggle">
          <label className="field__label" htmlFor="password">
            Password
          </label>
          <div className="field__input-wrap">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className={`field__input ${errors.password ? 'field__input--error' : ''}`}
              placeholder="At least 8 characters"
              value={values.password}
              onChange={update}
            />
            <button
              type="button"
              className="field__toggle"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {values.password && (
            <div className={`strength strength--${strength}`}>
              <div className="strength__track">
                <div
                  className="strength__bar"
                  style={{ width: `${(strength / 4) * 100}%` }}
                />
              </div>
              <span className="strength__label">{STRENGTH_LABELS[strength]}</span>
            </div>
          )}
          {errors.password && <span className="field__error">{errors.password}</span>}
        </div>

        <div className="field field--pad-toggle">
          <label className="field__label" htmlFor="confirm">
            Confirm password
          </label>
          <div className="field__input-wrap">
            <input
              id="confirm"
              name="confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className={`field__input ${errors.confirm ? 'field__input--error' : ''}`}
              placeholder="Re-enter your password"
              value={values.confirm}
              onChange={update}
            />
          </div>
          {errors.confirm && <span className="field__error">{errors.confirm}</span>}
        </div>

        <DemoCustomerField value={customerId} onChange={setCustomerId} />

        <div className="field">
          <label className="checkbox signup-terms">
            <input
              type="checkbox"
              name="terms"
              checked={values.terms}
              onChange={update}
            />
            <span>
              I agree to the{' '}
              <a href="#" onClick={(e) => e.preventDefault()}>
                Terms
              </a>{' '}
              and{' '}
              <a href="#" onClick={(e) => e.preventDefault()}>
                Privacy Policy
              </a>
              .
            </span>
          </label>
          {errors.terms && <span className="field__error">{errors.terms}</span>}
        </div>

        <button type="submit" className="btn">
          Create account
        </button>
      </form>
    </AuthLayout>
  )
}
