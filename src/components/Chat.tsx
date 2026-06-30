"use client";

import { useEffect, useRef, useState } from "react";
import RecipeDraft from "./RecipeDraft";
import { saveParsedRecipe } from "@/lib/repo";
import type { ParsedRecipe } from "@/lib/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const PLACEHOLDER =
  "Paste or type a recipe — ingredients, quantities, and method. I'll structure it so you can edit and save it.";

// Chat-first recipe capture. Today the user types/pastes a recipe; the AI parses
// it into a structured, editable draft (photo + voice capture come later).
export default function Chat({ onSaved }: { onSaved?: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [draft, setDraft] = useState<ParsedRecipe | null>(null);
  const [saving, setSaving] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isParsing) return;

    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setIsParsing(true);
    setDraft(null);

    try {
      const res = await fetch("/api/parse-recipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const msg =
          res.status === 422
            ? "I couldn't find a recipe in that. Try including ingredients with quantities."
            : "Something went wrong parsing that. Please try again.";
        setMessages((m) => [...m, { role: "assistant", content: msg }]);
        return;
      }
      const parsed: ParsedRecipe = await res.json();
      setDraft(parsed);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Here's **${parsed.name}** — review and edit, then save it.` },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error. Please try again." }]);
    } finally {
      setIsParsing(false);
      inputRef.current?.focus();
    }
  }

  async function confirmSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await saveParsedRecipe(draft);
      setDraft(null);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Saved **${saved.name}** to your recipes. ✓` },
      ]);
      onSaved?.();
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't save that locally. Please try again." }]);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !draft && (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-sm max-w-sm text-center">{PLACEHOLDER}</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "max-w-[75%] bg-gray-900 text-white"
                  : "max-w-[85%] bg-gray-100 text-gray-900"
              }`}
              dangerouslySetInnerHTML={{ __html: renderInline(msg.content) }}
            />
          </div>
        ))}

        {isParsing && (
          <div className="flex justify-start">
            <div className="rounded-2xl px-4 py-2.5 bg-gray-100 text-gray-900">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">·</span>
                <span className="animate-bounce [animation-delay:150ms]">·</span>
                <span className="animate-bounce [animation-delay:300ms]">·</span>
              </span>
            </div>
          </div>
        )}

        {draft && (
          <RecipeDraft
            draft={draft}
            onChange={setDraft}
            onConfirm={confirmSave}
            onCancel={() => {
              setDraft(null);
              setMessages((m) => [...m, { role: "assistant", content: "Discarded." }]);
            }}
            saving={saving}
          />
        )}

        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="border-t px-6 py-4 flex gap-3 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Paste a recipe…  (⌘/Ctrl+Enter to send)"
          disabled={isParsing}
          className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none disabled:opacity-50 max-h-40"
        />
        <button
          type="submit"
          disabled={isParsing || !input.trim()}
          className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Parse
        </button>
      </form>
    </div>
  );
}

// Minimal inline markdown: **bold** only, with HTML escaped first.
function renderInline(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
