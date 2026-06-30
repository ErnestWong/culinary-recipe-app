"use client";

import type { ParsedRecipe } from "@/lib/types";

const COMMON_UNITS = ["g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "each", "dozen"];

interface Props {
  draft: ParsedRecipe;
  onChange: (next: ParsedRecipe) => void;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}

// Editable view of an AI-parsed recipe. The user always gets the final say
// before the recipe is saved (PRODUCT.md: "User always has the final option to
// edit the recipe/prep list inputs").
export default function RecipeDraft({ draft, onChange, onConfirm, onCancel, saving }: Props) {
  function set<K extends keyof ParsedRecipe>(key: K, value: ParsedRecipe[K]) {
    onChange({ ...draft, [key]: value });
  }

  function updateLine(i: number, patch: Partial<ParsedRecipe["lines"][number]>) {
    const lines = draft.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    onChange({ ...draft, lines });
  }

  function removeLine(i: number) {
    onChange({ ...draft, lines: draft.lines.filter((_, idx) => idx !== i) });
  }

  function addLine() {
    onChange({
      ...draft,
      lines: [...draft.lines, { ingredient_name: "", quantity: 0, unit: "g" }],
    });
  }

  return (
    <div className="border border-gray-200 rounded-2xl p-4 flex flex-col gap-4 bg-white">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Review recipe</span>
        <select
          value={draft.type ?? "dish"}
          onChange={(e) => set("type", e.target.value as ParsedRecipe["type"])}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-700 bg-white"
        >
          <option value="dish">Dish</option>
          <option value="component">Component</option>
        </select>
      </div>

      <input
        value={draft.name}
        onChange={(e) => set("name", e.target.value)}
        placeholder="Recipe name"
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-900 focus:outline-none focus:border-gray-400"
      />

      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-gray-500">Yields</span>
        <input
          type="number"
          min={0}
          step="any"
          value={draft.yield_quantity}
          onChange={(e) => set("yield_quantity", parseFloat(e.target.value) || 0)}
          className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
        />
        <input
          value={draft.yield_unit}
          onChange={(e) => set("yield_unit", e.target.value)}
          placeholder="servings"
          className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-gray-500">Ingredients</span>
        {draft.lines.map((line, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              step="any"
              value={line.quantity}
              onChange={(e) => updateLine(i, { quantity: parseFloat(e.target.value) || 0 })}
              className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
            />
            <input
              list="unit-list"
              value={line.unit}
              onChange={(e) => updateLine(i, { unit: e.target.value })}
              className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
            />
            <input
              value={line.ingredient_name}
              onChange={(e) => updateLine(i, { ingredient_name: e.target.value })}
              placeholder="ingredient"
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
            />
            <button
              type="button"
              onClick={() => removeLine(i)}
              className="text-gray-300 hover:text-gray-600 px-1 text-lg leading-none"
              aria-label="Remove ingredient"
            >
              ×
            </button>
          </div>
        ))}
        <datalist id="unit-list">
          {COMMON_UNITS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={addLine}
          className="self-start text-xs text-gray-500 hover:text-gray-800 transition-colors"
        >
          + Add ingredient
        </button>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={saving || !draft.name.trim() || draft.lines.length === 0}
          className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {saving ? "Saving…" : "Confirm & save"}
        </button>
      </div>
    </div>
  );
}
