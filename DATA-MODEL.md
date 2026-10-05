# Data model and budget calculations

All currency values are **integer US cents**. A missing price is `null`; a price of `0` is a valid free item. Database field names use snake_case; the API returns camelCase fields used by the application.

## Tables

| Table | Key and relationships | Main fields |
| --- | --- | --- |
| `plans` | UUID primary key; unique edit-key hash | Revision, personal contribution, family gift, move month, updated timestamp |
| `items` | Primary key `(plan_id, id)`; belongs to a plan | Name, room, immediate/later timing, priority, purchase URL, image URL, regular price, sale price, notes |
| `backups` | Primary key `(plan_id, item_id, id)`; belongs to an item | Alternative name, purchase URL, image URL, regular price, sale price, notes, display position |

Deleting an item deletes its backups. Deleting a plan deletes its items and backups. Item and backup IDs are scoped to their parent relationships so IDs in another plan cannot collide with or overwrite them.

Priority is a contiguous, unique sequence beginning at 1 within each plan. Reordering, insertion, and deletion update the sequence inside the same transaction. Backup positions preserve the entered order.

Database and API validation enforce price bounds, names and note lengths, allowed room/timing values, valid month format, safe HTTP(S) links, and sale prices no greater than known regular prices. The application accepts up to 300 items and 20 backups per item.

## Budget formulas

Only main choices contribute to totals. Let the effective price of an item be its sale/target price when supplied, otherwise its regular price.

| Metric | Formula |
| --- | --- |
| Total budget | Personal contribution + family gift |
| Planned spend | Sum of known regular prices |
| Sale-price spend | Sum of known effective prices |
| Potential savings | Sum of regular minus sale price where both are known |
| Remaining budget | Total budget minus sale-price spend |
| Percentage allocated | Sale-price spend ÷ total budget × 100; undefined when the budget is zero |
| Immediate-needs subtotal | Sum of effective prices for items marked immediate |
| Room subtotal | Sum of effective prices for items assigned to that room |

Unknown prices are omitted from numeric sums and counted explicitly in the interface, with a warning when spending totals are incomplete. A negative remaining balance shows the amount over budget. Allocation can exceed 100%; the visual progress bar caps at 100% while the percentage and over-budget amount stay accurate.

Savings use only complete price pairs, so they need not equal planned spend minus sale-price spend when regular prices are missing. For example, a $100 sale-only item contributes $100 to sale-price spend and no inferred savings. A $150 item with a $0 sale price contributes $0 to spend and $150 to savings.

## API and PostgreSQL functions

| Request | Function | Behavior |
| --- | --- | --- |
| `GET /api/plan` | `planner_read` | Read the plan matching the supplied edit-key hash |
| `POST /api/plan` | `planner_create` | Idempotently create that plan with the $12,000 default budget |
| `PATCH /api/plan`, action `save` | `planner_mutate` | Create or replace an item and its backups; normalize priority |
| `PATCH /api/plan`, action `delete` | `planner_mutate` | Delete an item and its backups; normalize priority |
| `PATCH /api/plan`, action `reorder` | `planner_mutate` | Require an exact permutation of all item IDs, then apply it |
| `PATCH /api/plan`, action `settings` | `planner_mutate` | Update contributions and move month |

Every request requires `Authorization: Bearer <plan edit key>`. The server hashes the key before contacting Supabase. PATCH requests include the last known revision; the database locks the plan, compares revisions, applies the whole mutation, and advances the revision once. A stale request returns HTTP 409 with the latest plan. Invalid changes preserve the previously saved state.

The SQL functions run as the invoking role with a fixed search path. RLS and grants block `anon` and `authenticated` access; only the app server's privileged role may execute the functions. The raw edit key is not returned by the database or included in saved plan content.

The complete executable schema is in [supabase/setup.sql](supabase/setup.sql).
