import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const { messages } = await req.json();

  // Strip user messages — all the analysis is in assistant responses
  const assistantContent = messages
    .filter((m: { role: string; content: string }) => m.role === "assistant")
    .map((m: { content: string }) => m.content)
    .join("\n\n---\n\n");

  if (!assistantContent.trim()) {
    return NextResponse.json({ error: "No assistant messages to extract from" }, { status: 400 });
  }

  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    tools: [
      {
        name: "extract_dish",
        description: "Extract structured dish information from a culinary evaluation conversation",
        input_schema: {
          type: "object" as const,
          properties: {
            name: {
              type: "string",
              description: "A concise dish name (e.g. 'Pan-seared duck with miso brown butter')",
            },
            course_type: {
              type: "string",
              enum: ["appetizer", "main", "dessert", "side", "snack", "beverage"],
              description: "The course type",
            },
            hero_ingredient: {
              type: "string",
              description: "The primary hero ingredient (e.g. 'duck breast')",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "3-6 descriptive tags (flavor profile, cuisine, technique, etc.)",
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
              description: "All dish components from the evaluation",
            },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description: "Flat list of canonical ingredient names as commonly known in cooking (e.g. 'duck', 'miso', 'shaoxing rice wine', 'fish sauce', 'soy sauce'). Keep recognized multi-word ingredient names intact. Drop cooking preparations and technique adjectives (e.g. 'pan-seared duck breast' → 'duck', but 'shaoxing rice wine' stays as-is).",
            },
            technique_notes: {
              type: "string",
              description: "Key technique notes from the conversation",
            },
          },
          required: ["name", "hero_ingredient", "components"],
        },
      },
    ],
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: `Extract the dish information from these culinary evaluation notes:\n\n${assistantContent}`,
      },
    ],
  });

  const toolUse = result.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Extraction failed" }, { status: 500 });
  }

  return NextResponse.json(toolUse.input);
}
