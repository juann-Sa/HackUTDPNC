# PNC 360° Financial Health Navigator

Local hackathon frontend built with Next.js App Router, React, TypeScript, Tailwind CSS, Recharts, and Lucide React. All financial data is sample data; there are no backend integrations.

## Run

Requires Node.js 20.9 or later.

```powershell
npm.cmd install
npm.cmd run dev
```

Open http://localhost:3000. On systems without PowerShell's npm script restriction, `npm` also works.

## Verify

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Manual checks:
- Switch between 1W, 1M, 3M, 1Y, and ALL, and hover chart lines to inspect values.
- Navigate payment months, including across December/January.
- Toggle payment checkboxes; remaining amount and count update. Return to a month to see its retained completion state during the session.
- Click Savings and Credit to expand account details.
- Remove a widget with its X, then restore it from Add Widget. Added widgets are disabled in the menu.
- Open the account menu; close menus with Escape or an outside click.
- Check narrow/mobile widths and keyboard navigation.

## Structure

- `app/`: App Router page, layout, global styles.
- `components/dashboard.tsx`: Dashboard shell, reusable widgets, cash flow chart, payments panel.
- `lib/mock-data.ts`: Typed fixtures and formatting utilities, isolated for future API integration.

Health and Future are disabled navigation placeholders. The PNC name is plain text because no official logo asset was supplied. Replace the label with the official unmodified asset when available. Completion state resets on refresh. The chart fixtures end on November 7, 2026; payments initially show the viewer's current month.
