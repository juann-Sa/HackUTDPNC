"use client";
import AppHeader from "../AppHeader";
import LiveDataProvider from "../live-data-provider";
import ProfileSection from "./ProfileSection";
import FinancialGoals from "./FinancialGoals";
import ConnectedBanks from "./ConnectedBanks";
import AccountPreferences from "./AccountPreferences";
export default function AccountPage() { return <LiveDataProvider><div className="account-page"><AppHeader current="account" /><main className="account-main"><header className="account-page-heading"><h1>My Account</h1></header><ProfileSection /><FinancialGoals /><div className="account-bottom-grid"><ConnectedBanks /><AccountPreferences /></div></main></div></LiveDataProvider>; }
