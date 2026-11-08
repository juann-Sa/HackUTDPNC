"use client";
import { useEffect, useState, type FormEvent } from "react";
import { getSession, startSession } from "@/lib/demo-session";
import { useLiveData } from "../live-data-provider";
import AccountModal from "./AccountModal";
export default function ProfileSection() {
 const { customerId } = useLiveData(); const [profile, setProfile] = useState<{ name?: string; email: string } | null>(null); const [editing, setEditing] = useState(false); const [name, setName] = useState(""); const [error, setError] = useState(""); const [status, setStatus] = useState("");
 useEffect(() => { setProfile(getSession()); }, []);
 const display = profile?.name || (profile ? profile.email.split("@")[0] : "Demo user");
 function save(event: FormEvent) { event.preventDefault(); if (!name.trim()) { setError("Enter a display name."); return; } if (!profile) return; const next = { ...profile, name: name.trim() }; startSession({ ...next, customerId }); setProfile(next); setEditing(false); setStatus("Profile updated for this browser."); }
 return <section className="account-profile account-section"><div className="account-profile-avatar" aria-hidden>{display.split(/\s+/).slice(0,2).map(word => word[0]).join("").toUpperCase()}</div><div className="account-profile-info"><h2>{display}</h2><p>{profile?.email ?? "Not signed in · viewing a synthetic customer"}</p><span>Account profile</span></div><button disabled={!profile} onClick={() => { setName(profile?.name ?? display); setError(""); setEditing(true); }}>Edit Profile</button><p className="account-status" role="status">{status}</p>{editing && <AccountModal title="Edit profile" onClose={() => setEditing(false)}><form className="account-form" onSubmit={save}><label>Display name<input autoFocus value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label><label>Email<input type="email" value={profile?.email ?? ""} readOnly /></label><p className="account-note">Email changes are unavailable in this demo. Personal display and reminder preferences are available below.</p>{error && <p className="account-error" role="alert">{error}</p>}<div className="account-modal-actions"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button type="submit" className="account-primary-button">Save Profile</button></div></form></AccountModal>}</section>;
}
