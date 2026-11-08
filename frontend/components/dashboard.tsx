"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import AccountsWidget from "./AccountsWidget";
import TotalBalanceCard from "./TotalBalanceCard";
import CashFlowChart from "./cash-flow-chart";
import PaymentsPanel from "./payments-panel";
import CoachPanel from "./coach-panel";
import CoachActions from "./coach-actions";
import GoalsPanel from "./goals-panel";
import LiveDataProvider, { useLiveData } from "./live-data-provider";
import MainNav from "@/components/MainNav";
import { useRouter } from "next/navigation";
import { endSession, getSession } from "@/lib/demo-session";
export default function Dashboard() { return <LiveDataProvider><DashboardInner /></LiveDataProvider>; }

function DashboardInner() {
 const { customerId, setCustomerId, customers, error, data } = useLiveData();

 const [profile, setProfile] = useState(false);
 const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
 const router = useRouter();
 useEffect(() => { setUser(getSession()); }, []);
 const signOut = () => { endSession(); router.push("/signin"); };


 const accountRef = useRef<HTMLDivElement>(null);
 useEffect(() => { const close = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) { setProfile(false); } }; const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProfile(false); } }; document.addEventListener("mousedown", close); document.addEventListener("keydown", escape); return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); }; }, []);
 return <div className="pnc-dash"><header className="topbar"><div className="nav-inner"><a className="brand" href="/home" aria-label="PNC home">PNC<span className="brand-divider" /><span className="brand-product">360° Navigator</span></a><MainNav current="home" variant="dash" /><div className="account-wrap" ref={accountRef}><button className="account-button" aria-label="Open account menu" aria-expanded={profile} onClick={() => { setProfile(!profile); }}><span className="avatar"><UserRound size={17} /></span><span>{customerId}</span><ChevronDown size={14} /></button>{profile && <div className="dropdown account-menu"><strong>{user ? (user.name || user.email) : `Customer ${customerId}`}</strong><p>{user ? `${user.email} · viewing ${customerId}` : "PNC 360° Financial Health Navigator"}</p><label className="customer-picker">Switch customer <select value={customerId} onChange={event => setCustomerId(event.target.value)}>{(customers.length ? customers : [customerId]).map(id => <option key={id} value={id}>{id}</option>)}</select></label><small>Synthetic challenge data, live from SpacetimeDB</small>{user ? <button onClick={signOut}>Sign out</button> : <button onClick={() => router.push("/signin")}>Sign in</button>}<button onClick={() => setProfile(false)}>Close menu</button></div>}</div></div></header><main><div className="page-heading"><div><h1>Overview</h1>{data && <p className="as-of">Data as of {new Date(`${data.book_snapshot[0]?.as_of ?? ""}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>}</div></div>{error && <div className="live-error" role="alert">Can’t load live data from SpacetimeDB: {error}. Is <code>spacetime start</code> running and the spacetime360 module published?</div>}<section className="summary-row" aria-label="Financial summary"><TotalBalanceCard /><AccountsWidget /></section><CoachPanel /><div className="detail-grid"><CoachActions /><GoalsPanel /></div><div className="detail-grid"><CashFlowChart /><PaymentsPanel /></div><footer className="page-footer"><span>PNC 360° Financial Health Navigator</span><span>Hackathon preview · Synthetic customer data served from SpacetimeDB · Educational tool, not financial advice</span></footer></main></div>;
}


