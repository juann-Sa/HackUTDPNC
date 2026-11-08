"use client";
import AccountsWidget from "./AccountsWidget";
import TotalBalanceCard from "./TotalBalanceCard";
import CashFlowChart from "./cash-flow-chart";
import PaymentsPanel from "./payments-panel";
import CoachPanel from "./coach-panel";
import CoachActions from "./coach-actions";
import GoalsPanel from "./goals-panel";
import LiveDataProvider, { useLiveData } from "./live-data-provider";
import SiteHeader from "@/components/SiteHeader";
export type DashView = "home" | "coach";
export default function Dashboard({ view = "home" }: { view?: DashView }) { return <LiveDataProvider><DashboardInner view={view} /></LiveDataProvider>; }

function DashboardInner({ view }: { view: DashView }) {
 const { error, data } = useLiveData();

 return <div className="pnc-dash"><SiteHeader current={view} /><main><div className="page-heading"><div><h1>{view === "coach" ? "Coach" : "Overview"}</h1>{data && <p className="as-of">Data as of {new Date(`${data.book_snapshot[0]?.as_of ?? ""}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>}</div></div>{error && <div className="live-error" role="alert">Can’t load live data from SpacetimeDB: {error}. Is <code>spacetime start</code> running and the spacetime360 module published?</div>}{view === "coach" ? <><CoachPanel /><div className="detail-grid"><CoachActions /><GoalsPanel /></div></> : <><section className="summary-row" aria-label="Financial summary"><TotalBalanceCard /><AccountsWidget /></section><div className="detail-grid"><CashFlowChart /><PaymentsPanel /></div></>}<footer className="page-footer"><span>PNC 360° Financial Health Navigator</span><span>Hackathon preview · Synthetic customer data served from SpacetimeDB · Educational tool, not financial advice</span></footer></main></div>;
}


