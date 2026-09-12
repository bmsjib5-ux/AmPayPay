# AmPayPay UI refresh — v76

## Approved concept implementation (v76)

Implements the approved three-screen mockup in the existing PWA; this is not an Expo migration. NativeShad (https://github.com/chvvkrishnakumar/NativeShad), formerly Expo NativeWind Template, informed the card, tab, theme and bottom-sheet patterns. No third-party component code was copied.

- Five destinations: overview, transactions, add, split bills, profile. Debtors and friends share a segmented view. Explicit deep links retain their original routing.
- Data-backed monthly overview: budget remainder/overspend, progress, category donut with accessible table, latest three transactions. Detailed reports and budget editor remain in an expandable section.
- Receipt/manual modes, large amount field, quick category buttons and the existing split controls.
- Debtor cards include initials and a QR action using the exact outstanding amount; missing PromptPay setup opens the existing setup flow.
- Appearance/account controls move to profile; service worker includes the new design assets.

Verified locally: added THB 120 to existing THB 125 (total THB 245); set budget THB 15,000 (remainder THB 14,755); split THB 1,500 between two people (debt THB 750, total expenses THB 1,745, remainder THB 13,255). Five-tab navigation, friend switching, missing-PromptPay sheet, 390px mobile and 320px dark mode checked. No horizontal document overflow in manual form or overview. JavaScript syntax and diff whitespace checks pass.

Changes are local, not pushed or deployed. Camera/OCR, configured QR scanning, authenticated friend sync and native wrappers still need device/integration testing. Test data stays on localhost.

Implementation: `assets/design.js`, `assets/design.css`, debtor QR button in `assets/app.js`, asset loading in `index.html` and `sw.js`.

## Earlier base refresh (v75)

Original cream/forest-green styling for the existing HTML/CSS/JavaScript PWA.
Design references: [ExpenseOwl](https://github.com/Tanq16/ExpenseOwl) for clear financial summaries and [Framework7](https://github.com/framework7io/framework7) for mobile navigation conventions. No third-party source code, assets or dependencies were copied.

## Changes

- Consistent line icons for main navigation and receipt actions.
- Prominent full-width camera action, secondary image/manual/paste actions.
- Page headings on all six main panels.
- Large monthly-total card before budget settings, paired secondary statistics.
- Shared card, form, button and light/dark theme treatment.
- Safe-area-aware navigation, visible keyboard focus, reduced-motion support, and enabled viewport zoom.
- Service-worker shell updated to cache the new stylesheet and versioned CSS URLs.

## Validation

- Browser: manual expense entry of THB 125, then summary total/count/category graph and list persistence after reload.
- Visual review: 390px mobile, 320px mobile dark theme, 1280px desktop.
- JavaScript syntax checks and git diff whitespace checks pass.
- No production data used. Authentication, live friend billing, device camera/OCR and iOS native wrapper require device/integration testing before release.

## Local preview

Serve this directory with any static HTTP server. No build step is required.
