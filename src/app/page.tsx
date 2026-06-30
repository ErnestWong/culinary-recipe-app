"use client";

import { useState } from "react";
import Chat from "@/components/Chat";
import RecipeLibrary from "@/components/RecipeLibrary";
import SyncStatus from "@/components/SyncStatus";

type Tab = "chat" | "library";

export default function Home() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="flex flex-col h-screen bg-white">
      <nav className="border-b px-6 flex items-center gap-6">
        <button
          onClick={() => setTab("chat")}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === "chat"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-400 hover:text-gray-600"
          }`}
        >
          Capture
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
        <div className="ml-auto">
          <SyncStatus />
        </div>
      </nav>

      {tab === "chat" ? <Chat onSaved={() => setTab("library")} /> : <RecipeLibrary />}
    </div>
  );
}
