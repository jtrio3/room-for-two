# Data model and budget calculations

All currency values are **integer US cents**. A missing price is `null`; a price of `0` is a valid free item. Database field names use snake_case; the API returns camelCase fields used by the application.

## Tables

| Table | Key and relationships | Main fields |
| --- | --- | --- |
| `plans` | UUID primary key; unique edit-key hash | Revision, personal contribution, family gift, move month, updated timestamp |
| `items` | Primary key `(plan_id, id)`; belongs to a plan | Name, room, immediate/later timing, internal priority, optional group, purchase URL, image URL, current price, expected price, notes |
| `backups` | Primary key `(plan_id, item_id, id)`; belongs to an item | Alternative name, purchase URL, image URL, current price, expected price, notes, display position |
| `item_groups` | Primary key `(plan_id, id)`; belongs to a plan | Name, shared notes, creation timestamp |

The stored fields `regular` and `sale` retain their names for compatibility. In the version 1.1 interface, `regular` means **Current price** and `sale` means **Expected price**. Existing values are preserved. Expected price may be above or below current price.

`items.group_id` is nullable. Its composite foreign key `(plan_id, group_id)` references `item_groups(plan_id, id)`, so a purchase cannot link to a group in another plan. Group names are trimmed, 1–60 characters, and unique within a plan regardless of capitalization. Group notes allow up to 1,000 characters. Empty groups are allowed.

Deleting an item deletes its backups. Removing a group first clears its members' `group_id`, then deletes only the group in the same transaction. The group relationship does not cascade deletion to purchases. Deleting a plan removes its purchases, backups, and groups. IDs are scoped to their parent relationships so an ID in another plan cannot overwrite a record here.

Priority is an internal contiguous, unique sequence beginning at 1 within each plan. New items append to that sequence. Editing an existing item preserves its position; explicit reorder actions change the order. Insertion, deletion, and reordering normalize the sequence in one transaction. The interface does not ask the user to enter or maintain a priority number. Backup positions preserve their entered order.

Database and API validation enforce price bounds, names and note lengths, allowed room/timing values, valid month format, and safe HTTP(S) links. The application accepts up to 300 items, 20 backups per item, and 100 groups per plan.

## Budget formulas

Only main choices contribute to totals. The **effective expected price** is an item's expected price when supplied, otherwise its current price. A known zero expected price takes precedence over a nonzero current price.

| Metric | Formula |
| --- | --- |
| Total budget | Personal contribution + family gift |
| Expected spend | Sum of known effective expected prices |
| Current-price subtotal | Sum of known current prices; secondary comparison only |
| Potential savings | Sum of positive current minus expected differences where both prices are known |
| Expected overage | Sum of positive expected minus current differences where both prices are known |
| Remaining budget | Total budget minus expected spend |
| Percentage allocated | Expected spend ÷ total budget × 100; undefined when the budget is zero |
| Immediate-needs subtotal | Sum of effective expected prices for items marked immediate |
| Room or group subtotal | Sum of effective expected prices for the room's or group's members |

Unknown effective prices are omitted from numeric sums and counted explicitly; these totals are incomplete. The app separately counts missing expected prices, missing current prices, and purchases that use current price as the fallback. An unknown current price does not make expected spend incomplete when the expected price is known.

A negative remaining balance shows the amount over budget. Allocation can exceed 100%; the visual progress bar caps at 100% while the percentage and over-budget amount stay accurate.

Savings and overage use complete price pairs. They need not equal the difference between the whole current and expected subtotals when either price is missing. A $100 expected-only purchase contributes $100 to expected spend and no inferred savings. A $150 current price with a $0 expected price contributes $0 to spend and $150 to savings. A $150 current price with a $175 expected price contributes $175 to spend and $25 to expected overage.

## Groups and filtering

Groups are views over existing purchases, not additional budget entries. Linking, unlinking, renaming, or removing a group never changes spending. Promoting a backup retains the purchase's group, timing, and order.

Groups sort by their first member's internal priority. Empty groups follow populated groups alphabetically; Ungrouped appears last. Group members retain their global manual order. Dragging and keyboard reordering operate in Items view with All items and Manual order selected. Group membership uses explicit selection controls.

With a timing filter, a group's full subtotal remains distinct from the subtotal of visible matching items. Whole-plan metrics always cover the entire plan. Collapse state and preferred view are device preferences rather than shared records.

## API and PostgreSQL functions

| Request | Function | Behavior |
| --- | --- | --- |
| `GET /api/plan` | `planner_read` | Read the plan matching the supplied edit-key hash, including groups and membership |
| `POST /api/plan` | `planner_create` | Idempotently create that plan with the $12,000 default budget |
| `PATCH /api/plan`, action `save` | `planner_mutate` | Create or replace an item and its backups; optional inline group creation; append new items, retain existing order |
| `PATCH /api/plan`, action `delete` | `planner_mutate` | Delete an item and its backups; normalize priority |
| `PATCH /api/plan`, action `reorder` | `planner_mutate` | Require an exact permutation of all item IDs, then apply it |
| `PATCH /api/plan`, action `settings` | `planner_mutate` | Update contributions and move month |
| `PATCH /api/plan`, action `saveGroup` | `planner_mutate` | Save group details and selected member IDs without replacing purchase details |
| `PATCH /api/plan`, action `removeGroup` | `planner_mutate` | Unlink its purchases and remove the group, preserving those purchases |

Every request requires `Authorization: Bearer <plan edit key>`. The server hashes the key before contacting Supabase. PATCH requests include the last known revision; the database locks the plan, compares revisions, applies the whole mutation, and advances the revision once. A stale request returns HTTP 409 with the latest plan. Invalid changes preserve the previously saved state.

`saveGroup` accepts `{group: {id, name, notes}, itemIds}`. Each member must belong to this plan, and member IDs must be unique. Items selected from another group move without duplication. Item `save` accepts optional `newGroup`; when present, its ID must match `item.groupId` and the group and item are created atomically.

For older clients, an omitted `item.groupId` preserves existing membership. Explicit `null` unlinks the purchase. Current clients tolerate an absent `groups` field during rollout. The group editor compares the editing baseline, the user's draft, and the latest membership: partner additions, removals, moves, and deletions are shown. A reviewed retry starts from current membership and reapplies only the user's deliberate selection changes, rather than resubmitting an obsolete full snapshot.

The SQL functions run as the invoking role with a fixed search path. RLS and grants block `anon` and `authenticated` access; only the app server's privileged role may execute the functions. The raw edit key is not returned by the database or included in saved plan content.

The complete schema is in [supabase/setup.sql](supabase/setup.sql). Existing installations should follow [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md) and run [the version 1.1 migration](supabase/migrations/20261005_groups_expected_price.sql) before updating the app. The migration adds grouping and removes the old price ceiling without deleting saved records or changing plan keys.
