"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import AccountsWidget from "./AccountsWidget";
import TotalBalanceCard from "./TotalBalanceCard";
import CashFlowChart from "./cash-flow-chart";
import PaymentsPanel from "./payments-panel";
export default function Dashboard() {

 const [profile, setProfile] = useState(false);


 const accountRef = useRef<HTMLDivElement>(null);
 useEffect(() => { const close = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) { setProfile(false); } }; const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProfile(false); } }; document.addEventListener("mousedown", close); document.addEventListener("keydown", escape); return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); }; }, []);
 return <><header className="topbar"><div className="nav-inner"><a className="brand" href="/" aria-label="PNC home">PNC<span className="brand-divider" /><span className="brand-product">360° Navigator</span></a><nav aria-label="Main navigation"><a href="/" className="nav-active" aria-current="page">Home</a><button disabled title="Health page coming soon">Health</button><button disabled title="Future page coming soon">Future</button></nav><div className="account-wrap" ref={accountRef}><button className="account-button" aria-label="Open account menu" aria-expanded={profile} onClick={() => { setProfile(!profile); }}><span className="avatar"><UserRound size={17} /></span><span>My account</span><ChevronDown size={14} /></button>{profile && <div className="dropdown account-menu"><strong>Demo account</strong><p>PNC 360° Financial Health Navigator</p><small>Using sample financial data</small><button onClick={() => setProfile(false)}>Close menu</button></div>}</div></div></header><main><div className="page-heading"><div><h1>Overview</h1></div></div><section className="summary-row" aria-label="Financial summary"><TotalBalanceCard /><AccountsWidget /></section><div className="detail-grid"><CashFlowChart /><PaymentsPanel /></div><footer className="page-footer"><span>PNC 360° Financial Health Navigator</span><span>Hackathon preview · All figures are sample data</span></footer></main></>;
}


