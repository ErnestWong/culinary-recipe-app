# Culinary Recipe App — Product Spec

> This is the canonical product direction. The app is being rebuilt brand-new
> around this spec. Keep: localhost dev experience + a chat-style interface.
> Everything else (schema, data model, features) is replaced.

## What we are building

A recipe + prep management app for **restaurants** and **private chefs**. A chef
feeds in a recipe; the app lets them edit it, scales it to a target number of
portions/plates (showing the quantity of each raw ingredient), and helps build
prep lists per service. It is **offline-first** — kitchens have unreliable wifi.

## Core idea

- User feeds a recipe into the app. The app lets the user **modify the recipe
  before confirming**. It shows the **quantity of plates for the portions** —
  i.e. the amount of each raw ingredient for a given number of covers.
- **Prep steps**:
  - Either entered by the user, OR the AI reads the recipe and **generates
    suggested prep steps** (this is where the AI engine is used).
- **Covers per evening**: for each evening the user inputs the number of covers
  (how many portions to make available).
  - Ex: Monday 20 covers, Tuesday 23 covers.

## Input methods (recipe capture)

- **V0**: user takes a **photo** of a recipe (OCR / vision parse).
- **V1**: user **speaks** recipe details and the app parses them.
- **V2**: user **types** it in.
- The user **always** has the final option to edit the recipe / prep-list inputs
  before confirming.

## Offline / wifi handling

- Devices store a **local DB** (IndexedDB in the browser, SQLite in a native app).
- All writes are **queued** with a **timestamp** and **device ID**.
- Queued writes are **pushed whenever wifi is available**.
- **Conflict resolution**: define explicit merge rules (what wins / what merges).
- UI must show **syncing status**.

## Permissions / roles

User roles: `admin` / `owner`, `chef`, `sous_chef`, `line_cook`, `manager`,
`employee`, `read-only` (stage/viewer), `solo` (private chef working alone).

## Test cases for scaling math

- Scaling a recipe to N covers must be covered by **tests** that assert the
  scaled raw-ingredient quantities are correct (unit conversions included).

---

## Data schema

Multi-tenant, relational (Postgres-flavored). `->` denotes a foreign key.

### Tenancy

```
organizations ( id, name, created_at )

workspaces (
  id, organization_id -> organizations,
  name, type,              -- 'restaurant' | 'private_chef'
  timezone, created_at
)

users ( id, name, email, created_at )

workspace_users (
  id, workspace_id -> workspaces, user_id -> users,
  role   -- 'owner' | 'chef' | 'sous_chef' | 'line_cook' | 'manager' | 'solo'
)

clients (
  id, workspace_id -> workspaces,
  name, dietary_notes, contact_info,
  created_at
)
```

### Ingredients

```
ingredients (
  id, workspace_id -> workspaces,
  name, base_unit, density_g_per_ml, cost_per_base_unit,
  created_at
)
```

### Recipes (optionally scoped to a client)

```
recipes (
  id, workspace_id -> workspaces,
  client_id -> clients,      -- nullable; set when a private chef builds a recipe
                             -- for a specific client; null for restaurant dishes
                             -- or a chef's general/personal recipes
  name, type,                -- 'dish' | 'component'
  current_version_id -> recipe_versions,
  created_at
)

recipe_versions (
  id, recipe_id -> recipes,
  version_number,
  yield_quantity, yield_unit,
  instructions,
  created_by -> users,
  created_at,
  is_published
)

recipe_ingredient_lines (
  id, recipe_version_id -> recipe_versions,
  line_order,
  ingredient_id -> ingredients,
  sub_recipe_id -> recipes,
  sub_recipe_version_id -> recipe_versions,
  quantity, unit, notes
)
```

### Sharing

```
recipe_shares (
  id, recipe_id -> recipes,
  shared_by -> users,
  shared_with_user_id -> users,           -- nullable; direct share to a person
  shared_with_workspace_id -> workspaces, -- nullable; share into another
                                          -- chef's whole workspace
  permission,                             -- 'view' | 'copy' | 'edit'
  created_at
)
```

### Prep lists (deprioritized in UI for private chef, kept structurally)

```
prep_lists (
  id, workspace_id -> workspaces,
  client_id -> clients,
  recipe_id -> recipes,        -- optional direct link when a prep list is just
                               -- "the prep for this one recipe"
  name, service_date,
  created_by -> users, created_at
)

prep_list_items (
  id, prep_list_id -> prep_lists,
  recipe_id -> recipes, recipe_version_id -> recipe_versions,
  target_quantity, target_unit,
  assigned_to -> users,
  status,
  created_at
)

prep_task_completions (
  id, prep_list_item_id -> prep_list_items,
  completed_by -> users,
  quantity_completed, unit,
  completed_at, device_id, synced_at
)
```

---

## Schema notes

- A recipe has a current published version (`recipes.current_version_id`);
  versions are immutable history.
- `recipe_ingredient_lines` can reference either a raw `ingredient_id` OR a
  `sub_recipe_id`/`sub_recipe_version_id` (a component recipe), enabling nested
  recipes — scaling must recurse through sub-recipes.
- Ingredients carry `base_unit`, `density_g_per_ml` (for volume↔weight), and
  `cost_per_base_unit` (for costing). Scaling/conversion math lives on top of these.
- Sync-relevant rows (e.g. `prep_task_completions`) carry `device_id` and
  `synced_at` to support the offline write queue.
