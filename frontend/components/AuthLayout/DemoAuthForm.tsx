"use client";
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import AuthLayout from './AuthLayout';
import DemoCustomerField from '../DemoCustomerField';
import { DEFAULT_CUSTOMER, startSession } from '@/lib/demo-session';
export default function DemoAuthForm({signup=false}:{signup?:boolean}){
 const router=useRouter();const [error,setError]=useState('');const [customerId,setCustomerId]=useState(DEFAULT_CUSTOMER);const [busy,setBusy]=useState(false);const [showPassword,setShowPassword]=useState(false);
 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setError('');
  const fields=new FormData(event.currentTarget);const password=String(fields.get('password')??'');
  if(signup&&password!==fields.get('confirm')){setError('Passwords do not match.');return;}
  setBusy(true);
  startSession({email:String(fields.get('email')??'').trim(),name:signup?String(fields.get('name')??'').trim():undefined,customerId});
  router.replace('/home');router.refresh();
 }
 return <AuthLayout title={signup?'Create account':'Sign in'} altPrompt={signup?'Already have an account?':'New here?'} altLinkText={signup?'Sign in':'Create an account'} altLinkTo={signup?'/signin':'/signup'}><form className="auth-form" onSubmit={submit}>
 {signup&&<div className="field"><label className="field__label" htmlFor="auth-name">Full name</label><input id="auth-name" className="field__input" name="name" autoComplete="name" maxLength={80} required disabled={busy} /></div>}
 <div className="field"><label className="field__label" htmlFor="auth-email">Email</label><input id="auth-email" className="field__input" name="email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={busy} /></div>
 <div className="field field--pad-toggle"><label className="field__label" htmlFor="auth-password">Password</label><div className="field__input-wrap"><input id="auth-password" className="field__input" name="password" type={showPassword?'text':'password'} autoComplete={signup?'new-password':'current-password'} minLength={signup?8:undefined} maxLength={1024} required disabled={busy} /><button className="field__toggle" type="button" aria-label={showPassword?'Hide password':'Show password'} aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?'Hide':'Show'}</button></div></div>
 {signup&&<div className="field"><label className="field__label" htmlFor="auth-confirm">Confirm password</label><input id="auth-confirm" className="field__input" name="confirm" type={showPassword?'text':'password'} autoComplete="new-password" maxLength={1024} required disabled={busy} /></div>}
 <DemoCustomerField value={customerId} onChange={setCustomerId} />{error&&<p className="field__error" role="alert">{error}</p>}<button className="btn" type="submit" disabled={busy}>{busy?'Please wait…':signup?'Create account':'Sign in'}</button>
 </form></AuthLayout>;
}
