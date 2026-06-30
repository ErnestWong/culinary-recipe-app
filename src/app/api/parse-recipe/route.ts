import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import type { ParsedIngredientLine, ParsedRecipe } from "@/lib/types";

const client = new Anthropic();

// The model can occasionally emit malformed structured output (e.g. a non-numeric
// quantity like "<UNKNOWN>" for "salt to taste", or `lines` as a JSON string).
// Coerce whatever comes back into a clean ParsedRecipe so the client never breaks.
function normalize(raw: unknown): ParsedRecipe | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  let rawLines = r.lines;
  if (typeof rawLines === "string") {
    try {
      rawLines = JSON.parse(rawLines);
    } catch {
      rawLines = [];
    }
  }

  const lines: ParsedIngredientLine[] = Array.isArray(rawLines)
    ? rawLines
        .map((l): ParsedIngredientLine | null => {
          if (!l || typeof l !== "object") return null;
          const o = l as Record<string, unknown>;
          const name = typeof o.ingredient_name === "string" ? o.ingredient_name.trim() : "";
          if (!name) return null;
          const qty = typeof o.quantity === "number" && isFinite(o.quantity) ? o.quantity : 0;
          const unit = typeof o.unit === "string" && o.unit.trim() ? o.unit.trim() : "each";
          const notes = typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : undefined;
          return { ingredient_name: name, quantity: qty, unit, notes };
        })
        .filter((l): l is ParsedIngredientLine => l !== null)
    : [];

  const yq = typeof r.yield_quantity === "number" && r.yield_quantity > 0 ? r.yield_quantity : 1;

  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Untitled recipe",
    type: r.type === "component" ? "component" : "dish",
    yield_quantity: yq,
    yield_unit: typeof r.yield_unit === "string" && r.yield_unit.trim() ? r.yield_unit.trim() : "servings",
    instructions: typeof r.instructions === "string" ? r.instructions : undefined,
    lines,
  };
}

const KNOWN_UNITS =
  "g, kg, mg, oz, lb, ml, l, tsp, tbsp, cup, floz, pt, qt, gal, each, dozen";

// Parse free-form recipe text (typed today; dictated/photo later) into a
// structured recipe the user can edit before saving.
export async function POST(req: NextRequest) {
  const { text } = await req.json();

  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "No recipe text provided" }, { status: 400 });
  }

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    tools: [
      {
        name: "save_recipe",
        description:
          "Record a structured recipe parsed from the user's text. Use canonical ingredient names and known units.",
        input_schema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Concise recipe/dish name" },
            type: {
              type: "string",
              enum: ["dish", "component"],
              description: "'component' if it is a sub-recipe (sauce, stock, base); otherwise 'dish'",
            },
            yield_quantity: {
              type: "number",
              description: "How many portions/servings the recipe as written produces (default 1 if unknown)",
            },
            yield_unit: {
              type: "string",
              description: "Unit for the yield, usually 'servings' or 'portions'",
            },
            instructions: {
              type: "string",
              description: "The method/instructions, preserved as written (may be empty)",
            },
            lines: {
              type: "array",
              description: "One entry per ingredient line",
              items: {
                type: "object",
                properties: {
                  ingredient_name: {
                    type: "string",
                    description: "Canonical ingredient name (e.g. 'all-purpose flour', 'unsalted butter')",
                  },
                  quantity: {
                    type: "number",
                    description:
                      "Numeric amount. If unspecified (e.g. 'to taste', 'a pinch'), use 0 and put the descriptor in notes. Always a number, never text.",
                  },
                  unit: {
                    type: "string",
                    description: `Unit of measure. Prefer one of: ${KNOWN_UNITS}. Use 'each' for whole-item counts.`,
                  },
                  notes: { type: "string", description: "Prep notes for this line, e.g. 'diced', optional" },
                },
                required: ["ingredient_name", "quantity", "unit"],
              },
            },
          },
          required: ["name", "yield_quantity", "yield_unit", "lines"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "save_recipe" },
    messages: [
      {
        role: "user",
        content: `Parse this recipe into structured data. If a quantity or unit is ambiguous, make a reasonable cooking judgment.\n\n${text}`,
      },
    ],
  });

  const toolUse = result.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Could not parse a recipe from that text" }, { status: 422 });
  }

  const recipe = normalize(toolUse.input);
  if (!recipe || recipe.lines.length === 0) {
    return NextResponse.json({ error: "Could not parse a recipe from that text" }, { status: 422 });
  }

  return NextResponse.json(recipe);
}
