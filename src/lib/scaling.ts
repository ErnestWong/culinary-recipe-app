// Recipe scaling engine.
//
// Pure, dependency-free functions: given a recipe version and a target number
// of covers (portions), compute scaled ingredient quantities — recursing
// through sub-recipes (components) down to raw ingredients.
//
// Covered by scaling.test.ts.

import { convert } from "./units";
import type {
  Ingredient,
  RecipeIngredientLine,
  RecipeVersionDetail,
} from "./types";

// Lookups the scaler needs. Supplied by the caller (DB, fixtures, etc.) so the
// engine stays pure and testable.
export interface ScaleContext {
  getIngredient(id: string): Ingredient | undefined;
  getVersion(versionId: string): RecipeVersionDetail | undefined;
}

/**
 * Multiplier to take a recipe from its written yield to `covers` portions.
 * `yield_quantity` is interpreted as a portion count.
 */
export function scaleFactorForCovers(
  version: RecipeVersionDetail,
  covers: number
): number {
  if (version.yield_quantity <= 0) {
    throw new Error("Recipe yield_quantity must be greater than zero");
  }
  if (covers < 0) throw new Error("covers cannot be negative");
  return covers / version.yield_quantity;
}

export interface ScaledLine {
  line: RecipeIngredientLine;
  quantity: number; // line.quantity * factor, in line.unit
  unit: string;
}

/** Scale a version's direct lines by `factor` (no recursion). */
export function scaleLines(
  version: RecipeVersionDetail,
  factor: number
): ScaledLine[] {
  return [...version.lines]
    .sort((a, b) => a.line_order - b.line_order)
    .map((line) => ({
      line,
      quantity: line.quantity * factor,
      unit: line.unit,
    }));
}

export interface RawIngredientTotal {
  ingredient_id: string;
  name: string;
  quantity: number; // in the ingredient's base_unit
  unit: string; // the ingredient's base_unit
  cost: number | null; // quantity * cost_per_base_unit, when known
}

/**
 * Resolve a version (scaled by `factor`) down to total raw-ingredient
 * quantities in each ingredient's base unit, summing across nested sub-recipes.
 *
 * `seen` guards against cyclic sub-recipe references.
 */
export function aggregateRawIngredients(
  version: RecipeVersionDetail,
  factor: number,
  ctx: ScaleContext,
  totals: Map<string, RawIngredientTotal> = new Map(),
  seen: Set<string> = new Set()
): Map<string, RawIngredientTotal> {
  if (seen.has(version.id)) {
    throw new Error(`Cyclic sub-recipe reference at version ${version.id}`);
  }
  seen.add(version.id);

  for (const line of version.lines) {
    if (line.ingredient_id) {
      const ing = ctx.getIngredient(line.ingredient_id);
      if (!ing) throw new Error(`Unknown ingredient: ${line.ingredient_id}`);

      const scaledQty = line.quantity * factor;
      const inBase = convert(scaledQty, line.unit, ing.base_unit, ing.density_g_per_ml);

      const existing = totals.get(ing.id);
      const nextQty = (existing?.quantity ?? 0) + inBase;
      totals.set(ing.id, {
        ingredient_id: ing.id,
        name: ing.name,
        quantity: nextQty,
        unit: ing.base_unit,
        cost: ing.cost_per_base_unit != null ? nextQty * ing.cost_per_base_unit : null,
      });
    } else if (line.sub_recipe_version_id) {
      const sub = ctx.getVersion(line.sub_recipe_version_id);
      if (!sub) throw new Error(`Unknown sub-recipe version: ${line.sub_recipe_version_id}`);

      // How many sub-recipe yields does this line call for?
      // line.quantity/unit expresses the amount of the component needed;
      // convert it into the sub-recipe's yield unit, then divide by its yield.
      const neededInYieldUnit = convert(line.quantity, line.unit, sub.yield_unit);
      const subFactor = (neededInYieldUnit / sub.yield_quantity) * factor;

      aggregateRawIngredients(sub, subFactor, ctx, totals, new Set(seen));
    } else {
      throw new Error(`Line ${line.id} references neither an ingredient nor a sub-recipe`);
    }
  }

  return totals;
}

/** Convenience: aggregated raw ingredients for a recipe scaled to `covers`. */
export function rawIngredientsForCovers(
  version: RecipeVersionDetail,
  covers: number,
  ctx: ScaleContext
): RawIngredientTotal[] {
  const factor = scaleFactorForCovers(version, covers);
  return [...aggregateRawIngredients(version, factor, ctx).values()];
}

/** Round a quantity to a sensible number of significant figures for display. */
export function roundForDisplay(quantity: number): number {
  if (quantity === 0) return 0;
  const abs = Math.abs(quantity);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  const f = 10 ** decimals;
  return Math.round(quantity * f) / f;
}
