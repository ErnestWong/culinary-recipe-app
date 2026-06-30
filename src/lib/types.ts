// Domain schema for the culinary recipe app.
// See PRODUCT.md for the canonical spec. All ids are uuid strings.

export type WorkspaceType = "restaurant" | "private_chef";
export type Role =
  | "owner"
  | "chef"
  | "sous_chef"
  | "line_cook"
  | "manager"
  | "solo";
export type RecipeType = "dish" | "component";
export type SharePermission = "view" | "copy" | "edit";
export type PrepStatus = "todo" | "in_progress" | "done";

// --- Tenancy ---

export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  organization_id: string;
  name: string;
  type: WorkspaceType;
  timezone: string;
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface WorkspaceUser {
  id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
}

export interface Client {
  id: string;
  workspace_id: string;
  name: string;
  dietary_notes: string | null;
  contact_info: string | null;
  created_at: string;
}

// --- Ingredients ---

// base_unit is the canonical unit this ingredient is stored/costed in.
export interface Ingredient {
  id: string;
  workspace_id: string;
  name: string;
  base_unit: string; // e.g. "g", "ml", "each"
  density_g_per_ml: number | null; // enables volume <-> weight conversion
  cost_per_base_unit: number | null;
  created_at: string;
}

// --- Recipes ---

export interface Recipe {
  id: string;
  workspace_id: string;
  client_id: string | null; // set when scoped to a private-chef client
  name: string;
  type: RecipeType;
  current_version_id: string | null;
  created_at: string;
}

export interface RecipeVersion {
  id: string;
  recipe_id: string;
  version_number: number;
  yield_quantity: number; // how many `yield_unit` this recipe produces as written
  yield_unit: string; // typically "servings" / "portions"
  instructions: string | null;
  created_by: string | null;
  created_at: string;
  is_published: boolean;
}

// A line references EITHER a raw ingredient OR a sub-recipe (component).
export interface RecipeIngredientLine {
  id: string;
  recipe_version_id: string;
  line_order: number;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  sub_recipe_version_id: string | null;
  quantity: number;
  unit: string;
  notes: string | null;
}

// --- Sharing ---

export interface RecipeShare {
  id: string;
  recipe_id: string;
  shared_by: string;
  shared_with_user_id: string | null;
  shared_with_workspace_id: string | null;
  permission: SharePermission;
  created_at: string;
}

// --- Prep lists ---

export interface PrepList {
  id: string;
  workspace_id: string;
  client_id: string | null;
  recipe_id: string | null;
  name: string;
  service_date: string; // ISO date for the evening of service
  covers: number; // number of portions to make available
  created_by: string | null;
  created_at: string;
}

export interface PrepListItem {
  id: string;
  prep_list_id: string;
  recipe_id: string;
  recipe_version_id: string;
  target_quantity: number;
  target_unit: string;
  assigned_to: string | null;
  status: PrepStatus;
  created_at: string;
}

export interface PrepTaskCompletion {
  id: string;
  prep_list_item_id: string;
  completed_by: string | null;
  quantity_completed: number;
  unit: string;
  completed_at: string;
  device_id: string;
  synced_at: string | null;
}

// --- Offline write queue ---

export type OutboxOp = "put" | "delete";

export interface OutboxEntry {
  id: string;
  table: string;
  op: OutboxOp;
  record_id: string;
  payload: unknown; // the full record for "put"; null for "delete"
  timestamp: string;
  device_id: string;
  synced_at: string | null;
}

// A recipe version hydrated with its ingredient lines — used for display/scaling.
export interface RecipeVersionDetail extends RecipeVersion {
  lines: RecipeIngredientLine[];
}

export interface RecipeDetail extends Recipe {
  current_version: RecipeVersionDetail | null;
}

// --- AI parse contract (api/parse-recipe -> client) ---
// What the model extracts from typed/dictated recipe text. The user edits this
// before it is confirmed and persisted.

export interface ParsedIngredientLine {
  ingredient_name: string;
  quantity: number;
  unit: string; // should be one of the known units; user can correct
  notes?: string;
}

export interface ParsedRecipe {
  name: string;
  type?: RecipeType;
  yield_quantity: number;
  yield_unit: string;
  instructions?: string;
  lines: ParsedIngredientLine[];
}
