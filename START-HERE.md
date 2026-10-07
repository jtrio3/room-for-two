# Get Room for Two online

This folder contains the complete **Room for Two v1.2** app: **Next.js + Supabase + Netlify**, including groups, budget planning, and purchase tracking. There is no Cloudflare account or Sites setup involved.

**Already using the live app?** Follow [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md) instead. Keep your existing project, repository, and full shared plan URL.

## 1. Create a Supabase project

Open https://supabase.com/dashboard and create a project. Save its database password.

Open **SQL Editor → New query**, copy the entire contents of `supabase/setup.sql`, and run it. This creates the four tables and the saving functions. It is safe to run the same setup file again; it preserves existing records. Use a fresh project or a project without unrelated tables named `plans`, `items`, `backups`, or `item_groups`.

No Supabase Auth configuration is required. Do not add public read/write policies to the tables: the app's server checks the shared edit link on every request.

## 2. Copy two values from Supabase

- **SUPABASE_URL** — the project URL from the **Connect** dialog, such as `https://your-project.supabase.co`.
- **SUPABASE_SECRET_KEY** — a secret key from **Settings → API Keys**. A legacy `service_role` key also works under this same variable name.

Use a secret/service-role key, not a publishable/anon key. Keep it out of GitHub, chat messages, and browser code. You will enter it directly into Netlify in step 4.

Official guidance: https://supabase.com/docs/guides/getting-started/api-keys

## 3. Upload the source to GitHub

1. Unzip `room-for-two-full-source-v1.2.zip`. The smaller update ZIP is for an existing installation.
2. Create an empty GitHub repository, for example `room-for-two`. A private repository is fine.
3. Upload the **contents** of the extracted `room-for-two-supabase` folder, rather than the ZIP itself. `package.json`, `netlify.toml`, `app`, and `supabase` should appear at the repository's top level.
4. Include `package-lock.json`. Do not upload `node_modules`, `.next`, or a real `.env.local` file.

You can drag folders from Finder directly onto GitHub's upload area; cancel the file picker if it only accepts individual files. If a full-source upload exceeds GitHub's file limit, upload the top-level folders in separate batches to preserve their paths, or use GitHub Desktop to commit the complete folder.

If Finder hides dotfiles during upload, press **Command + Shift + Period** to show them. `.gitignore` and `.nvmrc` should be included; `.env.example` is safe because it contains only placeholders. The package contains no real credentials or shopping data.

## 4. Create the Netlify project

In https://app.netlify.com/, choose **Add new project → Import an existing project**, connect GitHub, and select your repository.

The included `netlify.toml` supplies these settings:

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Base directory | Blank when `package.json` is at the repository root |
| Build command | `npm run build` |
| Publish directory | `.next` |
| Node version | 22 |

If you uploaded the enclosing folder, set the base directory to `room-for-two-supabase` instead. Do not use Netlify Drop: the app needs its server/API, not just a static folder.

Under the project's **Environment variables**, add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` with your actual values. Mark the key as secret. Include **Functions** and **Builds** scopes if scope selection is available. Neither variable uses the `NEXT_PUBLIC_` prefix.

Deploy. Netlify automatically supplies its Next.js adapter; there is no plugin to configure manually. Redeploy whenever you change an environment variable.

Official guidance: https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
Environment variables: https://docs.netlify.com/build/environment-variables/overview/

## 5. Allow access without a login

After the production deployment succeeds, open **Project configuration → General → Visitor access → Project visibility** and set production to **Public**, if it is currently private. You can also use **Make public**. Previews may remain private.

This makes the app accessible without a Netlify account. The random plan edit key still protects access to each shopping list. Anyone with a complete shared edit link can view and edit that plan.

Official guidance: https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/

## 6. Open and share your plan

1. Open the live Netlify URL. The app creates an empty plan with a $12,000 budget.
2. Add an item with a **Budgeted amount** and optional **High-end estimate**, then refresh to confirm it saved. Mark it purchased only when you have bought it, and record the amount paid. Actual spending appears separately from the planned budget.
3. Click **Share plan → Copy shared link**. Send that full link to your partner.
4. Open it on another device or in a private browser window. Confirm the same list appears without login.
5. Bookmark the full link, including `#plan=...`. Opening only the bare site URL on a new browser creates a different plan.

Data from the earlier localhost prototype is not included or automatically imported. Those items require a separate data migration. If your shopping list is already in Supabase, use the existing-installation update guide instead of creating a new plan.

## If something goes wrong

| Message / symptom | Fix |
| --- | --- |
| Supabase is not connected yet | Add the two environment variables to Netlify, ensure Functions scope, then redeploy. |
| The database setup is missing | Run the complete `supabase/setup.sql` in the correct Supabase project. |
| Server cannot access Supabase | Use the secret/service-role key, check the project URL, and rerun the setup file to apply its grants. |
| Netlify asks your partner to log in | Set production project visibility to Public. |
| Your partner sees an empty list | Share the full edit link from the app, not just the website address. |
| A previous localhost link says plan not found | The new Supabase database has not imported that local plan. Use the new live site's link. |
| Build cannot find package.json | Upload the folder contents at the repository root or set the correct base directory. |

## Optional: run it on your computer

Use Node.js 22.13 or newer (Node 22 is selected by `.nvmrc` and Netlify).

1. Copy `.env.example` to `.env.local` and enter the two Supabase values.
2. Run `npm ci`.
3. Run `npm run dev` and open the printed address.
4. Use `npm run build` to check the production build.

The app can build before the credentials are added; saving requires a configured Supabase project and the SQL setup.
