import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const { latestMessage, currentSnapshot } = await req.json();

  const snapshotContext = currentSnapshot
    ? `Current snapshot:\n${JSON.stringify(currentSnapshot, null, 2)}\n\nUpdate it based on the new message. Keep existing fields unless the new message contradicts or refines them.`
    : "No existing snapshot. Extract everything you can from this message.";

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    tools: [
      {
        name: "update_dish_snapshot",
        description: "Update the dish snapshot with information from the latest evaluation message",
        input_schema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "Concise dish name" },
            course_type: {
              type: "string",
              enum: ["appetizer", "main", "dessert", "side", "snack", "beverage"],
            },
            hero_ingredient: { type: "string" },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description: "Flat list of canonical ingredient names as commonly known in cooking (e.g. 'duck', 'miso', 'shaoxing rice wine', 'fish sauce', 'soy sauce'). Keep recognized multi-word ingredient names intact. Drop cooking preparations and technique adjectives (e.g. 'pan-seared duck breast' → 'duck', but 'shaoxing rice wine' stays as-is).",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "3-6 descriptive tags",
            },
            components: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string", enum: ["hero", "supporting", "accent"] },
                  delivery: { type: "string" },
                  intensity: { type: "string", enum: ["whisper", "moderate", "bold", "dominant"] },
                },
                required: ["name", "role", "delivery", "intensity"],
              },
            },
            technique_notes: { type: "string" },
          },
          required: ["hero_ingredient", "components"],
        },
      },
    ],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `${snapshotContext}\n\nLatest evaluation:\n${latestMessage}`,
      },
    ],
  });

  const toolUse = result.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Summarization failed" }, { status: 500 });
  }

  return NextResponse.json(toolUse.input);
}
