// Хранилище гардероба прямо в браузере (IndexedDB): вещи, образы, типаж и фото.
// Данные живут на этом устройстве; для переноса есть экспорт и импорт копии.

const DB_NAME = "cherry-wardrobe";
const STORES = ["items", "outfits", "kv", "photos"];

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("outfits")) db.createObjectStore("outfits", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const out = await fn(t.objectStore(store));
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out;
}

export const byNewest = (a, b) => (b.created_at || 0) - (a.created_at || 0);

export const store = {
  all: (s) => tx(s, "readonly", (o) => req(o.getAll())),
  put: (s, v, key) => tx(s, "readwrite", (o) => req(key === undefined ? o.put(v) : o.put(v, key))),
  get: (s, key) => tx(s, "readonly", (o) => req(o.get(key))),
  del: (s, key) => tx(s, "readwrite", (o) => req(o.delete(key))),
  clearAll: async () => { for (const s of STORES) await tx(s, "readwrite", (o) => req(o.clear())); },
};

// Просим браузер не удалять данные при нехватке места (где это поддерживается).
export function persist() {
  try { navigator.storage?.persist?.(); } catch {}
}

function blobToB64(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
}
async function b64ToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

export async function exportAll() {
  const [items, outfits, profile] = await Promise.all([store.all("items"), store.all("outfits"), store.get("kv", "profile")]);
  const photos = {};
  for (const it of items) if (it.photo_path) {
    const b = await store.get("photos", it.photo_path);
    if (b) photos[it.photo_path] = await blobToB64(b);
  }
  return { app: "cherry-wardrobe", version: 1, exported_at: new Date().toISOString(), items, outfits, profile: profile || null, photos };
}

export async function importAll(data) {
  if (!data || data.app !== "cherry-wardrobe" || !Array.isArray(data.items)) throw new Error("Это не копия гардероба.");
  await store.clearAll();
  for (const it of data.items) await store.put("items", it);
  for (const o of data.outfits || []) await store.put("outfits", o);
  if (data.profile) await store.put("kv", data.profile, "profile");
  for (const [k, v] of Object.entries(data.photos || {}))
    if (typeof v === "string" && v.startsWith("data:image/")) await store.put("photos", await b64ToBlob(v), k);
}
