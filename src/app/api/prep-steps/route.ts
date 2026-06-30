import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic();

const SYSTEM = `You are a sous chef generating a mise en place / prep list for a professional kitchen.

Given a recipe (ingredients, yield, and method), produce the prep steps a cook should complete BEFORE service — the tasks that can be done ahead. Focus on:
- breaking the recipe into discrete, assignable prep tasks
- what to cut, measure, mix, cook-ahead, portion, or store
- logical ordering and anything that needs lead time (marinating, chilling, reducing)

Output a concise ordered markdown checklist. Each item is one actionable task. Do not restate the full method or plate-up steps. No preamble.`;

// Stream suggested prep steps for a recipe. The user can edit them afterward.
export async function POST(req: NextRequest) {
  const { recipe } = await req.json();

  if (!recipe) {
    return new Response("Missing recipe", { status: 400 });
  }

  const lines: string = (recipe.lines ?? [])
    .map((l: { quantity: number; unit: string; ingredient_name?: string; name?: string; notes?: string }) =>
      `- ${l.quantity} ${l.unit} ${l.ingredient_name ?? l.name ?? ""}${l.notes ? ` (${l.notes})` : ""}`
    )
    .join("\n");

  const userContent = `Recipe: ${recipe.name}
Yield: ${recipe.yield_quantity} ${recipe.yield_unit}

Ingredients:
${lines}

Method:
${recipe.instructions || "(none provided)"}`;

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: userContent }],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
