# Room for Two

A responsive shopping planner for two people preparing for a November move. Starts with a **$12,000 budget**: $10,000 personal funds and a $2,000 family gift. Both amounts and the move month are editable.

**Already using the live app? Follow [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md) to install version 1.1.** Keep your existing Supabase project, Netlify site, and complete plan link.

For a first installation, follow [START-HERE.md](START-HERE.md). This is a complete Next.js app for Netlify, with Supabase PostgreSQL storage.

## Features

- Add, edit, delete, sort, and manually reorder purchases. New items join the end of the list; drag handles and keyboard arrow keys set the order without entering priority numbers.
- Link separate purchases into named groups, such as a TV, mount, and speakers in “TV setup.” Each item keeps its own prices, timing, notes, and backups.
- Switch between Items and Groups. Create empty groups, link existing purchases, move purchases between groups, or add an item directly to a group.
- Remove a group without deleting any purchases. Grouping never adds another budget charge.
- Immediate needs and purchases that can wait, organized by room.
- Purchase links, image links, expected and current prices, and notes.
- Expected spend drives budget allocation, remaining funds, immediate needs, and room/group subtotals. Current prices remain available for comparison and as an explicitly identified fallback when expected price is blank.
- Multiple backup choices per item; promote a backup while retaining the former choice and preserving group membership and list order.
- Shared edit links without accounts or sign-in.
- Cloud saves, periodic refresh, and explicit conflict review when two people edit at once.
- Responsive phone and desktop layouts, accessible dialogs, and missing-price indicators. Item forms scroll separately from their Save controls.

## How it works

The browser calls the same-origin `/api/plan` route. That route validates the edit key and request body, then calls transactional PostgreSQL functions through the Supabase SDK. Netlify runs the Next.js server; Supabase stores the records.

Each plan uses a random 256-bit edit key in the `#plan=...` URL fragment. The browser remembers it locally and sends it to the API in the Authorization header. Only its SHA-256 hash is stored in the database. Anyone with the complete link can view and edit that plan. There is no email invitation, password, or account recovery flow; bookmark the full link.

Supabase credentials stay on the server. Row-level security is enabled, and public/browser roles cannot access the tables or saving functions. The server's secret key uses the privileged `service_role`. Do not expose this key with a `NEXT_PUBLIC_` variable or commit a real `.env` file.

Each mutation locks its plan and checks the expected revision. A stale edit receives the current plan instead of silently overwriting another person's work. Item changes, backup changes, membership, order, and the revision increment commit together. Group membership changes do not replace item prices, notes, or backups. The group editor compares the original selection, the draft, and the latest membership before a reviewed retry.

Client requests are bound to the current plan link, time out, and cannot apply an older revision over a newer one. View and collapse preferences stay on each device.

See [DATA-MODEL.md](DATA-MODEL.md) for the schema and calculations. Version 1.1 keeps the stored `regular` and `sale` fields: existing regular prices appear as **Current price** and existing sale/target prices appear as **Expected price**. No re-entry of those values is needed.

## Local setup

Use Node.js 22.13 or newer; `.nvmrc` and Netlify select Node 22.

1. For a fresh Supabase project, run `supabase/setup.sql` in its SQL Editor. For an existing version 1.0 project, use the migration described in [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md).
2. Copy `.env.example` to `.env.local`, then set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
3. Run `npm ci` and `npm run dev`.
4. Open the address printed by Next.js.

The production build can run without credentials. Reading and saving plans require the environment variables and database setup.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development |
| `npm run build` | Production build |
| `npm start` | Run the production build locally |
| `npm run typecheck` | Check TypeScript |
| `npm test` | Budget, validation, grouping, client-session, and PostgreSQL tests |
| `npm run test:integration` | Test the built Next.js app and Supabase SDK against isolated PostgreSQL; run the build first |

Tests use an in-memory PGlite PostgreSQL instance and synthetic data. They do not access your live Supabase project. The integration test starts a local HTTP bridge to exercise the actual Supabase SDK and database functions through the production API. Local test success does not confirm your hosted deployment; check the live site after Netlify finishes.

## Project files

| Location | Purpose |
| --- | --- |
| `app/page.tsx`, `app/globals.css` | Planner interface and responsive styling |
| `app/api/plan/route.ts` | Validated server API |
| `lib/planner.ts` | Data types, validation, and budget calculations |
| `lib/groups.ts` | Group ordering, subtotals, and membership-conflict helpers |
| `lib/request.ts` | Accepted save actions and request validation |
| `lib/client.ts` | Request sessions and shared-link handling |
| `lib/server/supabase.ts` | Server-only database connection |
| `supabase/setup.sql` | Complete fresh-install schema, access controls, and transactional functions |
| `supabase/migrations/20261005_groups_expected_price.sql` | Non-destructive upgrade for the existing database |
| `netlify.toml` | Hosting build settings |
| `UPDATE-LIVE-SITE.md` | Update an existing live installation |
| `START-HERE.md` | First-time Supabase, GitHub, and Netlify setup |

## Current scope

Prices are entered manually; totals exclude tax and delivery. Images are supplied by URL, with category icons if an image cannot load. Backup options do not count toward spending until promoted. The app supports up to 300 items per plan, 20 backups per item, and 100 groups per plan. Each purchase belongs to at most one group. Updates from another session refresh periodically when no form or save is active.

The downloadable packages contain no credentials or real shopping data. The version 1.1 migration retains the existing Supabase shopping records and plan access. Data from the older local/Cloudflare prototype is a separate store and is not automatically imported.
