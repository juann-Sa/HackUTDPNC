"use client";
import { useEffect, useRef, type ReactNode } from "react";
export default function AccountModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
 const ref = useRef<HTMLDialogElement>(null);
 useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => { dialog?.close(); }; }, []);
 return <dialog ref={ref} className="account-modal" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="account-modal-title"><div className="account-modal-heading"><h2 id="account-modal-title">{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose}>×</button></div>{children}</dialog>;
}
