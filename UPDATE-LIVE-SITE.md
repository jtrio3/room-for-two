# Update your live Room for Two app to version 1.1

Use your **existing Supabase project, GitHub repository, and Netlify site**. Your current shopping plan remains at the same complete URL, including `#plan=...`.

This update adds linked item groups, makes Expected price the main budget figure, hides priority numbers while retaining manual ordering, and fixes the item form's Save controls overlapping fields on smaller screens.

The supplied `room-for-two-update-v1.1.zip` is a **small update package containing changed and new files only**. Keep the other files already in your repository. The full source ZIP is available separately for a fresh checkout; you do not need to upload it to update your live site.

## 1. Update the existing Supabase database first

1. Unzip `room-for-two-update-v1.1.zip` on your Mac.
2. Open [Supabase](https://supabase.com/dashboard) and select the same project your live app already uses.
3. Open **SQL Editor → New query**.
4. In the extracted files, open `supabase/migrations/20261005_groups_expected_price.sql` in a text editor.
5. Copy the **entire file**, paste it into the SQL Editor, and click **Run**.
6. Wait for the query to succeed before uploading the app changes below. A successful query may say no rows were returned.

This migration adds the groups table, adds optional membership to purchases, updates saving functions, and permits expected prices above current prices. It does not delete tables, plans, purchases, prices, backups, or order, and it does not change your plan access keys. Existing purchases begin ungrouped. It is safe to rerun the migration.

Use this migration for the existing installation; `supabase/setup.sql` is the complete schema for a fresh installation. Do not create a new Supabase project or reset the database for this update.

## 2. Upload the update files into the existing GitHub repository

1. Open your existing repository on GitHub.
2. Select the branch connected to your Netlify production site, usually **main**. Open the repository's top level, where `package.json` and `netlify.toml` already appear.
3. Choose **Add file → Upload files**.
4. In Finder, open the extracted update folder until you see files such as `package.json` and folders such as `app`, `lib`, and `supabase`.
5. Select the **contents of that folder**, then drag them onto GitHub's upload area. Cancel the file-picker window first if it prevents you from selecting folders. Dragging preserves each folder's structure.
6. Wait for the uploads to finish. Add the commit message **“Add groups and expected prices”**, then commit to the production branch. If your repository requires a pull request, merge it into that branch instead.

Upload the extracted contents, not the ZIP and not an enclosing update folder. Files with the same paths replace their previous versions; new files are added. Leave other repository files in place. If your original project lives in a subfolder configured as Netlify's base directory, upload the contents inside that same subfolder.

**Never upload a real `.env` or `.env.local` file.** This package includes no credentials. Your existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY` stay in Netlify, unchanged. `.env.example`, when present in the full source package, contains placeholders only.

## 3. Let Netlify publish the change

1. Open your existing project in [Netlify](https://app.netlify.com/).
2. Open **Deploys** and find the deployment triggered by your new GitHub commit.
3. Wait until that production deployment is successfully published.
4. If no deployment starts, confirm you committed to the connected production branch. If automatic publishing or builds are paused, resume them or use **Trigger deploy → Deploy site** for that existing project.

A connected Git repository normally triggers a deployment when its production branch changes; see [Netlify's deployment instructions](https://docs.netlify.com/deploy/create-deploys/). Keep the existing build command, environment variables, site address, and domain settings.

These files do not update the live site merely by being downloaded. The Supabase query and successful Netlify deployment are the two required steps.

## 4. Reopen the same plan and check the update

Close older app tabs on both devices, then reopen your bookmarked **full shared URL, including `#plan=...`**. If a device still shows the old interface, reload it; on your Mac, **Command + Shift + R** forces a fresh page load.

Check the following:

1. Your existing purchases, prices, backups, and ordering are still present.
2. The dashboard uses **Expected spend**. Existing sale/target values now appear as **Expected price**, and existing regular values appear as **Current price**. If expected price is blank, the app identifies its use of current price as a fallback.
3. Create a group such as **TV setup**, select the TV, mount, and speakers, and save. Switch to Groups view to see their combined expected subtotal. The whole-plan total should not change just from linking them.
4. Add or edit an item on your phone. Scroll through the form and confirm the Save controls remain separate from the fields.
5. Create a purchase and confirm it joins the end of the list. Use Items view, All items, and Manual order to move it with the drag handle. Keyboard users can focus the handle and press the up/down arrow keys.
6. Refresh or reopen the same full link on the second device and confirm the saved changes appear.

Group removal keeps the individual purchases. A purchase belongs to one optional group, and it counts toward the budget once. Backup choices remain excluded until promoted.

## If something goes wrong

| Symptom | What to do |
| --- | --- |
| The site works but groups will not save | Confirm the complete migration ran successfully in the same Supabase project used by Netlify. Updating GitHub does not run SQL automatically. |
| Expected price above current price is rejected | Run the migration if it was missed, then close old app tabs and reload the newly deployed app. |
| The old design is still showing | Check that the successful Netlify deployment uses your new commit, then refresh the page. |
| Netlify does not start a deployment | Check the connected repository and production branch, and whether builds are paused. Trigger a deploy if needed. |
| Build cannot find files or imports | The update may have been uploaded inside an extra folder. Its `package.json` and `app` folder must replace the original paths. Also confirm all new folders uploaded. |
| Your old list appears empty | Reopen the original full URL with `#plan=...`. Keep the same Supabase project and existing environment variables. A bare site address in a new browser can create a different plan. |
| A group changed while you were editing | Review the latest membership using the conflict options before saving. Your draft stays available. |

If you need to restore the earlier interface temporarily, republish the previous successful Netlify deployment. Leave the additive Supabase migration in place; do not drop the new tables or column. The older interface will not display groups and retains its old expected-versus-current price ceiling, so it may refuse to edit an item whose expected price is higher than its current price. Return to version 1.1 to edit such items normally.

The package is prepared for you to install; it has not performed a deployment or changed your live Supabase project.
