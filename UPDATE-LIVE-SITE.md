# Update your live Room for Two app to version 1.2

Keep your **existing Supabase project, GitHub repository, Netlify site, and full `#plan=...` link**.

Version 1.2 renames Expected price to **Budgeted amount** and Current price to **High-end estimate**, adds purchase tracking and actual spending, and improves mobile tag spacing. Existing planning amounts keep their values.

Use **`room-for-two-update-v1.2.zip`** for an existing installation. It contains changed and new files only; keep the other files in your repository. **`room-for-two-full-source-v1.2.zip`** contains the complete source for a fresh checkout.

## 1. Run the database update first

1. Unzip the update package.
2. Open [Supabase](https://supabase.com/dashboard), select the project your live app already uses, then open **SQL Editor → New query**.
3. If you **skipped version 1.1** and do not have Groups yet, run the entire `supabase/migrations/20261005_groups_expected_price.sql` file first. It is included in this package. If Groups already works, skip this step.
4. Open `supabase/migrations/20261006_purchase_tracking.sql` from the extracted package in a text editor. Copy the **entire file** into a new SQL query and click **Run**.
5. Wait for success before uploading the app changes. A successful query may say no rows were returned.

The order matters: the grouping migration, if needed, comes **before** the purchase-tracking migration. After version 1.2 is installed, do not rerun the older grouping migration; it contains older saving functions. The version 1.2 migration itself is safe to rerun.

This adds a separate paid-amount field and updates the saving functions. It preserves existing plans, items, groups, backups, prices, ordering, and shared-link access. Existing items initially remain **To buy** until you mark them purchased. It does not guess purchase status or replace your budgeted amounts.

Use these migrations for an existing installation. `supabase/setup.sql` is the complete schema for a new installation. Keep your existing database and project.

## 2. Upload the files into your existing GitHub repository

1. Open your repository on GitHub and choose the branch connected to Netlify production, usually **main**.
2. Open the top level where `package.json` and `netlify.toml` already appear, then choose **Add file → Upload files**.
3. In Finder, open the extracted update folder until you see `package.json` and folders such as `app`, `components`, `lib`, and `supabase`.
4. Select the folder's **contents** and drag them onto GitHub's upload area. If the file picker only lets you select files, cancel it and drag directly from Finder. This preserves folders and their contents.
5. Wait for upload to finish, enter a commit message such as **“Add purchase tracking and budgeted amounts”**, and commit to the production branch. If your repository requires a pull request, merge it into that branch.

Upload the contents, not the ZIP or its enclosing folder. Matching paths replace previous files; new paths are added. Leave the rest of the repository in place. If your app already lives in a Netlify base-directory subfolder, upload inside that same subfolder.

Keep your existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in Netlify. No new environment variables are required. Never upload a real `.env` or `.env.local` file; these packages contain no credentials.

## 3. Wait for Netlify to publish

1. Open the existing project in [Netlify](https://app.netlify.com/) and choose **Deploys**.
2. Find the deployment triggered by your new GitHub commit and wait for it to publish successfully.
3. If none starts, check that you committed to the connected production branch. Resume paused builds or use **Trigger deploy → Deploy site** for that project if needed.

A connected production branch normally deploys automatically; see [Netlify's deployment instructions](https://docs.netlify.com/deploy/create-deploys/). Your build settings, environment variables, site address, and domain stay the same. Downloading or uploading SQL files to GitHub does not apply the database update: the Supabase query and the Netlify deployment are separate steps.

## 4. Reopen your plan and check the update

Close old app tabs on both devices, then reopen your bookmarked **full URL with `#plan=...`**. Reload if the old interface appears; **Command + Shift + R** forces a fresh load on your Mac.

1. Confirm your items, groups, backups, ordering, and existing amounts are present. Expected values should now be labeled **Budgeted amount** and Current values **High-end estimate**.
2. Mark an item you have bought as **Purchased**, enter what you paid, and save. The item should gain a purchased appearance and the separate actual-spending summary should increase by exactly that amount. A $0 purchase also counts as purchased.
3. Use the purchased/to-buy filter. Timing filters still work independently, so you can see immediate items that remain to buy.
4. Edit a purchase amount to correct it, or undo the purchase to return the item to To buy. Actual spending should adjust; its budgeted amount should stay unchanged.
5. On your phone, check that timing and group tags have space between them and long group names stay contained within the card.
6. Open the same full link on the second device and confirm the saved changes appear.

**How the totals work:** Budgeted total, remaining budget, and allocation still describe the plan for all items. Actual total spend counts only logged purchases. Projected total combines actual spend with budgeted amounts for items still to buy. A missing budgeted amount uses its high-end estimate; items missing both are identified as incomplete.

Backups do not count toward totals. Undo an item's purchase before promoting a backup, so the logged payment stays attached to the correct product. Deleting a purchased item also removes its paid amount from actual spending; the delete confirmation warns about this. Removing a group keeps its items and their purchase records.

## If something goes wrong

| Symptom | What to do |
| --- | --- |
| Items load but recording purchases fails | Run the complete version 1.2 migration in the same Supabase project used by Netlify. GitHub uploads do not run SQL. |
| The migration says a groups table or column is missing | If version 1.1 was skipped, run its grouping migration, then run the version 1.2 purchase migration. |
| Purchases stopped saving after an older SQL file was rerun | Run `20261006_purchase_tracking.sql` again to restore the latest functions. |
| The old interface is still showing | Check that the published Netlify deployment uses your new commit, then refresh. |
| Netlify does not start a deployment | Check the connected repository and production branch, and whether builds are paused. Trigger a deploy if needed. |
| Build cannot find files or imports | Check that the update replaced the original paths, rather than sitting inside an extra folder. Confirm the new component files uploaded. |
| Your old list appears empty | Reopen the original complete `#plan=...` link. Keep the same Supabase project and environment variables. A bare URL in a new browser can create another plan. |
| A purchase or item changed while you were editing | Review the latest record in the conflict dialog before retrying. Your draft remains available. |

To temporarily restore the previous interface, republish its successful Netlify deployment. Leave the additive database update in place. Version 1.1 will not show or manage purchase records, so use version 1.2 for recording or correcting actual spending. Ordinary item saves from the earlier interface preserve the purchase record while the version 1.2 database functions remain installed.

This package is prepared for you to install. It does not itself deploy the site or change your live Supabase project.
