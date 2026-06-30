// Domain repository: turns app actions into local-store reads/writes.
// All persistence goes through db.ts so every write is queued in the outbox.

import * as db from "./db";
import type { ScaleContext } from "./scaling";
import type {
  Ingredient,
  Organization,
  ParsedRecipe,
  Recipe,
  RecipeDetail,
  RecipeIngredientLine,
  RecipeVersion,
  RecipeVersionDetail,
  User,
  Workspace,
  WorkspaceUser,
} from "./types";

const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const BOOTSTRAP_KEY = "culinary-workspace-id";

// Ensure a default org / workspace / solo user exist on this device, returning
// the active workspace id. (Auth + multi-workspace switching come later.)
export async function ensureWorkspace(): Promise<string> {
  if (typeof localStorage !== "undefined") {
    const cached = localStorage.getItem(BOOTSTRAP_KEY);
    if (cached) return cached;
  }

  const existing = await db.getAll<Workspace>("workspaces");
  if (existing.length > 0) {
    localStorage?.setItem(BOOTSTRAP_KEY, existing[0].id);
    return existing[0].id;
  }

  const org: Organization = { id: uuid(), name: "My Kitchen", created_at: now() };
  const ws: Workspace = {
    id: uuid(),
    organization_id: org.id,
    name: "My Kitchen",
    type: "private_chef",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    created_at: now(),
  };
  const user: User = { id: uuid(), name: "Chef", email: "", created_at: now() };
  const wu: WorkspaceUser = {
    id: uuid(),
    workspace_id: ws.id,
    user_id: user.id,
    role: "solo",
  };

  await db.put("organizations", org);
  await db.put("workspaces", ws);
  await db.put("users", user);
  await db.put("workspace_users", wu);
  localStorage?.setItem(BOOTSTRAP_KEY, ws.id);
  return ws.id;
}

// Find an ingredient by name (case-insensitive) in the workspace, or create it.
async function findOrCreateIngredient(
  workspaceId: string,
  name: string,
  unit: string
): Promise<Ingredient> {
  const all = await db.getBy<Ingredient>("ingredients", "workspace_id", workspaceId);
  const match = all.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (match) return match;

  // Pick a sensible base unit from the unit the recipe used.
  const base = guessBaseUnit(unit);
  const ingredient: Ingredient = {
    id: uuid(),
    workspace_id: workspaceId,
    name: name.trim(),
    base_unit: base,
    density_g_per_ml: null,
    cost_per_base_unit: null,
    created_at: now(),
  };
  await db.put("ingredients", ingredient);
  return ingredient;
}

function guessBaseUnit(unit: string): string {
  const u = unit.trim().toLowerCase();
  const mass = ["g", "gram", "grams", "kg", "mg", "oz", "lb", "lbs", "pound", "pounds"];
  const volume = ["ml", "l", "tsp", "tbsp", "cup", "cups", "floz", "fl_oz", "pt", "qt", "gal"];
  if (mass.includes(u)) return "g";
  if (volume.includes(u)) return "ml";
  return "each";
}

// Persist a parsed (and user-edited) recipe as a recipe + first version + lines.
export async function saveParsedRecipe(parsed: ParsedRecipe): Promise<RecipeDetail> {
  const workspaceId = await ensureWorkspace();

  const recipe: Recipe = {
    id: uuid(),
    workspace_id: workspaceId,
    client_id: null,
    name: parsed.name.trim() || "Untitled recipe",
    type: parsed.type ?? "dish",
    current_version_id: null,
    created_at: now(),
  };

  const version: RecipeVersion = {
    id: uuid(),
    recipe_id: recipe.id,
    version_number: 1,
    yield_quantity: parsed.yield_quantity > 0 ? parsed.yield_quantity : 1,
    yield_unit: parsed.yield_unit || "servings",
    instructions: parsed.instructions ?? null,
    created_by: null,
    created_at: now(),
    is_published: true,
  };
  recipe.current_version_id = version.id;

  const lines: RecipeIngredientLine[] = [];
  for (let i = 0; i < parsed.lines.length; i++) {
    const pl = parsed.lines[i];
    const ingredient = await findOrCreateIngredient(workspaceId, pl.ingredient_name, pl.unit);
    lines.push({
      id: uuid(),
      recipe_version_id: version.id,
      line_order: i,
      ingredient_id: ingredient.id,
      sub_recipe_id: null,
      sub_recipe_version_id: null,
      quantity: pl.quantity,
      unit: pl.unit,
      notes: pl.notes ?? null,
    });
  }

  await db.put("recipes", recipe);
  await db.put("recipe_versions", version);
  await db.putMany("recipe_ingredient_lines", lines);

  return { ...recipe, current_version: { ...version, lines } };
}

async function hydrateVersion(versionId: string): Promise<RecipeVersionDetail | null> {
  const version = await db.get<RecipeVersion>("recipe_versions", versionId);
  if (!version) return null;
  const lines = await db.getBy<RecipeIngredientLine>(
    "recipe_ingredient_lines",
    "recipe_version_id",
    versionId
  );
  return { ...version, lines: lines.sort((a, b) => a.line_order - b.line_order) };
}

export async function listRecipes(): Promise<RecipeDetail[]> {
  const workspaceId = await ensureWorkspace();
  const recipes = await db.getBy<Recipe>("recipes", "workspace_id", workspaceId);
  const detailed = await Promise.all(
    recipes.map(async (r) => ({
      ...r,
      current_version: r.current_version_id ? await hydrateVersion(r.current_version_id) : null,
    }))
  );
  return detailed.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getRecipe(recipeId: string): Promise<RecipeDetail | null> {
  const recipe = await db.get<Recipe>("recipes", recipeId);
  if (!recipe) return null;
  return {
    ...recipe,
    current_version: recipe.current_version_id
      ? await hydrateVersion(recipe.current_version_id)
      : null,
  };
}

// Build a scale context covering every ingredient + version in the workspace,
// so sub-recipe references resolve during scaling.
export async function buildScaleContext(): Promise<ScaleContext> {
  const [ingredients, versions, allLines] = await Promise.all([
    db.getAll<Ingredient>("ingredients"),
    db.getAll<RecipeVersion>("recipe_versions"),
    db.getAll<RecipeIngredientLine>("recipe_ingredient_lines"),
  ]);

  const im = new Map(ingredients.map((i) => [i.id, i]));
  const linesByVersion = new Map<string, RecipeIngredientLine[]>();
  for (const line of allLines) {
    const arr = linesByVersion.get(line.recipe_version_id) ?? [];
    arr.push(line);
    linesByVersion.set(line.recipe_version_id, arr);
  }
  const vm = new Map<string, RecipeVersionDetail>(
    versions.map((v) => [
      v.id,
      { ...v, lines: (linesByVersion.get(v.id) ?? []).sort((a, b) => a.line_order - b.line_order) },
    ])
  );

  return {
    getIngredient: (id) => im.get(id),
    getVersion: (id) => vm.get(id),
  };
}

export async function deleteRecipe(recipeId: string): Promise<void> {
  const recipe = await db.get<Recipe>("recipes", recipeId);
  if (!recipe) return;
  const versions = await db.getBy<RecipeVersion>("recipe_versions", "recipe_id", recipeId);
  for (const v of versions) {
    const lines = await db.getBy<RecipeIngredientLine>(
      "recipe_ingredient_lines",
      "recipe_version_id",
      v.id
    );
    for (const l of lines) await db.remove("recipe_ingredient_lines", l.id);
    await db.remove("recipe_versions", v.id);
  }
  await db.remove("recipes", recipeId);
}
