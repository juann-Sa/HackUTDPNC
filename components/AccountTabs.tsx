import { useRef, type KeyboardEvent } from "react";
import { accountData, isOptionalAccount, type AccountType, type OptionalAccountType } from "@/lib/account-data";
interface AccountTabsProps { accounts: AccountType[]; selected: AccountType; onSelect: (account: AccountType) => void; onRemove: (account: OptionalAccountType) => void }
export default function AccountTabs({ accounts, selected, onSelect, onRemove }: AccountTabsProps) {
 const refs = useRef<Partial<Record<AccountType, HTMLButtonElement | null>>>({});
 function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
  let next: number;
  if (event.key === "ArrowRight") next = (index + 1) % accounts.length;
  else if (event.key === "ArrowLeft") next = (index - 1 + accounts.length) % accounts.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = accounts.length - 1;
  else return;
  event.preventDefault(); onSelect(accounts[next]); refs.current[accounts[next]]?.focus();
 }
 return <div className="account-tabs" role="tablist" aria-label="Accounts">{accounts.map((account, index) => <div key={account} className={`account-tab-wrap ${selected === account ? "is-active" : ""}`} role="presentation"><button ref={element => { refs.current[account] = element; }} role="tab" id={`account-tab-${account}`} aria-controls={selected === account ? `account-panel-${account}` : undefined} aria-selected={selected === account} tabIndex={selected === account ? 0 : -1} onKeyDown={event => navigate(event, index)} onClick={() => onSelect(account)}>{accountData[account].name}</button>{isOptionalAccount(account) && <button className="account-tab-remove" aria-label={`Remove ${accountData[account].name} tab`} onClick={() => onRemove(account)}>×</button>}</div>)}</div>;
}
