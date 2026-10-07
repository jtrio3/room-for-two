# Version 1.2 verification

Verified locally on October 6, 2026, using synthetic plans. No live Supabase project or Netlify deployment was changed.

| Check | Result |
| --- | --- |
| Production Next.js build, standard `npm run build` | Passed |
| TypeScript check | Passed |
| Automated model, client, and PostgreSQL tests | 60 passed, 0 failed |
| Production API integration against isolated PostgreSQL | Passed |
| Desktop purchase and shared-plan browser workflows | Passed |
| Touch layouts at 320×568, 390×844, 430×932, and 630×682 | Passed |
| Purchase and item form footers, tag spacing, horizontal overflow | Passed |
| Browser runtime errors | None observed |

Checks ran with Node.js 26.7.0. Netlify remains configured for Node 22, as in the original conversion. Dependencies did not change in this update. These local checks do not verify the hosted deployment; finish the checks in UPDATE-LIVE-SITE.md after publishing.

## Automated tests

The 60 tests include existing plan, grouping, validation, concurrency, and ordering coverage plus purchase tracking. They check actual spending independently of planned budgets, zero-cost purchases, missing legacy purchase fields, undo, projected spending, backup exclusions, and prevention of backup promotion while purchased.

PostgreSQL tests execute the actual SQL functions and migrations in isolated PGlite databases. The purchase upgrade starts from the original version 1.1 schema and verifies that plan access hashes, timestamps, groups, backups, existing amounts, and order survive. Tests also cover repeated migrations, invalid amounts, cross-plan access, stale requests, transaction rollback, and preservation of recorded payments through ordinary item and group edits. Only the dedicated purchase action changes a payment record.

## Production integration

The built Next.js server calls the Supabase SDK against a local HTTP bridge and isolated PostgreSQL, using dummy credentials. Checks cover authorization, request origin and size limits, plan persistence, items/backups/groups, inline group creation, purchase logging, correction and undo, a zero-dollar purchase, invalid prices, simultaneous edits, storage failure recovery, and manual order.

## Browser workflows

Headless Chrome exercised the built app with a synthetic shopping list. Verified:

- Budgeted amount and High-end estimate labels; planned totals remain unchanged when recording payments.
- An empty actual price is rejected; paid amounts save and update the separate Actual spent summary.
- Editing a recorded amount replaces its contribution; undo clears it after confirmation; a $0 purchase still counts.
- Purchase-status and timing filters combine in Items and Groups; full group budgets remain distinct from filtered subtotals.
- A second browser opens the same plan. Conflicting purchase edits preserve the draft, show the latest record, and require explicit review before retrying.
- Ordinary item/backup edits keep the purchase amount. A purchased item's backup cannot be promoted until the purchase is undone.
- Pointer reordering survives refresh.
- Phone-size contexts use touch input. Timing and group pills have visible gaps, and the compact pill remains separate from its touch target.
- Purchase and item editors scroll separately from their action bars. Save remains inside the viewport and unobstructed by notifications. There is no page or modal horizontal overflow at the tested widths.

Screenshots were visually inspected after animations completed. These are browser-based mobile checks, not a physical iPhone test.

## Reproduce locally

After installing dependencies:

```sh
npm run build
npm run typecheck
npm test
npm run test:integration
```

Automated and integration tests do not require real Supabase credentials. For the published site and a second device, follow [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md).
