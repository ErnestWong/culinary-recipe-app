import { test } from "node:test";
import assert from "node:assert/strict";

import { convert, normalizeUnit, dimensionOf } from "./units";
import {
  scaleFactorForCovers,
  scaleLines,
  aggregateRawIngredients,
  rawIngredientsForCovers,
  roundForDisplay,
  type ScaleContext,
} from "./scaling";
import type { Ingredient, RecipeIngredientLine, RecipeVersionDetail } from "./types";

// --- fixtures ---

function ing(id: string, name: string, base_unit: string, opts: Partial<Ingredient> = {}): Ingredient {
  return {
    id,
    workspace_id: "w1",
    name,
    base_unit,
    density_g_per_ml: opts.density_g_per_ml ?? null,
    cost_per_base_unit: opts.cost_per_base_unit ?? null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

let lineSeq = 0;
function ingLine(ingredient_id: string, quantity: number, unit: string): RecipeIngredientLine {
  return {
    id: `l${lineSeq++}`,
    recipe_version_id: "v",
    line_order: lineSeq,
    ingredient_id,
    sub_recipe_id: null,
    sub_recipe_version_id: null,
    quantity,
    unit,
    notes: null,
  };
}

function subLine(versionId: string, quantity: number, unit: string): RecipeIngredientLine {
  return {
    id: `l${lineSeq++}`,
    recipe_version_id: "v",
    line_order: lineSeq,
    ingredient_id: null,
    sub_recipe_id: "r",
    sub_recipe_version_id: versionId,
    quantity,
    unit,
    notes: null,
  };
}

function version(
  id: string,
  yield_quantity: number,
  yield_unit: string,
  lines: RecipeIngredientLine[]
): RecipeVersionDetail {
  return {
    id,
    recipe_id: "r-" + id,
    version_number: 1,
    yield_quantity,
    yield_unit,
    instructions: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    is_published: true,
    lines,
  };
}

function ctxOf(ingredients: Ingredient[], versions: RecipeVersionDetail[]): ScaleContext {
  const im = new Map(ingredients.map((i) => [i.id, i]));
  const vm = new Map(versions.map((v) => [v.id, v]));
  return { getIngredient: (id) => im.get(id), getVersion: (id) => vm.get(id) };
}

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

// --- unit conversions ---

test("same unit is identity", () => {
  assert.equal(convert(5, "g", "g"), 5);
});

test("mass conversions", () => {
  assert.equal(convert(1, "kg", "g"), 1000);
  assert.equal(convert(500, "g", "kg"), 0.5);
  approx(convert(1, "lb", "g"), 453.59237);
  approx(convert(16, "oz", "lb"), 1);
});

test("volume conversions", () => {
  assert.equal(convert(1, "l", "ml"), 1000);
  approx(convert(1, "tbsp", "ml"), 14.78676478125);
  approx(convert(1, "cup", "ml"), 236.5882365);
  approx(convert(3, "tsp", "tbsp"), 1);
});

test("unit aliases normalize", () => {
  assert.equal(normalizeUnit("grams"), "g");
  assert.equal(normalizeUnit("Tablespoons"), "tbsp");
  assert.equal(dimensionOf("cups"), "volume");
});

test("common cooking count-words map to each", () => {
  assert.equal(normalizeUnit("cloves"), "each");
  assert.equal(normalizeUnit("pinch"), "each");
  assert.equal(dimensionOf("bunch"), "count");
  // scale linearly: 2 cloves at 3x = 6
  assert.equal(convert(2, "cloves", "each") * 3, 6);
});

test("mass <-> volume needs density and uses it", () => {
  // water: 1 g/ml -> 100 ml == 100 g
  approx(convert(100, "ml", "g", 1), 100);
  approx(convert(100, "g", "ml", 1), 100);
  // honey ~1.42 g/ml -> 10 ml == 14.2 g
  approx(convert(10, "ml", "g", 1.42), 14.2);
});

test("cross-dimension without density throws", () => {
  assert.throws(() => convert(100, "ml", "g"), /requires a density/);
});

test("count cannot convert to mass", () => {
  assert.throws(() => convert(1, "each", "g", 1), /Cannot convert/);
});

test("unknown unit throws", () => {
  assert.throws(() => convert(1, "smidgen", "g"), /Unknown unit/);
});

// --- scale factor ---

test("scaleFactorForCovers", () => {
  const v = version("v", 4, "servings", []);
  assert.equal(scaleFactorForCovers(v, 20), 5);
  assert.equal(scaleFactorForCovers(v, 4), 1);
  assert.equal(scaleFactorForCovers(v, 0), 0);
});

test("zero or negative yield throws", () => {
  assert.throws(() => scaleFactorForCovers(version("v", 0, "servings", []), 10), /greater than zero/);
});

// --- scaling lines ---

test("scaleLines multiplies each line", () => {
  const v = version("v", 4, "servings", [ingLine("flour", 200, "g"), ingLine("milk", 2, "cup")]);
  const scaled = scaleLines(v, 5);
  assert.equal(scaled[0].quantity, 1000);
  assert.equal(scaled[1].quantity, 10);
});

// --- raw ingredient aggregation ---

test("scales raw ingredients to covers", () => {
  const flour = ing("flour", "Flour", "g");
  const v = version("v", 4, "servings", [ingLine("flour", 200, "g")]);
  const totals = rawIngredientsForCovers(v, 20, ctxOf([flour], [v]));
  assert.equal(totals.length, 1);
  assert.equal(totals[0].quantity, 1000); // 200g * (20/4)
  assert.equal(totals[0].unit, "g");
});

test("converts line unit into ingredient base unit", () => {
  const flour = ing("flour", "Flour", "g");
  // line in kg, ingredient base in g
  const v = version("v", 1, "servings", [ingLine("flour", 1, "kg")]);
  const totals = rawIngredientsForCovers(v, 2, ctxOf([flour], [v]));
  assert.equal(totals[0].quantity, 2000); // 1kg * 2 = 2000g
});

test("uses density for volume->mass ingredient base", () => {
  const milk = ing("milk", "Milk", "g", { density_g_per_ml: 1.03 });
  const v = version("v", 1, "servings", [ingLine("milk", 1000, "ml")]);
  const totals = rawIngredientsForCovers(v, 1, ctxOf([milk], [v]));
  approx(totals[0].quantity, 1030); // 1000ml * 1.03 g/ml
});

test("sums duplicate ingredient across lines", () => {
  const flour = ing("flour", "Flour", "g");
  const v = version("v", 1, "servings", [ingLine("flour", 100, "g"), ingLine("flour", 50, "g")]);
  const totals = rawIngredientsForCovers(v, 1, ctxOf([flour], [v]));
  assert.equal(totals.length, 1);
  assert.equal(totals[0].quantity, 150);
});

test("computes cost when cost_per_base_unit is set", () => {
  const flour = ing("flour", "Flour", "g", { cost_per_base_unit: 0.002 }); // $/g
  const v = version("v", 4, "servings", [ingLine("flour", 200, "g")]);
  const totals = rawIngredientsForCovers(v, 20, ctxOf([flour], [v]));
  approx(totals[0].cost!, 2); // 1000g * 0.002
});

test("recurses through a sub-recipe", () => {
  // Sauce yields 500 ml from 400ml stock + 100ml cream
  const stock = ing("stock", "Stock", "ml");
  const cream = ing("cream", "Cream", "ml");
  const flour = ing("flour", "Flour", "g");
  const sauce = version("sauce", 500, "ml", [ingLine("stock", 400, "ml"), ingLine("cream", 100, "ml")]);
  // Dish (yields 4 servings): 200g flour + 250ml of the sauce
  const dish = version("dish", 4, "servings", [ingLine("flour", 200, "g"), subLine("sauce", 250, "ml")]);

  const totals = rawIngredientsForCovers(dish, 8, ctxOf([stock, cream, flour], [sauce, dish]));
  const byId = Object.fromEntries(totals.map((t) => [t.ingredient_id, t.quantity]));

  // factor for dish = 8/4 = 2. flour: 200*2 = 400g
  assert.equal(byId["flour"], 400);
  // sauce needed = 250ml * 2 = 500ml = 1.0 sauce yield. stock 400ml, cream 100ml.
  approx(byId["stock"], 400);
  approx(byId["cream"], 100);
});

test("detects cyclic sub-recipe references", () => {
  const a = version("a", 1, "servings", [subLine("b", 1, "servings")]);
  const b = version("b", 1, "servings", [subLine("a", 1, "servings")]);
  assert.throws(
    () => aggregateRawIngredients(a, 1, ctxOf([], [a, b])),
    /Cyclic/
  );
});

// --- display rounding ---

test("roundForDisplay", () => {
  assert.equal(roundForDisplay(1234.567), 1235);
  assert.equal(roundForDisplay(12.345), 12.3);
  assert.equal(roundForDisplay(1.2345), 1.23);
  assert.equal(roundForDisplay(0.12345), 0.123);
  assert.equal(roundForDisplay(0), 0);
});
