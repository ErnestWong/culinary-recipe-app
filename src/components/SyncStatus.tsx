"use client";

import { useEffect, useState } from "react";
import { pendingWrites } from "@/lib/db";

// Shows online/offline state and how many local writes are queued in the outbox.
// Sync push isn't wired to a server yet (local-first V0), so a non-zero pending
// count simply reflects everything written on this device.
export default function SyncStatus() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    let active = true;
    const refresh = () => pendingWrites().then((n) => active && setPending(n)).catch(() => {});
    refresh();
    const interval = setInterval(refresh, 3000);

    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-gray-300"}`}
        aria-hidden
      />
      <span className="text-gray-500">{online ? "Online" : "Offline"}</span>
      <span className="text-gray-300">·</span>
      <span className="text-gray-400" title="Local writes waiting to sync">
        {pending === 0 ? "All synced" : `${pending} queued`}
      </span>
    </div>
  );
}
