export default function AccountProgress({ label, value, detail }: { label: string; value: number; detail: string }) {
 return <div className="account-progress"><div className="progress-label"><span>{label}</span><strong>{value}%</strong></div><div className="progress-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-valuetext={detail}><span style={{ width: `${value}%` }} /></div></div>;
}
