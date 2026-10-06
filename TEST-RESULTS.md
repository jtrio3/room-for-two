# Version 1.1 verification

Verified locally on October 6, 2026. These tests use synthetic data; no live Supabase project or Netlify deployment was changed.

| Check | Result |
| --- | --- |
| Production Next.js build, standard `npm run build` (Turbopack) | Passed |
| Additional production build with Webpack | Passed |
| TypeScript check | Passed |
| Automated model, client, and PostgreSQL tests | 43 passed, 0 failed |
| Production API integration | Passed |
| Desktop and mobile browser workflows | Passed |
| Mobile item editor at 320×568, 390×844, and 630×682 | Save footer stays separate from scrolling fields |
| Same shared plan link in an independent browser session | Same items and totals loaded |

The version 1.1 checks ran with Node.js 26.7.0. Netlify remains configured for Node 22, which was verified for the original conversion; dependencies did not change in this update. The deployment itself should still be checked after publishing.

## Automated tests

Budget tests cover expected-price calculations, current-price fallback, known zero prices, incomplete totals, expected prices above current prices, savings and overages, and backup promotion. Group tests cover subtotals without double-counting, deterministic order, plan-scoped membership validation, and membership conflict reconciliation. Client tests cover stale responses, plan switching, request timeouts, and shared-link/session races.

PostgreSQL tests execute the actual schema, upgrade migration, and saving functions in an isolated PGlite database. The upgrade starts from the original schema and checks preserved plan access, revisions, prices, backups, and manual order. Tests also cover repeatable migration, append-only item creation, legacy clients omitting group membership, atomic inline creation, invalid-operation rollback, isolation between plans, browser-role denial, concurrent revisions, and group removal without losing purchases.

## Production API integration

The integration check starts the built Next.js server and routes its Supabase SDK calls through a local HTTP bridge to isolated PostgreSQL. It checks page serving, authorization, request origins and size limits, plan creation and persistence, item/backup edits, group operations, expected prices, automatic append and reorder, simultaneous-edit conflicts, and recovery after simulated storage failure. It supplies its own dummy credentials.

## Browser checks

Headless Chrome exercised the actual production app on desktop and at three small viewport sizes. Checks included creating purchases, creating a group inline, linking existing purchases, filtered versus full group totals, removing a group while preserving items and the whole-plan spend, current-price fallback, zero expected price, automatic append, keyboard and pointer reordering with refresh, and opening the same shared link in a separate browser session.

The item editor's scroll region ends above its footer, Save stays inside the viewport, and save notifications cannot cover the controls while a form is open. Screenshots were visually inspected after opening animations completed. No page/modal horizontal overflow or browser runtime errors were observed. This is browser-based mobile layout testing, not testing on a physical iPhone.

## Reproduce locally

After installing dependencies:

```sh
npm run build
npm run typecheck
npm test
npm run test:integration
```

The production API integration and automated tests do not require real Supabase credentials. For normal use, follow [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md) and perform its final checks on your published site and second device.
