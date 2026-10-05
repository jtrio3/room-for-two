# Conversion verification

Verified locally with Node.js 22.23.3, matching the Node 22 family selected for Netlify.

| Check | Result |
| --- | --- |
| Production Next.js build | Passed |
| TypeScript check | Passed |
| Automated tests | 19 passed, 0 failed |
| Production API integration | Passed |
| Clean installation from the extracted ZIP using `npm ci` | Passed |
| Fresh extracted-source build with Next.js Webpack | Passed |
| ZIP integrity and required deployment files | Passed |

The automated tests cover budget arithmetic, zero and missing prices, safe URLs, priority changes, backup promotion, shared-link/session races, stale responses, and request timeouts. PostgreSQL tests execute the actual setup script and saving functions, including rollback on invalid changes, isolation between plans, denied browser-role access, cascading deletes, and repeatable setup.

The integration check runs the built Next.js server and its Supabase SDK calls against an isolated PGlite PostgreSQL database through a local HTTP bridge. It checks page serving, authorization, same-origin and cross-origin requests, creating and reading plans, items and backups, settings, reordering, deleting, request-size limits, simultaneous-edit conflicts, and recovery after simulated storage failure.

The normal Turbopack production build passed in the working folder. The additional extracted-source build used `next build --webpack` because the test sandbox blocked Turbopack's local worker port. The delivered build command remains the standard `next build`.

No live Supabase project or Netlify deployment was accessed during these tests. After setting up your accounts, complete the add-item, refresh, and second-device checks in [START-HERE.md](START-HERE.md).

To reproduce after installing dependencies:

```sh
npm run build
npm run typecheck
npm test
npm run test:integration
```

These checks use synthetic data and do not require real Supabase credentials.
