# Culinary Recipe App

A recipe + prep management app for restaurants and private chefs. Capture a
recipe, edit it, scale it to a service's covers (showing each raw ingredient's
quantity, recursing through sub-recipes), and generate prep steps. Offline-first.

See **[PRODUCT.md](./PRODUCT.md)** for the full product spec and data schema.

## Status — V0

- **Capture (chat):** type or paste a recipe; the AI parses it into a structured,
  editable draft you confirm before saving. (Photo and voice capture come later.)
- **Recipes:** scale any saved recipe to N covers and see raw-ingredient totals
  (with cost when known); generate suggested prep steps with AI.
- **Offline-first:** recipes are stored locally in IndexedDB; every write is
  queued in an outbox (timestamp + device id). The header shows online/sync
  status. Server sync is stubbed for now — the queue accumulates locally.

## Getting started

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Requires `ANTHROPIC_API_KEY` in `.env.local` (used by the parse + prep-step routes).

## Tests

The recipe scaling/unit-conversion engine (`src/lib/scaling.ts`, `src/lib/units.ts`)
is covered by tests:

```bash
npm test
```

## Architecture

- **`src/lib/types.ts`** — domain schema (see PRODUCT.md).
- **`src/lib/units.ts`** — unit definitions + conversions (mass/volume/count, density).
- **`src/lib/scaling.ts`** — pure scaling engine; recurses through sub-recipes.
- **`src/lib/db.ts`** — native IndexedDB store + outbox write queue (no deps).
- **`src/lib/repo.ts`** — domain repository over the local store.
- **`src/app/api/parse-recipe`** — recipe text → structured `ParsedRecipe` (tool use).
- **`src/app/api/prep-steps`** — recipe → streamed prep checklist.
- **`src/components/`** — `Chat` (capture), `RecipeDraft` (edit), `RecipeLibrary`
  (scale + prep), `SyncStatus`.
