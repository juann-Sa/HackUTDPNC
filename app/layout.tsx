import type { Metadata } from "next";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "./globals.css";
export const metadata: Metadata = { title: "PNC | Financial Health Navigator", description: "Your 360° view of financial wellbeing. Hackathon dashboard with sample data." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
