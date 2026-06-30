"use client";

import { useEffect, useState } from "react";
import { listDishes, getDishVersions } from "@/lib/dishes";
import type { DishSummary, DishVersion } from "@/lib/types";

const COURSE_LABELS: Record<string, string> = {
  appetizer: "Appetizer",
  main: "Main",
  dessert: "Dessert",
  side: "Side",
  snack: "Snack",
  beverage: "Beverage",
};

export default function RecipeLibrary() {
  const [dishes, setDishes] = useState<DishSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [versionMap, setVersionMap] = useState<Record<string, DishVersion[]>>({});

  useEffect(() => {
    listDishes()
      .then(setDishes)
      .finally(() => setIsLoading(false));
  }, []);

  async function toggleVersions(dishId: string) {
    if (expandedId === dishId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(dishId);
    if (!versionMap[dishId]) {
      const versions = await getDishVersions(dishId);
      setVersionMap((m) => ({ ...m, [dishId]: versions }));
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (dishes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        No saved dishes yet. Use "Save dish" in the chat to add one.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {dishes.map((dish) => (
          <div
            key={dish.id}
            className="border border-gray-200 rounded-2xl p-4 flex flex-col gap-3 hover:border-gray-300 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900 leading-snug">{dish.name}</h3>
              {dish.course_type && (
                <span className="shrink-0 text-xs text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">
                  {COURSE_LABELS[dish.course_type] ?? dish.course_type}
                </span>
              )}
            </div>

            {dish.hero_ingredient && (
              <p className="text-xs text-gray-500">
                Hero: <span className="text-gray-700 font-medium">{dish.hero_ingredient}</span>
              </p>
            )}

            {dish.latest_version?.recipe?.components?.length > 0 && (
              <div className="flex flex-col gap-1">
                {dish.latest_version.recipe.components.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      c.role === "hero" ? "bg-gray-900" :
                      c.role === "supporting" ? "bg-gray-400" : "bg-gray-200"
                    }`} />
                    <span>{c.name}</span>
                    <span className="text-gray-300">{c.delivery}</span>
                  </div>
                ))}
              </div>
            )}

            {dish.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-auto pt-1">
                {dish.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs text-gray-500 bg-gray-100 rounded-full px-2 py-0.5"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => toggleVersions(dish.id)}
              className="text-xs text-gray-400 hover:text-gray-600 text-left transition-colors"
            >
              {expandedId === dish.id ? "Hide" : `${dish.latest_version?.version ?? 1} version${(dish.latest_version?.version ?? 1) > 1 ? "s" : ""} ↓`}
            </button>

            {expandedId === dish.id && (
              <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
                {(versionMap[dish.id] ?? []).slice().reverse().map((v) => (
                  <div key={v.id} className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 font-mono text-gray-300">v{v.version}</span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-gray-700">{v.commit_message ?? "—"}</span>
                      <span className="text-gray-300">{new Date(v.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
