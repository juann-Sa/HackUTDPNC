import { accountData, type AccountType } from "@/lib/account-data";
import AccountProgress from "./AccountProgress";
export default function AccountContent({ account }: { account: AccountType }) {
 const data = accountData[account];
 const change = data.change?.trim();
 const changeDirection = change?.startsWith("+") ? "positive" : change && /^[−-]/.test(change) ? "negative" : "neutral";
 return <div key={account} id={`account-panel-${account}`} role="tabpanel" aria-labelledby={`account-tab-${account}`} tabIndex={0} className="account-content"><div className="account-primary"><span className="account-metric-label">{data.primary.label}</span><strong className="account-primary-value">{data.primary.value}</strong>{data.change && <span className="account-change" data-direction={changeDirection}>{data.change}</span>}</div><div className="account-support"><div className="account-metrics">{data.metrics.map(metric => <div key={metric.label}><span className="account-metric-label">{metric.label}</span><strong>{metric.value}</strong></div>)}</div>{data.progress && <AccountProgress {...data.progress} />}</div></div>;
}
