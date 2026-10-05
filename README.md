# Room for Two

A responsive shopping planner for two people preparing for a November move. Starts with a **$12,000 budget**: $10,000 personal funds and a $2,000 family gift. Both amounts and the move month are editable.

**To get online, follow [START-HERE.md](START-HERE.md).** This is a complete Next.js app for Netlify, with Supabase PostgreSQL storage. Upload this folder's contents to the root of your GitHub repository.

## Features

- Add, edit, delete, sort, and drag-reorder items; keyboard arrow keys on the drag handle also change priority.
- Immediate needs and purchases that can wait, organized by room.
- Purchase links, image links, regular and sale/target prices, and notes.
- Multiple backup choices per item; promote a backup to the main choice while retaining the former choice.
- Live budget totals, savings, remaining funds, allocation percentage, immediate-needs subtotal, and room breakdowns.
- Shared edit links without accounts or sign-in.
- Cloud saves, periodic refresh, and explicit conflict handling when two people edit at once.
- Responsive phone and desktop layouts, accessible dialogs, and missing-price indicators.

## How it works

The browser calls the same-origin `/api/plan` route. That route validates the edit key and request body, then calls transactional PostgreSQL functions through the Supabase SDK. Netlify runs the Next.js server; Supabase stores the records.

Each plan uses a random 256-bit edit key in the `#plan=...` URL fragment. The browser remembers it locally and sends it to the API in the Authorization header. Only its SHA-256 hash is stored in the database. Anyone with the complete link can view and edit that plan. There is no email invitation, password, or account recovery flow; bookmark the full link.

Supabase credentials stay on the server. Row-level security is enabled, and public/browser roles cannot access the tables or saving functions. The server's secret key uses the privileged `service_role`. The setup script grants this role the necessary permissions. Do not expose this key with a `NEXT_PUBLIC_` variable.

Each mutation locks its plan and checks the expected revision. A stale edit receives the current plan instead of silently overwriting another person's work. Item and backup changes, priority normalization, and the revision increment commit together. Client requests are bound to the current plan link, time out, and cannot apply an older revision over a newer one.

See [DATA-MODEL.md](DATA-MODEL.md) and [supabase/setup.sql](supabase/setup.sql) for the schema and calculations.

## Local setup

Use Node.js 22.13 or newer; `.nvmrc` and Netlify select Node 22.

1. Run `supabase/setup.sql` in your Supabase project's SQL Editor.
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
| `npm test` | Budget, validation, client-session, and PostgreSQL tests |
| `npm run test:integration` | Test the built Next.js app and Supabase SDK against isolated PostgreSQL; run the build first |

Tests use an in-memory PGlite PostgreSQL instance and synthetic data. They do not access your live Supabase project. The integration test starts a local HTTP bridge to exercise the actual Supabase SDK and database functions through the production API.

## Project files

| Location | Purpose |
| --- | --- |
| `app/page.tsx`, `app/globals.css` | Planner interface and responsive styling |
| `app/api/plan/route.ts` | Validated server API |
| `lib/planner.ts` | Data types, validation, and budget calculations |
| `lib/client.ts` | Request sessions and shared-link handling |
| `lib/server/supabase.ts` | Server-only database connection |
| `supabase/setup.sql` | Tables, access controls, and transactional functions |
| `netlify.toml` | Hosting build settings |
| `START-HERE.md` | Supabase, GitHub, and Netlify instructions |

## Current scope

Prices are entered manually; totals exclude tax and delivery. Images are supplied by URL, with category icons if an image cannot load. Backup options do not count toward spending until promoted. The app supports up to 300 items per plan and 20 backups per item. Updates from another session refresh periodically when no form or save is active.

The package contains no credentials or real shopping data. Existing data from the original local/Cloudflare app is not automatically imported. Hosted Netlify and Supabase setup must be completed using your accounts, then checked using the two-device steps in START-HERE.
