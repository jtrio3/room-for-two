# Data model and budget calculations

All currency values are **integer US cents**. A missing price is `null`; a price of `0` is a valid free item. Database field names use snake_case; the API returns camelCase fields used by the application.

## Tables

| Table | Key and relationships | Main fields |
| --- | --- | --- |
| `plans` | UUID primary key; unique edit-key hash | Revision, personal contribution, family gift, move month, updated timestamp |
| `items` | Primary key `(plan_id, id)`; belongs to a plan | Name, room, immediate/later timing, internal priority, optional group, purchase URL, image URL, budgeted amount, high-end estimate, optional paid amount, notes |
| `backups` | Primary key `(plan_id, item_id, id)`; belongs to an item | Alternative name, purchase URL, image URL, budgeted amount, high-end estimate, notes, display position |
| `item_groups` | Primary key `(plan_id, id)`; belongs to a plan | Name, shared notes, creation timestamp |

The stored fields `regular` and `sale` retain their names for compatibility. In version 1.2, `regular` means **High-end estimate** and `sale` means **Budgeted amount**. These are the existing Current and Expected values with new labels; no values are changed. A budgeted amount may be above or below the high-end estimate, although the latter is intended to represent the larger possible cost.

`items.purchase_price` is a nullable integer returned as `purchasePrice`. Any non-null value, including `0`, means the item is purchased. `null` or an omitted legacy field means it is still to buy. There is no separate status flag that could disagree with the paid amount, and backups have no purchase record. New and migrated items start with `null`.

`items.group_id` is nullable. Its composite foreign key `(plan_id, group_id)` references `item_groups(plan_id, id)`, so a purchase cannot link to a group in another plan. Group names are trimmed, 1–60 characters, and unique within a plan regardless of capitalization. Group notes allow up to 1,000 characters. Empty groups are allowed.

Deleting an item deletes its backups and removes its paid amount from actual spending if it was purchased. The interface warns about that effect before deletion. Removing a group first clears its members' `group_id`, then deletes only the group in the same transaction. The group relationship does not cascade deletion to purchases. Deleting a plan removes its purchases, backups, and groups. IDs are scoped to their parent relationships so an ID in another plan cannot overwrite a record here.

Priority is an internal contiguous, unique sequence beginning at 1 within each plan. New items append to that sequence. Editing an existing item preserves its position; explicit reorder actions change the order. Insertion, deletion, and reordering normalize the sequence in one transaction. The interface does not ask the user to enter or maintain a priority number. Backup positions preserve their entered order.

Database and API validation enforce price bounds, names and note lengths, allowed room/timing values, valid month format, and safe HTTP(S) links. The application accepts up to 300 items, 20 backups per item, and 100 groups per plan.

## Budget formulas

Only main choices contribute to totals. The **effective budgeted amount** is an item's budgeted amount when supplied, otherwise its high-end estimate. A known zero budgeted amount takes precedence over a nonzero high-end estimate. Recording a purchase preserves these planning amounts.

| Metric | Formula |
| --- | --- |
| Total budget | Personal contribution + family gift |
| Budgeted total | Sum of known effective budgeted amounts across all items, purchased or not |
| High-end subtotal | Sum of known high-end estimates; secondary comparison only |
| Budget cushion | Sum of positive high-end minus budgeted differences where both amounts are known |
| Budgeted overage | Sum of positive budgeted minus high-end differences where both amounts are known |
| Remaining budget | Total budget minus budgeted total |
| Percentage allocated | Budgeted total ÷ total budget × 100; undefined when the budget is zero |
| Immediate-needs subtotal | Sum of effective budgeted amounts for items marked immediate |
| Room or group subtotal | Sum of effective budgeted amounts for the room's or group's members |
| Actual total spend | Sum of recorded `purchasePrice` values on purchased items |
| Purchased count | Number of items with a non-null `purchasePrice`, including free purchases |
| To-buy count | Total item count minus purchased count |
| Still-to-buy budget | Sum of known effective budgeted amounts for unpurchased items |
| Projected total spend | Actual total spend plus still-to-buy budget |

Unknown effective amounts are omitted from numeric sums and counted explicitly; these totals are incomplete. The app separately counts missing budgeted amounts, missing high-end estimates, and items using high-end estimates as a fallback. An unknown high-end estimate does not make the budgeted total incomplete when the budgeted amount is known. The projected total is incomplete if any unpurchased item lacks both planning amounts; a purchased item's paid amount is enough for its contribution to that projection.

A negative remaining balance shows the amount over budget. Allocation can exceed 100%; the visual progress bar caps at 100% while the percentage and over-budget amount stay accurate.

Cushion and overage use complete pairs, so they need not equal the difference between whole subtotals when an amount is missing. A $100 budgeted-only item contributes $100 to the planned total and no inferred cushion. A $150 high-end estimate with a $0 budgeted amount contributes $0 to the planned total and $150 to the cushion.

For example, a TV budgeted at $1,000 and bought for $900 still contributes $1,000 to the planned budget and $900 to actual spending. With an unpurchased $100 mount, the projected total is $1,000 ($900 paid + $100 still to buy). Undoing the TV purchase removes its $900 from actual spending and restores its $1,000 to the still-to-buy budget. The plan's budgeted total stays $1,100 throughout. Actual spend is kept visually separate from planned-budget metrics.

The model exports `budgeted`, `highEnd`, and `cushion`, plus purchase metrics. Legacy summary names such as `expected`, `current`, and `savings` remain aliases for compatibility. All calculations use cents; no payment amounts are inferred from backups or group totals.

## Groups and filtering

Groups are views over existing purchases, not additional budget entries. Linking, unlinking, renaming, or removing a group never changes planned or actual spending. Promoting a backup retains the item's group, timing, and order. Promotion is disabled on purchased items so a paid amount cannot silently attach to a different product; undo the purchase first.

Groups sort by their first member's internal priority. Empty groups follow populated groups alphabetically; Ungrouped appears last. Group members retain their global manual order. Dragging and keyboard reordering operate in Items view with both filters showing all items and Manual order selected. Group membership uses explicit selection controls.

Purchase status (all, to buy, purchased) and timing (all, immediate, can wait) are independent filters that combine. With filters active, a group's full subtotal remains distinct from the subtotal of visible matching items. Whole-plan metrics always cover the entire plan. Collapse state and preferred view are device preferences rather than shared records.

## API and PostgreSQL functions

| Request | Function | Behavior |
| --- | --- | --- |
| `GET /api/plan` | `planner_read` | Read the plan matching the supplied edit-key hash, including groups and membership |
| `POST /api/plan` | `planner_create` | Idempotently create that plan with the $12,000 default budget |
| `PATCH /api/plan`, action `save` | `planner_mutate` | Create or replace item details and backups; optional inline group creation; append new items, retain existing order and purchase record |
| `PATCH /api/plan`, action `purchase` | `planner_mutate` | Record or edit a main item's paid amount; `null` undoes the purchase |
| `PATCH /api/plan`, action `delete` | `planner_mutate` | Delete an item and its backups; normalize priority |
| `PATCH /api/plan`, action `reorder` | `planner_mutate` | Require an exact permutation of all item IDs, then apply it |
| `PATCH /api/plan`, action `settings` | `planner_mutate` | Update contributions and move month |
| `PATCH /api/plan`, action `saveGroup` | `planner_mutate` | Save group details and selected member IDs without replacing purchase details |
| `PATCH /api/plan`, action `removeGroup` | `planner_mutate` | Unlink its purchases and remove the group, preserving those purchases |

Every request requires `Authorization: Bearer <plan edit key>`. The server hashes the key before contacting Supabase. PATCH requests include the last known revision; the database locks the plan, compares revisions, applies the whole mutation, and advances the revision once. A stale request returns HTTP 409 with the latest plan. Invalid changes preserve the previously saved state.

`saveGroup` accepts `{group: {id, name, notes}, itemIds}`. Each member must belong to this plan, and member IDs must be unique. Items selected from another group move without duplication. Item `save` accepts optional `newGroup`; when present, its ID must match `item.groupId` and the group and item are created atomically.

`purchase` accepts `{id, price}` in addition to the action and revision. `price` must be an integer from 0 to 100,000,000 cents, or explicit `null` to undo. An absent amount is invalid. Only this mutation changes a purchase record: normal item saves preserve the database's paid amount, even when an older client omits `purchasePrice` or a form includes a stale copy. The purchase dialog asks for an amount before saving and allows editing or undoing an existing record. Revision conflicts require review before a retry.

For older clients, an omitted `item.groupId` preserves existing membership. Explicit `null` unlinks the purchase. Current clients tolerate an absent `groups` field during rollout. The group editor compares the editing baseline, the user's draft, and the latest membership: partner additions, removals, moves, and deletions are shown. A reviewed retry starts from current membership and reapplies only the user's deliberate selection changes, rather than resubmitting an obsolete full snapshot.

The SQL functions run as the invoking role with a fixed search path. RLS and grants block `anon` and `authenticated` access; only the app server's privileged role may execute the functions. The raw edit key is not returned by the database or included in saved plan content.

The complete schema is in [supabase/setup.sql](supabase/setup.sql). Existing installations should follow [UPDATE-LIVE-SITE.md](UPDATE-LIVE-SITE.md) and run [the version 1.2 migration](supabase/migrations/20261006_purchase_tracking.sql) before updating the app. If version 1.1 was skipped, run [the grouping migration](supabase/migrations/20261005_groups_expected_price.sql) first. These additive migrations preserve saved records and plan keys; a label change does not rewrite stored planning amounts.
