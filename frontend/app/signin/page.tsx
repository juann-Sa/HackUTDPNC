'use client'

import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import AuthLayout from '@/components/AuthLayout/AuthLayout'
import DemoCustomerField from '@/components/DemoCustomerField'
import { DEFAULT_CUSTOMER, startSession } from '@/lib/demo-session'
import './signin.css'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface SignInValues {
  email: string
  password: string
  remember: boolean
}

type SignInErrors = Partial<Record<keyof SignInValues, string>>

export default function SignIn() {
  const router = useRouter()
  const [values, setValues] = useState<SignInValues>({
    email: '',
    password: '',
    remember: false,
  })
  const [errors, setErrors] = useState<SignInErrors>({})
  const [showPassword, setShowPassword] = useState(false)
  const [customerId, setCustomerId] = useState(DEFAULT_CUSTOMER)

  const update = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    const fieldValue = type === 'checkbox' ? checked : value
    setValues((prev) => ({ ...prev, [name]: fieldValue }) as SignInValues)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[name as keyof SignInValues]
      return next
    })
  }

  const validate = (v: SignInValues): SignInErrors => {
    const next: SignInErrors = {}
    if (!v.email) next.email = 'Email is required.'
    else if (!EMAIL_RE.test(v.email)) next.email = 'Enter a valid email address.'
    if (!v.password) next.password = 'Password is required.'
    return next
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // read the form itself so browser-autofilled fields count even if React never saw a change
    const form = new FormData(e.currentTarget)
    const v = { ...values, email: String(form.get('email') ?? '').trim(), password: String(form.get('password') ?? '') }
    const next = validate(v)
    setErrors(next)
    if (Object.keys(next).length === 0) {
      // Demo sign-in: no auth server; remember the email and chosen customer in this browser only.
      startSession({ email: v.email, customerId })
      router.push('/home')
    }
  }

  return (
    <AuthLayout
      title="Sign in to your account"
      altPrompt="New here?"
      altLinkText="Create an account"
      altLinkTo="/signup"
    >
      <div className="alert" role="note">
        <span>Demo: any email and password work. Nothing is stored or sent.</span>
      </div>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
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
              autoComplete="current-password"
              className={`field__input ${errors.password ? 'field__input--error' : ''}`}
              placeholder="••••••••"
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
          {errors.password && <span className="field__error">{errors.password}</span>}
        </div>

        <DemoCustomerField value={customerId} onChange={setCustomerId} />

        <div className="signin-row">
          <label className="checkbox">
            <input
              type="checkbox"
              name="remember"
              checked={values.remember}
              onChange={update}
            />
            <span>Remember me</span>
          </label>
          <a className="signin-forgot" href="#" onClick={(e) => e.preventDefault()}>
            Forgot password?
          </a>
        </div>

        <button type="submit" className="btn">
          Sign in
        </button>
      </form>
    </AuthLayout>
  )
}
