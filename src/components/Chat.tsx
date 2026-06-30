"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createClient } from "@/lib/supabase/client";
import { createDish, saveDishVersion, listDishes } from "@/lib/dishes";
import type { CourseType, RecipeComponent, Dish } from "@/lib/types";

interface DishSnapshot {
  name?: string;
  course_type?: CourseType;
  hero_ingredient?: string;
  ingredients: string[];
  tags: string[];
  components: RecipeComponent[];
  technique_notes?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
}

const SESSION_KEY = "culinary-session-id";
const SNAPSHOT_KEY = "culinary-dish-snapshot";

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastUsage, setLastUsage] = useState<Usage | null>(null);
  const [sessionSpend, setSessionSpend] = useState(0);
  const [lifetimeSpend, setLifetimeSpend] = useState(() => {
    if (typeof window === "undefined") return 0;
    return parseFloat(localStorage.getItem("culinary-lifetime-spend") ?? "0");
  });
  const [showSaveDish, setShowSaveDish] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [saveMode, setSaveMode] = useState<"new" | "version">("new");
  const [existingDishes, setExistingDishes] = useState<Dish[]>([]);
  const [selectedDishId, setSelectedDishId] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [dishForm, setDishForm] = useState({ name: "", course_type: "" as CourseType | "", hero_ingredient: "", tags: [] as string[] });
  const [dishSnapshot, setDishSnapshot] = useState<DishSnapshot | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SNAPSHOT_KEY);
      if (saved) setDishSnapshot(JSON.parse(saved));
    } catch {}
  }, []);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [availableIngredients, setAvailableIngredients] = useState<string[]>([]);
  const [selectedIngredients, setSelectedIngredients] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load existing session on mount
  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_KEY);
    if (!savedId) return;
    sessionIdRef.current = savedId;

    supabase
      .from("messages")
      .select("role, content")
      .eq("session_id", savedId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) setMessages(data as Message[]);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getOrCreateSession(): Promise<string> {
    if (sessionIdRef.current) return sessionIdRef.current;

    const { data, error } = await supabase
      .from("sessions")
      .insert({})
      .select("id")
      .single();

    if (error || !data) throw new Error("Failed to create session");

    sessionIdRef.current = data.id;
    localStorage.setItem(SESSION_KEY, data.id);
    return data.id;
  }

  const CLEAR_INTENTS = /\b(clear|reset|start over|new dish|new session|wipe|forget|fresh start|clear history|clear chat)\b/i;

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (CLEAR_INTENTS.test(input.trim())) {
      const userText = input.trim();
      setInput("");
      await clearSession();
      setMessages([
        { role: "user", content: userText },
        { role: "assistant", content: "Done — history cleared. What dish do you want to work on?" },
      ]);
      return;
    }

    const userMessage: Message = { role: "user", content: input.trim() };
    const history = [...messages, userMessage];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setIsLoading(true);

    try {
      const sessionId = await getOrCreateSession();

      await supabase.from("messages").insert({
        session_id: sessionId,
        role: "user",
        content: userMessage.content,
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok) throw new Error(await response.text());

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const raw = decoder.decode(value);

        const nullIdx = raw.indexOf("\x00");
        if (nullIdx !== -1) {
          const text = raw.slice(0, nullIdx);
          const usageJson = raw.slice(nullIdx + 1);
          if (text) {
            assistantContent += text;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              return [...prev.slice(0, -1), { ...last, content: last.content + text }];
            });
          }
          try {
            const u: Usage = JSON.parse(usageJson);
            setLastUsage(u);
            setSessionSpend((s) => s + u.cost_usd);
            setLifetimeSpend((prev) => {
              const next = prev + u.cost_usd;
              localStorage.setItem("culinary-lifetime-spend", next.toString());
              return next;
            });
          } catch {}
        } else {
          assistantContent += raw;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, content: last.content + raw }];
          });
        }
      }

      await supabase.from("messages").insert({
        session_id: sessionId,
        role: "assistant",
        content: assistantContent,
      });

      // Background snapshot update — no await, zero impact on UX
      fetch("/api/summarize-dish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          latestMessage: assistantContent,
          currentSnapshot: dishSnapshot,
        }),
      })
        .then((r) => r.json())
        .then((snap) => {
          if (snap?.error) console.error("[summarize-dish]", snap.error);
          else {
            setDishSnapshot(snap);
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
          }
        })
        .catch((e) => console.error("[summarize-dish]", e));
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  async function saveDish(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    const recipe = {
      components: dishSnapshot?.components ?? [],
      technique_notes: dishSnapshot?.technique_notes ?? "",
    };
    try {
      if (saveMode === "version" && selectedDishId) {
        await saveDishVersion({
          dish_id: selectedDishId,
          recipe,
          commit_message: commitMessage.trim() || undefined,
        });
      } else {
        if (!dishForm.name.trim()) return;
        await createDish({
          name: dishForm.name.trim(),
          course_type: dishForm.course_type || undefined,
          hero_ingredient: dishForm.hero_ingredient.trim() || undefined,
          recipe,
          commit_message: "Initial save",
          tags: dishForm.tags,
        });
      }
      setShowSaveDish(false);
      setDishForm({ name: "", course_type: "", hero_ingredient: "", tags: [] });
      setAvailableTags([]);
      setAvailableIngredients([]);
      setSelectedIngredients([]);
      setSaveMode("new");
      setSelectedDishId("");
      setCommitMessage("");
    } finally {
      setIsSaving(false);
    }
  }

  async function clearSession() {
    const sessionId = sessionIdRef.current;
    if (sessionId) {
      await supabase.from("sessions").delete().eq("id", sessionId);
    }
    sessionIdRef.current = null;
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SNAPSHOT_KEY);
    setMessages([]);
    setLastUsage(null);
    setSessionSpend(0);
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="px-6 py-3 flex items-center justify-end min-h-[44px]">
        <div className="flex items-center gap-3">
          {messages.length > 0 && <button
              onClick={async () => {
              setShowSaveDish(true);
              listDishes().then((d) => setExistingDishes(d));

              let snap = dishSnapshot;

              // Fallback: extract on-demand if no snapshot yet
              if (!snap) {
                setIsExtracting(true);
                try {
                  const res = await fetch("/api/extract-dish", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages }),
                  });
                  if (res.ok) {
                    snap = await res.json();
                    if (snap) {
                      setDishSnapshot(snap);
                      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
                    }
                  }
                } catch (e) {
                  console.error("[extract-dish]", e);
                } finally {
                  setIsExtracting(false);
                }
              }

              const tags = snap?.tags ?? [];
              const ingredients = snap?.ingredients ?? [];
              setAvailableTags(tags);
              setAvailableIngredients(ingredients);
              setSelectedIngredients(ingredients);
              setDishForm({
                name: snap?.name ?? "",
                course_type: snap?.course_type ?? "",
                hero_ingredient: snap?.hero_ingredient ?? "",
                tags,
              });
            }}
              className="text-xs font-medium text-gray-900 border border-gray-300 rounded-full px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              Save dish
            </button>
          }
          <button
            onClick={clearSession}
            className="text-xs font-medium text-gray-500 border border-gray-200 rounded-full px-3 py-1.5 hover:bg-gray-50 transition-colors"
          >
            New dish
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-sm">
              Ask about recipes, techniques, substitutions, or flavor development.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "max-w-[75%] bg-gray-900 text-white whitespace-pre-wrap"
                  : "w-full max-w-[85%] bg-gray-100 text-gray-900"
              }`}
            >
              {msg.role === "user" ? (
                msg.content
              ) : msg.content ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h2: ({ children }) => <h2 className="text-base font-bold mt-4 mb-1 first:mt-0">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-0.5">{children}</h3>,
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
                    li: ({ children }) => <li>{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    code: ({ children }) => <code className="bg-gray-200 rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                    pre: ({ children }) => <pre className="bg-gray-200 rounded p-3 text-xs font-mono overflow-x-auto mb-2">{children}</pre>,
                    table: ({ children }) => <table className="w-full text-xs border-collapse mb-2">{children}</table>,
                    th: ({ children }) => <th className="text-left border border-gray-300 px-2 py-1 bg-gray-200 font-semibold">{children}</th>,
                    td: ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
                    hr: () => <hr className="border-gray-300 my-3" />,
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              ) : isLoading && i === messages.length - 1 ? (
                <span className="inline-flex gap-1">
                  <span className="animate-bounce">·</span>
                  <span className="animate-bounce [animation-delay:150ms]">·</span>
                  <span className="animate-bounce [animation-delay:300ms]">·</span>
                </span>
              ) : null}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {lastUsage && (
        <div className="border-t px-6 py-2 flex gap-4 text-xs text-gray-400 font-mono">
          <span>in {lastUsage.input_tokens.toLocaleString()}</span>
          <span>out {lastUsage.output_tokens.toLocaleString()}</span>
          {lastUsage.cache_read_tokens > 0 && (
            <span className="text-green-500">cache hit {lastUsage.cache_read_tokens.toLocaleString()}</span>
          )}
          {lastUsage.cache_write_tokens > 0 && (
            <span className="text-blue-400">cache write {lastUsage.cache_write_tokens.toLocaleString()}</span>
          )}
          <span className="ml-auto flex gap-3">
            <span>${lastUsage.cost_usd.toFixed(5)}</span>
            <span className="text-gray-300">|</span>
            <span>session ${sessionSpend.toFixed(4)}</span>
            <span className="text-gray-300">|</span>
            <span>lifetime ${lifetimeSpend.toFixed(4)}</span>
          </span>
        </div>
      )}

      {showSaveDish && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <form
            onSubmit={saveDish}
            className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Save dish</h2>
              {isExtracting && <span className="text-xs text-gray-400">Extracting…</span>}
            </div>

            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              <button
                type="button"
                onClick={() => setSaveMode("new")}
                className={`flex-1 py-2 transition-colors ${saveMode === "new" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"}`}
              >
                New dish
              </button>
              <button
                type="button"
                onClick={() => setSaveMode("version")}
                className={`flex-1 py-2 transition-colors ${saveMode === "version" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"}`}
              >
                New version
              </button>
            </div>

            {saveMode === "version" ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Dish *</label>
                  <select
                    required
                    value={selectedDishId}
                    onChange={(e) => setSelectedDishId(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400 bg-white"
                  >
                    <option value="">— select dish —</option>
                    {existingDishes.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">What changed?</label>
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="e.g. Swapped cream for crème fraîche"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
                  />
                </div>
              </>
            ) : (
              <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Name *</label>
              <input
                autoFocus
                required
                value={dishForm.name}
                onChange={(e) => setDishForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Duck with miso brown butter"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Course</label>
              <select
                value={dishForm.course_type}
                onChange={(e) => setDishForm((f) => ({ ...f, course_type: e.target.value as CourseType | "" }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400 bg-white"
              >
                <option value="">— select —</option>
                <option value="appetizer">Appetizer</option>
                <option value="main">Main</option>
                <option value="dessert">Dessert</option>
                <option value="side">Side</option>
                <option value="snack">Snack</option>
                <option value="beverage">Beverage</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Hero ingredient</label>
              <input
                value={dishForm.hero_ingredient}
                onChange={(e) => setDishForm((f) => ({ ...f, hero_ingredient: e.target.value }))}
                placeholder="e.g. duck breast"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-400"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-500">Ingredients</label>
              {availableIngredients.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {availableIngredients.map((ing) => {
                    const selected = selectedIngredients.includes(ing);
                    return (
                      <button
                        key={ing}
                        type="button"
                        onClick={() =>
                          setSelectedIngredients((prev) =>
                            selected ? prev.filter((i) => i !== ing) : [...prev, ing]
                          )
                        }
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                          selected
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-400 border-gray-200"
                        }`}
                      >
                        {ing}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No ingredients extracted</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs text-gray-500">Tags</label>
              {availableTags.length > 0 ? (
                <div className="flex gap-1.5 flex-wrap">
                  {availableTags.map((tag) => {
                    const selected = dishForm.tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setDishForm((f) => ({
                            ...f,
                            tags: selected
                              ? f.tags.filter((t) => t !== tag)
                              : [...f.tags, tag],
                          }))
                        }
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                          selected
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-400 border-gray-200"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No tags extracted</p>
              )}
            </div>
            </>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowSaveDish(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || (saveMode === "new" ? !dishForm.name.trim() : !selectedDishId)}
                className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}

      <form onSubmit={sendMessage} className="border-t px-6 py-4 flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything culinary…"
          disabled={isLoading}
          className="flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-400 focus:bg-white focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
