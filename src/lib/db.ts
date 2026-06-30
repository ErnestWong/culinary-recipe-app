// Offline-first local store backed by IndexedDB (browser only).
//
// Every mutating write also appends an entry to the `outbox` store, tagged with
// a timestamp and this device's id. A future sync layer drains the outbox to the
// server whenever wifi is available; for now the queue simply accumulates and
// the UI reports how many writes are pending (see SyncStatus).

import type { OutboxEntry, OutboxOp } from "./types";

const DB_NAME = "culinary";
const DB_VERSION = 1;

// One object store per schema table, keyed by `id`.
export const STORES = [
  "organizations",
  "workspaces",
  "users",
  "workspace_users",
  "clients",
  "ingredients",
  "recipes",
  "recipe_versions",
  "recipe_ingredient_lines",
  "recipe_shares",
  "prep_lists",
  "prep_list_items",
  "prep_task_completions",
] as const;

export type StoreName = (typeof STORES)[number];

// Secondary indexes we query by.
const INDEXES: Partial<Record<StoreName, Record<string, string>>> = {
  workspace_users: { user_id: "user_id", workspace_id: "workspace_id" },
  ingredients: { workspace_id: "workspace_id" },
  recipes: { workspace_id: "workspace_id" },
  recipe_versions: { recipe_id: "recipe_id" },
  recipe_ingredient_lines: { recipe_version_id: "recipe_version_id" },
  prep_lists: { workspace_id: "workspace_id" },
  prep_list_items: { prep_list_id: "prep_list_id" },
  prep_task_completions: { prep_list_item_id: "prep_list_item_id" },
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath: "id" });
          for (const [name, keyPath] of Object.entries(INDEXES[store] ?? {})) {
            os.createIndex(name, keyPath, { unique: false });
          }
        }
      }
      if (!db.objectStoreNames.contains("outbox")) {
        const ob = db.createObjectStore("outbox", { keyPath: "id" });
        ob.createIndex("synced_at", "synced_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// --- device identity ---

const DEVICE_KEY = "culinary-device-id";

export function deviceId(): string {
  if (typeof localStorage === "undefined") return "server";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// --- reads ---

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store, "readonly");
  return reqResult(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction(store, "readonly");
  return reqResult(tx.objectStore(store).get(id) as IDBRequest<T | undefined>);
}

export async function getBy<T>(store: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store, "readonly");
  return reqResult(tx.objectStore(store).index(index).getAll(value) as IDBRequest<T[]>);
}

// --- writes (atomically enqueued to the outbox) ---

export async function put<T extends { id: string }>(store: StoreName, record: T): Promise<T> {
  const db = await openDB();
  const tx = db.transaction([store, "outbox"], "readwrite");
  tx.objectStore(store).put(record);
  tx.objectStore("outbox").put(outboxEntry(store, "put", record.id, record));
  await txComplete(tx);
  return record;
}

export async function putMany<T extends { id: string }>(store: StoreName, records: T[]): Promise<void> {
  if (records.length === 0) return;
  const db = await openDB();
  const tx = db.transaction([store, "outbox"], "readwrite");
  const os = tx.objectStore(store);
  const ob = tx.objectStore("outbox");
  for (const record of records) {
    os.put(record);
    ob.put(outboxEntry(store, "put", record.id, record));
  }
  await txComplete(tx);
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([store, "outbox"], "readwrite");
  tx.objectStore(store).delete(id);
  tx.objectStore("outbox").put(outboxEntry(store, "delete", id, null));
  await txComplete(tx);
}

function outboxEntry(table: string, op: OutboxOp, recordId: string, payload: unknown): OutboxEntry {
  return {
    id: crypto.randomUUID(),
    table,
    op,
    record_id: recordId,
    payload,
    timestamp: new Date().toISOString(),
    device_id: deviceId(),
    synced_at: null,
  };
}

// --- outbox / sync status ---

export async function pendingWrites(): Promise<number> {
  const all = await getAll<OutboxEntry>("outbox" as StoreName);
  return all.filter((e) => e.synced_at === null).length;
}
