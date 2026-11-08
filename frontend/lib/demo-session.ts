// Demo sign-in: no real accounts. Signing in only remembers who is "signed in" and which synthetic
// customer to show, in this browser. Passwords are never stored, sent or logged.
export interface DemoSession { email: string; name?: string; customerId: string }

const USER_KEY = 'pnc-navigator-user-v1';
const CUSTOMER_KEY = 'pnc-navigator-customer-v1'; // same key the dashboard's customer picker uses
export const DEFAULT_CUSTOMER = 'C006';

export function startSession(s: DemoSession): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ email: s.email, name: s.name }));
    localStorage.setItem(CUSTOMER_KEY, s.customerId);
  } catch { /* storage unavailable: the dashboard still opens on the default customer */ }
}

export function getSession(): { email: string; name?: string } | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && 'email' in v && typeof v.email === 'string' ? (v as { email: string; name?: string }) : null;
  } catch { return null; }
}

export function endSession(): void {
  try { localStorage.removeItem(USER_KEY); } catch { /* nothing to clear */ }
}
