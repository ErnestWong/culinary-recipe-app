"use client";

import { useState } from "react";
import Chat from "@/components/Chat";
import RecipeLibrary from "@/components/RecipeLibrary";

type Tab = "chat" | "library";

export default function Home() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="flex flex-col h-screen bg-white">
      <nav className="border-b px-6 flex gap-6">
        <button
          onClick={() => setTab("chat")}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === "chat"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-400 hover:text-gray-600"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setTab("library")}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === "library"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-400 hover:text-gray-600"
          }`}
        >
          Recipes
        </button>
      </nav>

      {tab === "chat" ? <Chat /> : <RecipeLibrary />}
    </div>
  );
}
