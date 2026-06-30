"use client";

import { useEffect, useState } from "react";
import { listRecipes, buildScaleContext, deleteRecipe } from "@/lib/repo";
import { rawIngredientsForCovers, roundForDisplay } from "@/lib/scaling";
import type { ScaleContext } from "@/lib/scaling";
import type { RecipeDetail } from "@/lib/types";

export default function RecipeLibrary() {
  const [recipes, setRecipes] = useState<RecipeDetail[]>([]);
  const [ctx, setCtx] = useState<ScaleContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    const [list, context] = await Promise.all([listRecipes(), buildScaleContext()]);
    setRecipes(list);
    setCtx(context);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center flex-1 text-sm text-gray-400">Loading…</div>;
  }

  if (recipes.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-gray-400 text-center px-6">
        No recipes yet. Capture one in the Chat tab to get started.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="flex flex-col gap-4 max-w-2xl mx-auto">
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            ctx={ctx!}
            open={openId === recipe.id}
            onToggle={() => setOpenId((id) => (id === recipe.id ? null : recipe.id))}
            onDeleted={async () => {
              await deleteRecipe(recipe.id);
              await load();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function RecipeCard({
  recipe,
  ctx,
  open,
  onToggle,
  onDeleted,
}: {
  recipe: RecipeDetail;
  ctx: ScaleContext;
  open: boolean;
  onToggle: () => void;
  onDeleted: () => void;
}) {
  const version = recipe.current_version;
  const [covers, setCovers] = useState<number>(version?.yield_quantity ?? 1);
  const [prep, setPrep] = useState("");
  const [prepLoading, setPrepLoading] = useState(false);

  const totals = open && version ? safeScale(() => rawIngredientsForCovers(version, covers, ctx)) : null;

  async function generatePrep() {
    if (!version) return;
    setPrepLoading(true);
    setPrep("");
    try {
      const res = await fetch("/api/prep-steps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: {
            name: recipe.name,
            yield_quantity: version.yield_quantity,
            yield_unit: version.yield_unit,
            instructions: version.instructions,
            lines: version.lines.map((l) => ({
              name: ctx.getIngredient(l.ingredient_id ?? "")?.name ?? "ingredient",
              quantity: l.quantity,
              unit: l.unit,
              notes: l.notes,
            })),
          },
        }),
      });
      if (!res.ok || !res.body) {
        setPrep("Couldn't generate prep steps. Please try again.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setPrep((p) => p + decoder.decode(value));
      }
    } catch {
      setPrep("Network error generating prep steps.");
    } finally {
      setPrepLoading(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={onToggle} className="text-left flex-1">
          <h3 className="text-sm font-semibold text-gray-900">{recipe.name}</h3>
          {version && (
            <p className="text-xs text-gray-400 mt-0.5">
              Yields {roundForDisplay(version.yield_quantity)} {version.yield_unit} ·{" "}
              {version.lines.length} ingredient{version.lines.length === 1 ? "" : "s"}
            </p>
          )}
        </button>
        {recipe.type === "component" && (
          <span className="shrink-0 text-xs text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">
            component
          </span>
        )}
      </div>

      {open && version && (
        <div className="flex flex-col gap-4 border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Scale to</label>
            <input
              type="number"
              min={0}
              step="any"
              value={covers}
              onChange={(e) => setCovers(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
            />
            <span className="text-xs text-gray-500">covers</span>
            {version.yield_quantity > 0 && (
              <span className="text-xs text-gray-300 ml-1">
                ×{roundForDisplay(covers / version.yield_quantity)}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-gray-500 mb-1">
              Raw ingredients for {roundForDisplay(covers)} covers
            </span>
            {totals?.error && <p className="text-xs text-red-500">{totals.error}</p>}
            {totals?.value?.map((t) => (
              <div
                key={t.ingredient_id}
                className="flex justify-between text-sm text-gray-700 py-0.5 border-b border-gray-50"
              >
                <span>{t.name}</span>
                <span className="font-mono text-gray-900">
                  {roundForDisplay(t.quantity)} {t.unit}
                  {t.cost != null && <span className="text-gray-400"> · ${roundForDisplay(t.cost)}</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={generatePrep}
              disabled={prepLoading}
              className="self-start text-xs font-medium text-gray-900 border border-gray-300 rounded-full px-3 py-1.5 hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              {prepLoading ? "Generating…" : prep ? "Regenerate prep steps" : "Suggest prep steps"}
            </button>
            {prep && (
              <div className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 leading-relaxed">
                {prep}
              </div>
            )}
          </div>

          <button
            onClick={onDeleted}
            className="self-start text-xs text-gray-400 hover:text-red-500 transition-colors"
          >
            Delete recipe
          </button>
        </div>
      )}
    </div>
  );
}

function safeScale<T>(fn: () => T): { value?: T; error?: string } {
  try {
    return { value: fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not scale this recipe" };
  }
}
