import { store, byNewest, persist, exportAll, importAll } from "./db.js";
import { CATS, COLORS, STYLES, SEASONS, SEASON_TYPES, SCALES } from "./catalog.js";
import { PINS } from "./pins.js";
import { weatherText, weatherNeeds, scoreOutfit, suggestOutfits, countCombos, dayKey, wearStats, wardrobeGaps, CAPSULE_PRESETS, buildCapsule, photoQuality, DRAPE_ROUNDS, drapeSummary } from "./logic.js";
import { QUIZ } from "./bridge.js";
import { SEASON_KB, KIBBE_KB, ARCHETYPES } from "./knowledge.js";
import { CHAT_URL, MARK_KINDS, sampleable, analyzePrompt, parseAnalysis, tagPrompt, parseTag, outfitsPrompt, parseOutfits, SHOPS, lookPrompt, parseLook, lookMorePrompt, parseLookMore } from "./bridge.js";

/* ---------- справочники ---------- */
const CATT = Object.fromEntries(CATS.map((c) => [c.id, c.t]));
const COL = Object.fromEntries(COLORS.map((c) => [c[0], { t: c[1], hex: c[2], base: c[3], kind: c[3] }]));
const STT = Object.fromEntries(STYLES);
const LIGHT = new Set(["milk", "white", "silver", "beige", "grey", "blue", "lavender", "pink", "gold", "camel"]);

function applyKinds(an) {
  const avoid = new Set(an?.avoid || []);
  for (const k in COL) COL[k].kind = avoid.has(k) ? "avoid" : COL[k].base;
}

/* ---------- состояние ---------- */
const EMPTY_BUILD = () => ({ outer: null, top: null, bottom: null, dress: null, shoes: null, acc: [] });
const S = {
  tab: "today", loaded: false, importConfirm: null, br: null,
  settings: {}, weather: null, wErr: null, wBusy: false, seed: 1,
  wears: [], wishlist: [], capsules: [], calMonth: dayKey().slice(0, 7), calDay: null,
  cap: { preset: "week", season: "any", styles: [] }, capResult: null,
  looks: [], lookImg: null, lookRes: null,
  anMode: "accurate", quiz: {}, drape: null,
  items: [], outfits: [], profile: null, urls: {},
  filter: "all", edit: null, draft: null, delConfirm: null, saving: false, formErr: null,
  build: EMPTY_BUILD(), activeSlot: "top", fwOnly: true,
  req: { occasion: "", weather: "", wish: "" },
  ai: { out: null },
  skipOnb: false, outDel: null, selfies: [], viewPhoto: 0,
};
try {
  S.tab = sessionStorage.getItem("wd-tab") || "today";
  S.skipOnb = sessionStorage.getItem("wd-skip") === "1";
} catch {}


const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}
const byId = (id) => S.items.find((i) => i.id === id) || null;
const analysis = () => S.profile?.analysis || null;

function tile(it) {
  if (!it) return '<div class="ph"></div>';
  const c = COL[it.color] || { hex: "#ddd" };
  const u = it.photo_path ? S.urls[it.photo_path] : null;
  return '<div class="ph">' + (u
    ? `<img src="${esc(u)}" alt="" loading="lazy">`
    : `<div class="swatch" style="background:${c.hex};color:${LIGHT.has(it.color) ? "#1d1a1b" : "#fff"}">${esc(it.name)}</div>`) + "</div>";
}

/* ---------- мост к Claude через чат ---------- */
// kind: analyze | tag | outfits. Запрос копируется, человек отправляет его в claude.ai,
// а ответ вставляет обратно.
const HINTS = {
  analyze: "прикрепи 2–5 своих фото (лицо при дневном свете, без фильтров)",
  analyzeN: (n) => `прикрепи эти же ${n} фото в том же порядке, как пронумерованы выше`,
  tag: "прикрепи фото этой вещи",
  outfits: "фото прикреплять не нужно",
  look: "<b>включи веб-поиск</b> (кнопка поиска или «Инструменты» в поле ввода), прикрепи эту картинку-коллаж",
  lookmore: "вернись в <b>тот же чат</b>, где разбирала коллаж, проверь, что веб-поиск включён,",
};
function openBridge(kind, prompt, extra = {}) {
  S.br = { kind, prompt, answer: "", err: null, ...extra };
  render();
}
function bridgeBox(kind) {
  const b = S.br;
  if (!b || b.kind !== kind) return "";
  return `<div class="panel stack bridge" style="gap:12px">
    <ol class="steps">
      <li><div class="row"><span>Скопируй запрос</span><button type="button" class="btn cherry" data-act="br-copy">Скопировать запрос</button></div></li>
      <li>Открой <a href="${CHAT_URL}" target="_blank" rel="noopener">claude.ai</a> в новой вкладке, ${kind === "analyze" && b.n ? HINTS.analyzeN(b.n) : HINTS[kind]}, вставь запрос и отправь.</li>
      <li><span>Скопируй ответ Claude целиком и вставь сюда</span>
        <textarea id="br-answer" class="f" rows="5" placeholder="{ ... }">${esc(b.answer)}</textarea>
        <div class="row"><button type="button" class="btn" data-act="br-apply">Готово</button><button type="button" class="btn ghost" data-act="br-close">Отмена</button></div></li>
    </ol>
    ${b.err ? `<div class="notice err">${esc(b.err)}</div>` : ""}
    <details><summary class="small muted" style="cursor:pointer">Показать текст запроса</summary><textarea id="br-prompt" class="f" rows="8" readonly style="margin-top:8px">${esc(b.prompt)}</textarea></details>
  </div>`;
}
async function copyPrompt() {
  const b = S.br; if (!b) return;
  try { await navigator.clipboard.writeText(b.prompt); toast("Запрос скопирован. Теперь открой claude.ai"); }
  catch {
    const ta = $("br-prompt");
    if (ta) { ta.closest("details").open = true; ta.focus(); ta.select(); try { document.execCommand("copy"); toast("Запрос скопирован"); } catch { toast("Выдели текст запроса и скопируй вручную"); } }
  }
}
async function applyAnswer() {
  const b = S.br; if (!b) return;
  b.answer = $("br-answer")?.value || b.answer;
  try {
    if (b.kind === "analyze") {
      const an = parseAnalysis(b.answer, b.n || 0);
      const hadNew = S.selfies.length > 0;
      const photos = await saveSelfies(an);
      await setProfile({ analysis: an, text: null, photos, drape: hadNew ? null : S.profile?.drape || null });
      S.br = null; S.tab = "profile"; S.viewPhoto = 0;
      try { sessionStorage.setItem("wd-tab", "profile"); } catch {}
      toast("Типаж определён"); render(); window.scrollTo(0, 0);
    } else if (b.kind === "tag") {
      readForm();
      Object.assign(S.draft, parseTag(b.answer));
      S.br = null; toast("Поля заполнены по фото, проверь их"); render();
    } else if (b.kind === "lookmore") {
      const upd = parseLookMore(b.answer, S.lookRes);
      S.lookRes = upd;
      if (upd.photoKey) { S.looks = S.looks.map((l) => (l.id === upd.id ? upd : l)); await saveKv("looks", S.looks); }
      S.br = null; toast("Товары добавлены"); render();
    } else if (b.kind === "look") {
      S.lookRes = { ...parseLook(b.answer), photoKey: null };
      S.br = null; render(); window.scrollTo(0, 0);
    } else if (b.kind === "outfits") {
      S.ai.out = parseOutfits(b.answer, b.map);
      S.br = null; render();
    }
  } catch (e) { b.err = e.message; render(); }
}
// Сохраняет загруженные фото типажа и снимает с них оттенки в точках меток.
async function saveSelfies(an) {
  if (!S.selfies.length) {
    // повторный разбор по уже сохранённым фото: оттенки снимаем с них
    const keys = S.profile?.photos || [];
    for (const m of an.markers) {
      const k = keys[m.photo - 1];
      if (k && sampleable(m.kind)) { try { const b = await store.get("photos", k); if (b) m.hex = await sampleAt(b, m.x, m.y); } catch {} }
    }
    return keys;
  }
  for (const m of an.markers) {
    const x = S.selfies[m.photo - 1];
    if (x && sampleable(m.kind)) { try { m.hex = await sampleAt(x.blob, m.x, m.y); } catch {} }
  }
  const stamp = Date.now();
  const keys = [];
  for (let i = 0; i < S.selfies.length; i++) { const k = `self-${stamp}-${i + 1}`; await store.put("photos", S.selfies[i].blob, k); keys.push(k); }
  for (const k of S.profile?.photos || []) { await store.del("photos", k).catch(() => {}); dropUrl(k); }
  S.selfies.forEach((x) => URL.revokeObjectURL(x.url));
  S.selfies = [];
  return keys;
}
async function sampleAt(blob, fx, fy) {
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement("canvas");
  cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext("2d");
  g.drawImage(bmp, 0, 0);
  const r = Math.max(2, Math.round(bmp.width / 100));
  const cx = Math.round(fx * bmp.width), cy = Math.round(fy * bmp.height);
  const d = g.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r + 1, 2 * r + 1).data;
  let R = 0, G = 0, B = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
  const h = (v) => Math.round(v / n).toString(16).padStart(2, "0");
  return "#" + h(R) + h(G) + h(B);
}
function analyzeCtx() {
  if (S.anMode !== "accurate") return {};
  return { quiz: S.quiz, quality: S.selfies.map((x) => (x.q?.flags || []).map((f) => f[1])), drape: S.profile?.drape || null };
}
function refreshAnalyzeBridge() {
  if (S.br?.kind === "analyze") { S.br.n = S.selfies.length; S.br.prompt = analyzePrompt(S.selfies.length, analyzeCtx()); }
}
async function qualityOf(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
  const g = cv.getContext("2d"); g.drawImage(bmp, 0, 0, cv.width, cv.height);
  const q = photoQuality(g.getImageData(0, 0, cv.width, cv.height).data, bmp.width, bmp.height);
  return q;
}
async function addSelfies(files) {
  const list = [...files].filter((f) => /^image\//.test(f.type)).slice(0, 5 - S.selfies.length);
  for (const f of list) {
    try {
      let q = null;
      try { q = await qualityOf(f); } catch {}
      const b = await downscale(f, 1200);
      S.selfies.push({ blob: b, url: URL.createObjectURL(b), q });
    } catch {}
  }
  refreshAnalyzeBridge(); render();
}
function selfieBlock() {
  return '<div class="selfies">' + S.selfies.map((x, i) => `<div class="selfie${S.anMode === "accurate" && x.q ? (x.q.ok ? " q-ok" : " q-warn") : ""}"><img src="${x.url}" alt="Фото ${i + 1}"><span class="num">${i + 1}</span>${S.anMode === "accurate" && x.q ? `<span class="qbadge" title="${esc(x.q.ok ? "Фото подходит" : x.q.flags.map((f) => f[1]).join("; "))}">${x.q.ok ? "✓" : "!"}</span>` : ""}<button type="button" class="rm" data-act="selfie-rm" data-i="${i}" aria-label="Убрать фото ${i + 1}">×</button></div>`).join("") +
    (S.selfies.length < 5 ? '<label class="selfie add" for="selfie-in">+ фото<br>лицо при дневном свете</label>' : "") + "</div>" +
    '<input class="sr" type="file" id="selfie-in" accept="image/jpeg,image/png,image/webp" multiple>';
}
function downscale(file, max = 1000) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(im.naturalWidth * s);
      cv.height = Math.round(im.naturalHeight * s);
      cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(u);
      cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.85);
    };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); };
    im.src = u;
  });
}

/* ---------- данные ---------- */
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
async function loadAll() {
  try {
    const [items, outfits, profile, settings, wears, wishlist, capsules, weather, looks, quiz] = await Promise.all([store.all("items"), store.all("outfits"), store.get("kv", "profile"),
      store.get("kv", "settings"), store.get("kv", "wears"), store.get("kv", "wishlist"), store.get("kv", "capsules"), store.get("kv", "weather"), store.get("kv", "looks"), store.get("kv", "quiz")]);
    S.items = items.sort(byNewest);
    S.outfits = outfits.sort(byNewest);
    S.profile = profile || null;
    S.settings = settings || {};
    S.wears = wears || [];
    S.wishlist = wishlist || [];
    S.capsules = capsules || [];
    S.weather = weather || null;
    S.looks = looks || [];
    S.quiz = quiz || {};
  } catch (e) {
    console.error(e);
    $("main").innerHTML = '<div class="notice err">Браузер не даёт сохранять данные на этом сайте (например, в режиме инкогнито). Открой сайт в обычном окне.</div>';
    return;
  }
  applyKinds(analysis());
  await photoUrls();
  S.loaded = true;
  render();
  refreshWeather();
}
async function photoUrls() {
  const keys = [...S.items.map((it) => it.photo_path), ...(S.profile?.photos || []), ...S.looks.map((l) => l.photoKey)];
  for (const k of keys) {
    if (!k || S.urls[k]) continue;
    const b = await store.get("photos", k);
    if (b) S.urls[k] = URL.createObjectURL(b);
  }
}
async function reloadItems() { S.items = (await store.all("items")).sort(byNewest); await photoUrls(); }
async function reloadOutfits() { S.outfits = (await store.all("outfits")).sort(byNewest); }
async function setProfile(p) { S.profile = p; await store.put("kv", p, "profile"); applyKinds(analysis()); await photoUrls(); }
function dropUrl(path) { if (path && S.urls[path]) { URL.revokeObjectURL(S.urls[path]); delete S.urls[path]; } }

/* ---------- вкладки ---------- */
function renderTabs() {
  const tabs = [["today", "Сегодня", null], ["wardrobe", "Мои вещи", S.items.length], ["builder", "Конструктор", null], ["outfits", "Образы", S.outfits.length], ["look", "Найти образ", S.looks.length || null], ["wish", "Вишлист", S.wishlist.filter((w) => !w.done).length || null], ["capsules", "Капсулы", S.capsules.length || null], ["stats", "Статистика", null], ["profile", "Мой типаж", null]];
  $("tabs").innerHTML = tabs.map((t) => `<button class="tab" role="tab" id="tab-${t[0]}" data-tab="${t[0]}" aria-selected="${S.tab === t[0]}">${t[1]}${t[2] != null ? `<span class="n">${t[2]}</span>` : ""}</button>`).join("");
}
function render() {
  renderTabs();
  const m = $("main");
  if (!S.loaded) { m.innerHTML = '<p class="muted">Открываю гардероб…</p>'; return; }
  if (!analysis() && !S.skipOnb && S.tab !== "profile") { m.innerHTML = viewOnboarding(); return; }
  if (S.tab === "wardrobe") m.innerHTML = S.edit ? viewForm() : viewWardrobe();
  else if (S.tab === "builder") m.innerHTML = viewBuilder();
  else if (S.tab === "outfits") m.innerHTML = viewOutfits();
  else if (S.tab === "today") m.innerHTML = viewToday();
  else if (S.tab === "capsules") m.innerHTML = viewCapsules();
  else if (S.tab === "look") m.innerHTML = viewShop();
  else if (S.tab === "wish") m.innerHTML = viewWishlist();
  else if (S.tab === "stats") m.innerHTML = viewStats();
  else m.innerHTML = viewProfile();
  if (S.tab === "look" && S.lookRes) buildCrops();
}

/* ---------- гардероб ---------- */
function viewWardrobe() {
  const list = S.items.filter((i) => S.filter === "all" || i.cat === S.filter);
  let h = `<div class="row between"><div class="stack" style="gap:2px"><h2>Мои вещи</h2><span class="muted small">${S.items.length} в гардеробе</span></div><button class="btn cherry" data-act="new">+ Добавить вещь</button></div>`;
  h += '<div class="catbar">' + [["all", "Все"], ...CATS.map((c) => [c.id, c.t])].map((c) => {
    const n = c[0] === "all" ? S.items.length : S.items.filter((i) => i.cat === c[0]).length;
    return `<button class="chip" data-filter="${c[0]}" aria-pressed="${S.filter === c[0]}">${c[1]} <span class="muted small">${n}</span></button>`;
  }).join("") + "</div>";
  if (!list.length) return h + '<div class="empty">Здесь пока пусто. Нажми «Добавить вещь» и загрузи фото. Название, категорию и цвет может заполнить Claude.</div>';
  return h + '<div class="grid">' + list.map((it) => {
    const c = COL[it.color] || { t: "", hex: "#ddd" };
    const badge = c.kind === "avoid" ? '<span class="badge warn">не твой цвет</span>' : "";
    return `<button class="card" data-edit="${esc(it.id)}">${tile(it).replace('<div class="ph">', '<div class="ph">' + badge)}<span class="meta"><b>${esc(it.name)}</b><span><i class="dot" style="background:${c.hex}"></i>${esc(c.t)} · ${esc(CATT[it.cat] || "")}</span></span></button>`;
  }).join("") + "</div>";
}
const blankDraft = () => ({ name: "", cat: "top", color: "black", seasons: ["fw"], styles: [], photo_path: null, file: null, preview: null, price: "" });
function viewForm() {
  const d = S.draft, isNew = S.edit === "new", c = COL[d.color] || {};
  const img = d.preview || (d.photo_path ? S.urls[d.photo_path] : null);
  return `<form class="form panel" id="item-form" autocomplete="off">
  <div class="row between"><h2>${isNew ? "Новая вещь" : "Редактировать вещь"}</h2><button type="button" class="btn ghost" data-act="cancel">Назад</button></div>
  <div class="fgrid"><div class="stack" style="gap:8px">
    <label class="drop" id="drop" for="f-photo">${img ? `<img src="${esc(img)}" alt="">` : "<span>Перетащи фото сюда<br>или нажми, чтобы выбрать</span>"}</label>
    <input class="sr" type="file" id="f-photo" accept="image/jpeg,image/png,image/webp">
    ${S.br?.kind === "tag" ? "" : '<button type="button" class="btn ghost" data-act="autotag">✦ Заполнить по фото через Claude</button>'}
  </div><div class="stack">
    ${bridgeBox("tag")}
    <label class="f">Название<input type="text" id="f-name" value="${esc(d.name)}" placeholder="Например: чёрная водолазка" maxlength="80"></label>
    <label class="f" style="max-width:220px">Цена, ₽ <span class="muted" style="font-weight:500">(необязательно, для цены за выход)</span><input type="text" inputmode="numeric" id="f-price" value="${esc(d.price ?? "")}" placeholder="например, 3500" maxlength="9"></label>
    <div class="row" style="gap:12px;align-items:end">
      <label class="f" style="flex:1;min-width:160px">Категория<select id="f-cat">${CATS.map((x) => `<option value="${x.id}"${d.cat === x.id ? " selected" : ""}>${x.t}</option>`).join("")}</select></label>
      <label class="f" style="flex:1;min-width:160px">Цвет<select id="f-color">${COLORS.map((x) => `<option value="${x[0]}"${d.color === x[0] ? " selected" : ""}>${x[1]}${COL[x[0]].kind === "avoid" ? " (не твой)" : ""}</option>`).join("")}</select></label>
    </div>
    ${c.kind === "avoid" ? `<div class="notice warn">${esc(c.t)} не входит в твою палитру. Носи такую вещь подальше от лица: обувь, низ, сумка.</div>` : ""}
    <div class="fieldset"><span>Сезон</span><div class="chips">${SEASONS.map((s) => `<button type="button" class="chip" data-season="${s[0]}" aria-pressed="${d.seasons.includes(s[0])}">${s[1]}</button>`).join("")}</div></div>
    <div class="fieldset"><span>Стиль</span><div class="chips">${STYLES.map((s) => `<button type="button" class="chip" data-style="${s[0]}" aria-pressed="${d.styles.includes(s[0])}">${s[1]}</button>`).join("")}</div></div>
  </div></div>
  <div class="row between" style="border-top:1px solid var(--line);padding-top:14px">
    ${isNew ? "<span></span>" : S.delConfirm === S.edit
      ? '<span class="row small">Удалить вещь насовсем? <button type="button" class="btn danger" data-act="del-yes">Да, удалить</button><button type="button" class="btn ghost" data-act="del-no">Отмена</button></span>'
      : '<button type="button" class="btn danger" data-act="del">Удалить</button>'}
    <button type="submit" class="btn cherry"${S.saving ? " disabled" : ""}>${S.saving ? "Сохраняю…" : "Сохранить"}</button>
  </div>
  ${S.formErr ? `<div class="notice err">${esc(S.formErr)}</div>` : ""}
  </form>`;
}
function readForm() {
  const d = S.draft; if (!d) return;
  if ($("f-name")) d.name = $("f-name").value;
  if ($("f-cat")) d.cat = $("f-cat").value;
  if ($("f-color")) d.color = $("f-color").value;
  if ($("f-price")) d.price = $("f-price").value;
}
async function setFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast("Нужна картинка: JPG, PNG или WebP"); return; }
  readForm();
  try {
    const b = await downscale(file);
    if (S.draft.preview) URL.revokeObjectURL(S.draft.preview);
    S.draft.file = b; S.draft.preview = URL.createObjectURL(b);
    render();
  } catch { toast("Не получилось открыть это фото"); }
}
async function saveItem() {
  readForm();
  const d = S.draft; S.formErr = null;
  if (!d.name.trim()) { S.formErr = "Добавь название вещи."; render(); return; }
  if (!d.seasons.length) d.seasons = ["fw", "ss"];
  S.saving = true; render();
  try {
    let photo_path = d.photo_path;
    if (d.file) {
      const path = newId();
      await store.put("photos", d.file, path);
      if (d.photo_path) { await store.del("photos", d.photo_path); dropUrl(d.photo_path); }
      photo_path = path;
    }
    const price = parseInt(String(d.price || "").replace(/\D/g, ""), 10);
    const row = { name: d.name.trim().slice(0, 80), cat: d.cat, color: d.color, seasons: d.seasons, styles: d.styles, photo_path, price: price > 0 ? price : null };
    const old = S.edit === "new" ? null : byId(S.edit);
    await store.put("items", { ...row, id: old ? old.id : newId(), created_at: old ? old.created_at : Date.now() });
    await reloadItems();
    toast(S.edit === "new" ? "Вещь добавлена" : "Сохранено");
    S.saving = false; closeForm();
  } catch (e) {
    console.error(e);
    S.saving = false; S.formErr = e?.name === "QuotaExceededError" ? "В браузере закончилось место. Удали ненужные вещи." : "Не получилось сохранить. Попробуй ещё раз."; render();
  }
}
function closeForm() {
  if (S.draft?.preview) URL.revokeObjectURL(S.draft.preview);
  S.edit = null; S.draft = null; S.delConfirm = null; S.formErr = null; if (S.br?.kind === "tag") S.br = null;
  render();
}
async function deleteItem(id) {
  const it = byId(id);
  try { await store.del("items", id); } catch { toast("Не получилось удалить"); return; }
  if (it?.photo_path) { store.del("photos", it.photo_path).catch(() => {}); dropUrl(it.photo_path); }
  await reloadItems();
  toast("Вещь удалена"); closeForm();
}
function autotag() { readForm(); openBridge("tag", tagPrompt()); }

/* ---------- конструктор ---------- */
const SLOTS = [["outer", "Верхняя одежда"], ["top", "Верх"], ["bottom", "Низ"], ["dress", "Платье"], ["shoes", "Обувь"], ["acc", "Аксессуары"]];
const pool = (cat) => S.items.filter((i) => i.cat === cat && (!S.fwOnly || (i.seasons || []).includes("fw")));
function outfitIds(b = S.build) { return [...["outer", "top", "bottom", "dress", "shoes"].map((k) => b[k]).filter(Boolean), ...(b.acc || [])]; }
function assess(ids) {
  const its = ids.map(byId).filter(Boolean), notes = [];
  if (!its.length) return notes;
  const acc = new Set(), avoid = [];
  its.forEach((i) => { const k = COL[i.color]?.kind; if (k === "accent") acc.add(i.color); if (k === "avoid") avoid.push(i); });
  const has = (c) => its.some((i) => i.cat === c);
  notes.push(has("dress") || (has("top") && has("bottom")) ? ["ok", "Комплект собран"] : ["warn", "Нужен верх и низ или платье"]);
  if (!has("shoes")) notes.push(["warn", "Нет обуви"]);
  if (acc.size === 0) notes.push(["warn", "Без цветового акцента"]);
  else if (acc.size <= 2) notes.push(["ok", acc.size === 1 ? "Один цветовой акцент" : "Два акцента, в меру"]);
  else notes.push(["bad", "Больше двух акцентов, образ пёстрый"]);
  avoid.forEach((i) => notes.push([["top", "outer", "dress"].includes(i.cat) ? "bad" : "warn", `${COL[i.color].t} у лица — не твой цвет`]));
  const st = {};
  its.forEach((i) => (i.styles || []).forEach((s) => (st[s] = (st[s] || 0) + 1)));
  const top = Object.keys(st).sort((a, b) => st[b] - st[a])[0];
  if (top && st[top] >= 2) notes.push(["ok", "Стиль: " + (STT[top] || top)]);
  return notes;
}
const pickRand = (a) => (a.length ? a[Math.floor(Math.random() * a.length)].id : null);
function autoBuild() {
  let best = null, bs = -1e9;
  for (let k = 0; k < 80; k++) {
    const useDress = pool("dress").length && (Math.random() < 0.35 || !pool("top").length || !pool("bottom").length);
    const b = { outer: Math.random() < 0.8 ? pickRand(pool("outer")) : null, top: useDress ? null : pickRand(pool("top")), bottom: useDress ? null : pickRand(pool("bottom")), dress: useDress ? pickRand(pool("dress")) : null, shoes: pickRand(pool("shoes")), acc: [] };
    const a = pool("acc");
    if (a.length) { b.acc = [pickRand(a)]; if (a.length > 1 && Math.random() < 0.4) { const x = pickRand(a); if (!b.acc.includes(x)) b.acc.push(x); } }
    const s = assess(outfitIds(b)).reduce((t, n) => t + (n[0] === "ok" ? 2 : n[0] === "warn" ? -1 : -4), 0) + Math.random() * 1.5;
    if (s > bs) { bs = s; best = b; }
  }
  if (best) { S.build = best; render(); }
}
function viewBuilder() {
  const b = S.build, ids = outfitIds(), usingDress = !!b.dress;
  const cell = (k, label, tall) => {
    const it = k === "acc" ? byId(b.acc[0]) : byId(b[k]);
    const extra = k === "acc" && b.acc.length > 1 ? " +" + (b.acc.length - 1) : "";
    return `<button class="slot${it ? " filled" : ""}${S.activeSlot === k ? " active" : ""}${tall ? " tall" : ""}" data-slot="${k}">${tile(it)}<span class="lbl"><span>${label}</span><b>${it ? esc(it.name) + extra : "—"}</b></span></button>`;
  };
  return `<div class="row between"><div class="stack" style="gap:2px"><h2>Конструктор образа</h2><span class="muted small">Выбери ячейку и вещь под ней, собери случайно или спроси стилиста</span></div>
    <div class="row"><button class="chip" data-act="fw" aria-pressed="${S.fwOnly}">только осень–зима</button><button class="btn ghost" data-act="shuffle">↻ Собрать случайно</button><button class="btn ghost" data-act="clear">Очистить</button></div></div>
  <div class="builder" style="margin-top:16px"><div class="stack">
    <div class="board">${cell("outer", "Верхняя", true)}${usingDress ? cell("dress", "Платье", true) : cell("top", "Верх") + cell("bottom", "Низ")}${cell("shoes", "Обувь")}${cell("acc", "Аксессуары")}</div>
    <div class="row">${usingDress ? '<button class="chip" data-act="no-dress">Вернуть верх и низ</button>' : `<button class="chip" data-slot="dress" aria-pressed="${S.activeSlot === "dress"}">Платье вместо верха и низа</button>`}</div>
    <div class="score">${assess(ids).map((n) => `<span class="pill${n[0] === "ok" ? "" : " " + n[0]}">${esc(n[1])}</span>`).join("")}</div>
    <div class="panel stack" style="gap:10px"><div class="row between"><h3>${esc((SLOTS.find((s) => s[0] === S.activeSlot) || [])[1] || "")}</h3><span class="muted small">${S.activeSlot === "acc" ? "можно до 3" : "нажми ещё раз, чтобы убрать"}</span></div>${viewPickers()}</div>
    <div class="row"><label class="f" style="flex:1;min-width:180px"><span class="sr">Название образа</span><input type="text" id="outfit-title" placeholder="Название образа, например «Пятница в городе»" maxlength="60"></label><button class="btn cherry" data-act="save-outfit"${ids.length < 2 ? " disabled" : ""}>Сохранить образ</button><button class="btn ghost" data-act="wear-build"${ids.length < 2 ? " disabled" : ""}>Надела сегодня</button></div>
  </div>${viewAI()}</div>`;
}
function viewPickers() {
  const k = S.activeSlot, list = pool(k);
  if (!list.length) return `<div class="empty small">В этой категории пока нет вещей${S.fwOnly ? " для осени–зимы" : ""}. <button class="btn ghost" style="padding:4px 10px;font-size:13px" data-act="goto-add" data-cat="${k}">Добавить</button></div>`;
  return '<div class="pickers">' + list.map((it) => {
    const on = k === "acc" ? S.build.acc.includes(it.id) : S.build[k] === it.id;
    return `<button class="pick" data-pick="${esc(it.id)}" aria-pressed="${on}">${tile(it)}<span class="t">${esc(it.name)}</span></button>`;
  }).join("") + "</div>";
}
function choose(id) {
  const k = S.activeSlot, b = S.build;
  if (k === "acc") { const i = b.acc.indexOf(id); if (i >= 0) b.acc.splice(i, 1); else { if (b.acc.length >= 3) b.acc.shift(); b.acc.push(id); } }
  else { b[k] = b[k] === id ? null : id; if (k === "dress" && b.dress) { b.top = null; b.bottom = null; } if ((k === "top" || k === "bottom") && b[k]) b.dress = null; }
  render();
}
async function saveOutfit(ids, title, why, source) {
  ids = ids.filter((x) => byId(x));
  if (ids.length < 2) { toast("Выбери хотя бы две вещи"); return; }
  try {
    await store.put("outfits", { id: newId(), items: ids, title: (title || "").trim().slice(0, 60) || "Образ от " + new Date().toLocaleDateString("ru-RU"), why: why || "", source, created_at: Date.now() });
  } catch { toast("Не получилось сохранить образ"); return; }
  await reloadOutfits(); renderTabs(); toast("Образ сохранён");
}
function tryOutfit(o) {
  const b = EMPTY_BUILD();
  o.items.forEach((id) => { const it = byId(id); if (!it) return; if (it.cat === "acc") { if (b.acc.length < 3) b.acc.push(id); } else if (!b[it.cat]) b[it.cat] = id; });
  if (b.dress) { b.top = null; b.bottom = null; }
  S.build = b; S.fwOnly = false; S.tab = "builder";
  window.scrollTo({ top: 0, behavior: "smooth" }); render();
}

/* ---------- стилист ---------- */
function viewAI() {
  const a = S.ai;
  let h = `<div class="panel stack"><div class="stack" style="gap:2px"><h3>✦ Спросить стилиста</h3><span class="muted small">Claude соберёт 3 образа только из твоих вещей с учётом типажа</span></div>
    <label class="f">Повод<input type="text" id="r-occasion" value="${esc(S.req.occasion)}" placeholder="учёба, свидание, прогулка, вечеринка" maxlength="80"></label>
    <label class="f">Погода<input type="text" id="r-weather" value="${esc(S.req.weather)}" placeholder="+5, дождь" maxlength="60"></label>
    <label class="f">Пожелания<input type="text" id="r-wish" value="${esc(S.req.wish)}" placeholder="хочу зелёный, без каблуков" maxlength="160"></label>
    ${S.br?.kind === "outfits" ? bridgeBox("outfits") : `<div class="row"><button class="btn" data-act="ai-go"${S.items.length < 3 ? " disabled" : ""}>Подобрать образы через Claude</button></div>`}
    ${S.items.length < 3 ? '<p class="muted small">Добавь хотя бы 3 вещи, чтобы было из чего собирать.</p>' : ""}`;
  if (a.out) {
    h += '<div class="ai-out">' + a.out.outfits.map((o, n) => `<div class="idea"><div class="row between"><b>${esc(o.title)}</b><div class="row" style="gap:6px"><button class="btn ghost" style="padding:5px 10px;font-size:13px" data-act="ai-try" data-n="${n}">Примерить</button><button class="btn ghost" style="padding:5px 10px;font-size:13px" data-act="ai-save" data-n="${n}">Сохранить</button></div></div><div class="mini">${o.items.map((id) => tile(byId(id))).join("")}</div><span class="small muted">${esc(o.why)}</span></div>`).join("") +
      (a.out.tip ? `<div class="notice small"><b>Чего не хватает:</b> ${esc(a.out.tip)}</div>` : "") + "</div>";
  }
  return h + "</div>";
}
function askAI() {
  const { prompt, map } = outfitsPrompt(S.items, S.profile, S.req);
  openBridge("outfits", prompt, { map });
}

/* ---------- образы ---------- */
function viewOutfits() {
  const h = `<div class="stack" style="gap:2px"><h2>Сохранённые образы</h2><span class="muted small">${S.outfits.length} образов</span></div>`;
  if (!S.outfits.length) return h + '<div class="empty" style="margin-top:16px">Пока нет сохранённых образов. Собери образ в конструкторе или спроси стилиста.</div>';
  return h + '<div class="outfits" style="margin-top:16px">' + S.outfits.map((o) => {
    const gone = o.items.filter((id) => !byId(id)).length;
    const sm = "padding:5px 10px;font-size:13px";
    return `<div class="idea"><div class="row between"><b>${esc(o.title)}</b><span class="muted small">${o.source === "ai" ? "✦ стилист" : "вручную"}</span></div>
      <div class="mini">${o.items.filter(byId).map((id) => tile(byId(id))).join("")}</div>
      ${o.why ? `<span class="small muted">${esc(o.why)}</span>` : ""}
      ${gone ? `<span class="small" style="color:var(--warn)">${gone} вещ. уже нет в гардеробе</span>` : ""}
      <div class="row">${S.outDel === o.id
        ? `<span class="small">Удалить образ?</span><button class="btn danger" style="${sm}" data-act="out-del-yes" data-id="${esc(o.id)}">Да</button><button class="btn ghost" style="${sm}" data-act="out-del-no">Нет</button>`
        : `<button class="btn ghost" style="${sm}" data-act="wear-outfit" data-id="${esc(o.id)}">Надела сегодня</button><button class="btn ghost" style="${sm}" data-act="out-open" data-id="${esc(o.id)}">Открыть в конструкторе</button><button class="btn ghost" style="${sm}" data-act="out-del" data-id="${esc(o.id)}">Удалить</button>`}</div></div>`;
  }).join("") + "</div>";
}

/* ---------- типаж ---------- */
const colNames = (keys) => (keys || []).filter((k) => COL[k]).map((k) => COL[k].t);
function analyzeControls() {
  const acc = S.anMode === "accurate";
  const modes = `<div class="chips" role="group" aria-label="Режим разбора"><button class="chip" data-act="an-mode" data-m="accurate" aria-pressed="${acc}">Точный режим</button><button class="chip" data-act="an-mode" data-m="fast" aria-pressed="${!acc}">Быстрый</button></div>`;
  const guide = acc ? `<details class="guide" open><summary><b>Как снять фото, чтобы разбор был точным</b></summary><ul>
      <li>Дневной свет у окна, без прямого солнца и без ламп.</li><li>Без макияжа, фильтров и ретуши, камера без «улучшений».</li>
      <li>Волосы убраны от лица; если окрашены — ответь на вопрос о натуральном цвете ниже.</li><li>Однотонная светлая одежда или белая ткань у шеи, в кадре белый лист бумаги — эталон белого.</li>
      <li>Лицо анфас крупно + одно фото в полный рост, чтобы оценить пропорции для типажа.</li></ul></details>` : "";
  const flagged = S.selfies.filter((x) => x.q && !x.q.ok);
  const qNote = acc && flagged.length ? `<div class="notice warn small">Проверка фото: ${S.selfies.map((x, i) => (x.q && !x.q.ok ? `фото ${i + 1} — ${x.q.flags.map((f) => f[1]).join(", ")}` : "")).filter(Boolean).join("; ")}. Лучше переснять, иначе Claude сделает поправку, но уверенность будет ниже.</div>` : acc && S.selfies.length ? '<div class="notice small">Проверка фото: свет и цвета в порядке ✓</div>' : "";
  const quiz = acc ? `<div class="quiz"><span class="small"><b>Пара вопросов о тебе</b> <span class="muted">— они уточняют то, что фото может исказить</span></span>
    <div class="quiz-grid">${QUIZ.map(([k, q, opts]) => `<label class="f">${esc(q)}<select data-quiz="${k}"><option value="">не знаю</option>${opts.map((o) => `<option${S.quiz[k] === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`).join("")}</div></div>` : "";
  const up = `<div class="stack" style="gap:8px"><span class="small"><b>Твои фото</b> <span class="muted">(${acc ? "2–5 фото" : "необязательно, до 5"}): на них появятся метки признаков типажа. Фото хранятся только в этом браузере.</span></span>${selfieBlock()}${qNote}</div>`;
  return modes + guide + up + quiz + (S.br?.kind === "analyze" ? bridgeBox("analyze") : `<div class="row"><button class="btn cherry" data-act="an-go">✦ Определить мой типаж</button>${S.profile?.drape ? '<span class="muted small">Результат драпировки тоже учтётся</span>' : ""}</div>`);
}
function viewOnboarding() {
  return `<div class="hero"><div class="stack" style="gap:8px"><span class="muted small" style="font-family:var(--mono);letter-spacing:.07em;text-transform:uppercase">Перед стартом</span>
    <h1>Сначала разберём твой <em>типаж</em></h1>
    <p class="lead muted">Разбор делает Claude в обычном чате на claude.ai, подойдёт и бесплатный аккаунт. Загрузи сюда 2–5 своих фото (лицо при дневном свете, без фильтров): на них появятся метки признаков типажа. Сайт подготовит запрос, ты отправишь его в чат вместе с этими же фото и вставишь ответ сюда. Фото и гардероб хранятся только в этом браузере.</p></div>
    ${analyzeControls()}
    <button class="btn ghost" style="justify-self:start" data-act="skip-onb">Пропустить и сразу к вещам</button></div>`;
}
const SEASON_NAME = Object.fromEntries(SEASON_TYPES.flatMap(([, t, subs]) => subs.map(([k, st]) => [k, `${t[0].toUpperCase() + t.slice(1)} ${st}`])));
function seasonGrid(sel) {
  return '<div class="sgrid">' + SEASON_TYPES.map(([key, title, subs]) => {
    const mine = subs.some((x) => x[0] === sel);
    return `<div class="scol${mine ? " mine" : ""}"><span class="sh">${title}</span>${subs.map(([k, t]) => `<span class="scell${k === sel ? " on" : ""}">${t}</span>`).join("")}</div>`;
  }).join("") + "</div>";
}
function scaleRows(a) {
  const sc = a.scales || {};
  if (!SCALES.some(([k]) => sc[k])) return "";
  return '<div class="scales">' + SCALES.map(([k, label, opts]) => {
    const v = sc[k];
    return `<div class="srow"><span class="sl">${label}</span><span class="seg">${opts.map(([o, t]) => `<span class="${o === v ? "on" : ""}">${t}</span>`).join("")}</span></div>`;
  }).join("") + "</div>";
}
function swatches(keys, crossed) {
  return '<div class="sw-grid">' + (keys || []).filter((k) => COL[k]).map((k) => `<span class="swb${crossed ? " x" : ""}"><i style="background:${COL[k].hex}"></i><span>${esc(COL[k].t)}</span></span>`).join("") + "</div>";
}
function metalChip(m) {
  const t = String(m || "").toLowerCase();
  const sil = t.includes("серебр"), gold = t.includes("зол");
  const bg = sil && gold ? "linear-gradient(135deg,#d9dde2 50%,#d4b264 50%)" : gold ? "linear-gradient(135deg,#f1d98f,#b8913a)" : "linear-gradient(135deg,#f4f5f7,#aab0b8)";
  return m ? `<span class="metal"><i style="background:${bg}"></i>${esc(m)}</span>` : "";
}
function featureChips(a) {
  const ct = a.colortype || {};
  const hexOf = (kind) => (a.markers || []).find((m) => m.kind === kind && m.hex)?.hex;
  const rows = [["Кожа", ct.undertone, hexOf("skin")], ["Глаза", ct.eyes, hexOf("eyes")], ["Волосы", ct.hair, hexOf("hair")], ["Контраст", ct.contrast, null]].filter((r) => r[1]);
  return '<div class="feats">' + rows.map(([l, v, h]) => `<div class="feat">${h ? `<i style="background:${h}"></i>` : '<i class="empty"></i>'}<span><span class="muted small">${l}</span><br>${esc(v)}</span></div>`).join("") + "</div>";
}
function pinsBlock(a) {
  const set = PINS[a.season];
  let ids = [];
  if (set) ids = a.wear === "menswear" ? set.m : a.wear === "womenswear" ? set.w : [...(set.w || []).slice(0, 3), ...(set.m || []).slice(0, 3)];
  ids = (ids || []).filter((x) => Array.isArray(x) && x[1]).slice(0, 6);
  const qs = a.pinterest?.length ? a.pinterest : a.season ? [`${a.season.replace("_", " ")} outfit`] : [];
  if (!ids.length && !qs.length) return "";
  return `<div class="an-card pins-card"><div class="row between"><span class="k">Образы на Pinterest</span>${a.season ? `<span class="muted small">${esc(SEASON_NAME[a.season] || "")}</span>` : ""}</div>
    ${ids.length ? `<div class="pin-grid">${ids.map(([id, img]) => `<a class="pin" href="https://www.pinterest.com/pin/${encodeURIComponent(id)}/" target="_blank" rel="noopener" aria-label="Открыть пин на Pinterest"><img src="https://i.pinimg.com/474x/${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></a>`).join("")}</div><span class="muted small">Примеры подобраны по твоему цветотипу. Нажми на фото, чтобы открыть пин.</span>` : ""}
    ${qs.length ? `<div class="chips">${qs.map((q) => `<a class="chip" href="https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">${esc(q)} ↗</a>`).join("")}</div>` : ""}
  </div>`;
}
function viewAnalysis(a) {
  const ct = a.colortype || {}, ty = a.type || {};
  return `<div class="an">${viewLook(a)}
    ${a.summary ? `<p class="lead">${esc(a.summary)}</p>` : ""}
    <div class="an-grid two">
      <div class="an-card"><div class="row between"><span class="k">Цветотип</span>${confPill(a.confidence?.season)}</div><b>${esc(ct.name || SEASON_NAME[a.season] || "—")}</b>${a.season_alt ? `<span class="muted small">Второй вариант: ${esc(SEASON_KB[a.season_alt]?.name || a.season_alt)}</span>` : ""}${a.season ? seasonGrid(a.season) : ""}${scaleRows(a)}${drapeCompare(a)}</div>
      <div class="an-card"><div class="row between"><span class="k">Типаж внешности</span>${confPill(a.confidence?.type)}</div><b>${esc(a.kibbe ? `${KIBBE_KB[a.kibbe].ru} · ${KIBBE_KB[a.kibbe].name}` : ty.name || "—")}</b>${a.kibbe_alt ? `<span class="muted small">Второй вариант: ${esc(KIBBE_KB[a.kibbe_alt].ru)}</span>` : ""}
        ${a.type_tags?.length ? `<div class="chips">${a.type_tags.map((t) => `<span class="chip tag">${esc(t)}</span>`).join("")}</div>` : ""}
        ${ty.features ? `<p class="small">${esc(ty.features)}</p>` : ""}
        ${featureChips(a)}</div>
    </div>
    <div class="an-card formula"><span class="k">Формула стиля</span><b class="big-q">${esc(a.formula || "—")}</b>${a.aesthetics?.length ? `<div class="chips">${a.aesthetics.map((t) => `<a class="chip" href="https://www.pinterest.com/search/pins/?q=${encodeURIComponent(t + " outfit")}" target="_blank" rel="noopener">${esc(t)}</a>`).join("")}</div>` : ""}</div>
    <div class="an-grid two">
      <div class="an-card"><span class="k">Твоя палитра</span>${swatches(a.palette)}<div class="row small" style="gap:8px"><span class="muted">Металл</span>${metalChip(a.metal)}</div></div>
      <div class="an-card"><span class="k">Лучше не у лица</span>${swatches(a.avoid, true)}<p class="muted small">Такие цвета можно носить в обуви, низе или сумке.</p></div>
    </div>
    ${a.tips?.length ? `<div class="tips">${a.tips.map((t, n) => `<div class="tip"><span class="lg-n">${n + 1}</span><span>${esc(t)}</span></div>`).join("")}</div>` : ""}
    ${a.hair || a.makeup ? `<div class="an-grid two">
      ${a.hair ? `<div class="an-card"><span class="k">Волосы</span><p>${esc(a.hair)}</p></div>` : ""}
      ${a.makeup ? `<div class="an-card"><span class="k">Уход и макияж</span><p>${esc(a.makeup)}</p></div>` : ""}
    </div>` : ""}
    ${a.evidence?.length ? `<details class="an-card evid"><summary><span class="k">На чём основан разбор</span></summary><ul>${a.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
    ${kbBlock(a)}
    ${drapeBlock(a)}
    ${pinsBlock(a)}
    ${a.unsure ? `<p class="muted small">Что по фото определить не получилось: ${esc(a.unsure)}</p>` : ""}</div>`;
}
// Метки: только кружок на самом признаке, с номером из списка признаков.
// Цвет кружка — оттенок, снятый с фото; цифра светлая или тёмная по яркости фона.
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#1d1a1b";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1d1a1b" : "#fff";
}
function calloutLayer(marks) {
  const pct = (v) => (v * 100).toFixed(2);
  return marks.map((m) => `<i class="pt" data-mi="${m.n - 1}" role="slider" tabindex="0" aria-label="Метка ${m.n}: ${esc(m.label)}. Перетащи, чтобы поправить" style="left:${pct(m.x)}%;top:${pct(m.y)}%;background:${m.hex || "var(--accent)"};color:${inkOn(m.hex)}">${m.n}</i>`).join("");
}

const lookMarks = (a, i) => (a.markers || []).map((m, n) => ({ ...m, n: n + 1 })).filter((m) => m.photo === i + 1);

// Перетаскивание точек: во время движения перерисовывается только слой меток,
// после отпускания точка заново снимает оттенок с фото и разбор сохраняется.
let drag = null;
function lookIndex() {
  const photos = (S.profile?.photos || []).filter((k) => S.urls[k]);
  return { photos, i: Math.min(S.viewPhoto, photos.length - 1) };
}
function moveMarker(mi, fx, fy) {
  const a = analysis(); const m = a?.markers?.[mi]; if (!m) return;
  m.x = Math.min(1, Math.max(0, fx)); m.y = Math.min(1, Math.max(0, fy));
  const layer = $("look-layer");
  if (layer) layer.innerHTML = calloutLayer(lookMarks(a, lookIndex().i));
}
async function commitMarker(mi) {
  const a = analysis(); const m = a?.markers?.[mi]; if (!m) return;
  const { photos } = lookIndex();
  const key = (S.profile.photos || [])[m.photo - 1];
  if (key && photos.includes(key) && sampleable(m.kind)) {
    try { const b = await store.get("photos", key); if (b) m.hex = await sampleAt(b, m.x, m.y); } catch {}
  }
  await setProfile({ ...S.profile, analysis: a });
  render();
}
document.addEventListener("pointerdown", (e) => {
  const pt = e.target.closest?.(".look-photo .pt");
  if (!pt) return;
  e.preventDefault();
  drag = { mi: +pt.dataset.mi, box: pt.closest(".look-photo").getBoundingClientRect(), moved: false };
  document.body.classList.add("dragging");
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  drag.moved = true;
  moveMarker(drag.mi, (e.clientX - drag.box.left) / drag.box.width, (e.clientY - drag.box.top) / drag.box.height);
});
function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  document.body.classList.remove("dragging");
  if (d.moved) commitMarker(d.mi);
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
document.addEventListener("keydown", (e) => {
  const pt = e.target.closest?.(".look-photo .pt");
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!pt || !step) return;
  e.preventDefault();
  const mi = +pt.dataset.mi, m = analysis()?.markers?.[mi]; if (!m) return;
  moveMarker(mi, m.x + step[0] * 0.01, m.y + step[1] * 0.01);
  clearTimeout(commitMarker.t); commitMarker.t = setTimeout(() => commitMarker(mi), 500);
});

function viewLook(a) {
  const photos = (S.profile?.photos || []).filter((k) => S.urls[k]);
  if (!photos.length) return "";
  const i = Math.min(S.viewPhoto, photos.length - 1);
  const marks = lookMarks(a, i);
  return `<div class="look">
    <div class="stack" style="gap:8px">
      <div class="pip look-photo"><img src="${S.urls[photos[i]]}" alt="Фото ${i + 1} с метками признаков">
        <div class="layer" id="look-layer">${calloutLayer(marks)}</div>
      </div>
      ${photos.length > 1 ? `<div class="thumbs">${photos.map((k, j) => `<button data-act="look" data-i="${j}" aria-pressed="${j === i}" aria-label="Фото ${j + 1}"><img src="${S.urls[k]}" alt=""></button>`).join("")}</div>` : ""}
    </div>
    <div class="stack" style="gap:10px"><span class="k">Признаки на фото</span><span class="muted small">Точки можно перетащить, если Claude поставил их неточно.</span>
      ${marks.length ? `<ol class="legend">${marks.map((m) => `<li><span class="lg-n">${m.n}</span><span class="stack" style="gap:2px"><b>${esc(m.label)}</b><span class="muted small">${esc(MARK_KINDS[m.kind] || "")}${m.hex ? ` · <i class="dot" style="background:${m.hex}"></i> ${m.hex}` : ""}</span>${m.note ? `<span class="small">${esc(m.note)}</span>` : ""}</span></li>`).join("")}</ol>`
        : '<p class="muted small">На этом фото Claude не отметил признаков.</p>'}
    </div>
  </div>`;
}
function analysisText(a) {
  if (!a) return "";
  return [
    `Цветотип: ${a.colortype?.name}. Подтон: ${a.colortype?.undertone}. Глаза: ${a.colortype?.eyes}. Волосы: ${a.colortype?.hair}. Контраст: ${a.colortype?.contrast}.`,
    `Типаж: ${a.type?.name} — ${a.type?.features}`,
    `Формула стиля: ${a.formula}. Эстетики: ${(a.aesthetics || []).join(", ")}.`,
    `Палитра: ${colNames(a.palette).join(", ")}. Металл: ${a.metal}.`,
    `Не носить у лица: ${colNames(a.avoid).join(", ")}.`,
  ].join("\n");
}
function viewProfile() {
  const a = analysis();
  let h = `<div class="stack" style="max-width:820px;gap:22px"><div class="stack" style="gap:2px"><h2>Мой типаж</h2><span class="muted small">${a ? "Определён по фото " + new Date(a.at || Date.now()).toLocaleDateString("ru-RU") + ". Стилист учитывает это при каждом подборе." : "Типаж ещё не определён."}</span></div>`;
  if (a) h += viewAnalysis(a);
  h += `<div class="panel stack"><h3>${a ? "Определить заново" : "Определить по фото"}</h3><span class="muted small">Например, после окрашивания волос. Разбор делает Claude в чате на claude.ai.</span>${analyzeControls()}</div>`;
  h += `<details class="panel"><summary style="cursor:pointer;font-weight:600">Текст для стилиста (можно поправить вручную)</summary><div class="stack" style="margin-top:12px">
    <textarea id="p-text" class="f" rows="10" style="min-height:200px" placeholder="Опиши свой цветотип, палитру и любимые стили">${esc(S.profile?.text || analysisText(a))}</textarea>
    <div class="row"><button class="btn cherry" data-act="p-save">Сохранить текст</button>${S.profile?.text && a ? '<button class="btn ghost" data-act="p-reset">Собрать заново из разбора</button>' : ""}</div></div></details>
  <div class="panel stack"><h3>Копия гардероба</h3><span class="muted small">Вещи, фото, образы и типаж хранятся только в этом браузере. Скачай копию, чтобы не потерять их или перенести на другое устройство.</span>
    <div class="row"><button class="btn ghost" data-act="export">Скачать копию</button><label class="btn ghost" for="import-in" style="cursor:pointer">Загрузить копию</label><input class="sr" type="file" id="import-in" accept="application/json,.json"></div>
    ${S.importConfirm ? `<div class="notice warn row">Загрузка заменит всё, что сейчас в гардеробе. <button class="btn danger" style="padding:5px 10px;font-size:13px" data-act="import-yes">Заменить</button><button class="btn ghost" style="padding:5px 10px;font-size:13px" data-act="import-no">Отмена</button></div>` : ""}
  </div></div>`;
  return h;
}
async function saveProfileText(text) {
  try { await setProfile({ analysis: analysis(), text }); } catch { toast("Не получилось сохранить"); return; }
  toast(text ? "Текст сохранён" : "Текст собран из разбора"); render();
}

/* ---------- общие помощники для новых разделов ---------- */
const kindOf = (c) => COL[c]?.kind || "neutral";
const RU_MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const fmtDay = (key) => new Date(key + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const miniRow = (ids) => `<div class="mini">${ids.filter(byId).map((id) => tile(byId(id))).join("")}</div>`;
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
async function saveKv(key, value) { try { await store.put("kv", value, key); } catch { toast("Не получилось сохранить"); } }
async function logWear(ids, source) {
  ids = [...new Set(ids.filter((x) => byId(x)))];
  if (ids.length < 2) { toast("Выбери хотя бы две вещи"); return; }
  const today = dayKey();
  S.wears = [...S.wears.filter((w) => w.date !== today), { date: today, items: ids, source }];
  await saveKv("wears", S.wears);
  toast("Отмечено: надето сегодня"); render();
}

/* ---------- погода ---------- */
async function geocode(q) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=ru&format=json`);
  const j = await r.json();
  const g = j.results?.[0];
  if (!g) throw new Error("Город не найден. Попробуй написать иначе.");
  return { lat: g.latitude, lon: g.longitude, place: [g.name, g.admin1, g.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2).join(", ") };
}
async function refreshWeather(force = false) {
  const st = S.settings;
  if (!st.lat) return;
  if (!force && S.weather && S.weather.place === st.place && Date.now() - S.weather.at < 60 * 60 * 1000) return;
  S.wBusy = true; S.wErr = null; if (S.tab === "today") render();
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
    const j = await (await fetch(u)).json();
    const c = j.current || {}, dly = j.daily || {};
    S.weather = { place: st.place, at: Date.now(), temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), code: c.weather_code, wind: Math.round(c.wind_speed_10m || 0),
      tmax: Math.round(dly.temperature_2m_max?.[0]), tmin: Math.round(dly.temperature_2m_min?.[0]), rainChance: dly.precipitation_probability_max?.[0] ?? 0 };
    await saveKv("weather", S.weather);
  } catch { S.wErr = "Не получилось загрузить погоду. Проверь интернет и попробуй ещё раз."; }
  S.wBusy = false; if (S.tab === "today") render();
}
async function setCity(q) {
  S.wBusy = true; S.wErr = null; render();
  try { const g = await geocode(q); S.settings = { ...S.settings, ...g }; await saveKv("settings", S.settings); await refreshWeather(true); }
  catch (e) { S.wBusy = false; S.wErr = e.message; render(); }
}
function locate() {
  if (!navigator.geolocation) { S.wErr = "Браузер не даёт определить местоположение. Введи город."; render(); return; }
  S.wBusy = true; render();
  navigator.geolocation.getCurrentPosition(async (p) => {
    S.settings = { ...S.settings, lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), place: "Моё местоположение" };
    await saveKv("settings", S.settings); await refreshWeather(true);
  }, () => { S.wBusy = false; S.wErr = "Нет доступа к местоположению. Введи город вручную."; render(); }, { timeout: 10000 });
}
function weatherCard() {
  const w = S.weather, st = S.settings;
  const form = `<form class="row" id="city-form" style="gap:8px"><label class="f" style="flex:1;min-width:180px"><span class="sr">Город</span><input type="text" id="city-in" placeholder="Город, например Москва" value="${esc(S.cityDraft || "")}" maxlength="60"></label><button class="btn" type="submit"${S.wBusy ? " disabled" : ""}>Показать погоду</button><button class="btn ghost" type="button" data-act="locate">По геолокации</button></form>`;
  if (!st.lat || S.editCity) return `<div class="panel stack weather"><h3>Погода</h3><span class="muted small">Укажи город, чтобы образы подбирались под погоду. Он сохранится только в этом браузере.</span>${form}${S.wErr ? `<div class="notice err small">${esc(S.wErr)}</div>` : ""}</div>`;
  if (!w) return `<div class="panel weather"><span class="muted">${S.wBusy ? "Загружаю погоду…" : esc(S.wErr || "Нет данных о погоде")}</span></div>`;
  const wt = weatherText(w.code), needs = weatherNeeds(w);
  return `<div class="panel weather">
    <div class="w-main"><span class="w-ico" aria-hidden="true">${wt.icon}</span><span class="w-t">${w.temp > 0 ? "+" : ""}${w.temp}°</span>
      <span class="stack" style="gap:0"><b>${esc(wt.text)}</b><span class="muted small">ощущается как ${w.feels > 0 ? "+" : ""}${w.feels}° · днём ${w.tmin}…${w.tmax}° · осадки ${w.rainChance}% · ветер ${w.wind} км/ч</span></span></div>
    ${needs.advice.length ? `<ul class="w-adv">${needs.advice.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    <div class="row small muted" style="gap:10px"><span>${esc(w.place || "")}</span><button class="linkbtn" data-act="city-edit">сменить город</button><button class="linkbtn" data-act="w-refresh">обновить</button></div>
  </div>`;
}

/* ---------- сегодня ---------- */
function viewToday() {
  const today = dayKey(), worn = S.wears.find((w) => w.date === today);
  const dateStr = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  let h = `<div class="stack" style="gap:2px"><span class="muted small" style="font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase">${esc(dateStr)}</span><h2>Что надеть сегодня</h2></div>
    <div class="today" style="margin-top:14px">${weatherCard()}`;
  if (worn) h += `<div class="panel stack worn"><div class="row between"><h3>Сегодня надето ✓</h3><button class="linkbtn" data-act="unwear" data-date="${today}">снять отметку</button></div>${miniRow(worn.items)}</div>`;
  h += "</div>";
  if (S.items.length < 3) return h + '<div class="empty" style="margin-top:16px">Добавь хотя бы 3 вещи во вкладке «Мои вещи», и здесь появятся образы на сегодня.</div>';
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const exclude = S.wears.find((w) => w.date === yesterday)?.items || [];
  const needs = weatherNeeds(S.weather);
  const list = suggestOutfits(S.items, kindOf, needs, { n: 3, seed: S.seed + Number(today.replace(/-/g, "")), exclude });
  S.todayList = list;
  h += `<div class="row between" style="margin-top:22px"><h3>${S.weather ? "Под сегодняшнюю погоду" : "Образы из твоих вещей"}</h3><div class="row" style="gap:8px"><button class="btn ghost" data-act="today-more">↻ Другие варианты</button><button class="btn ghost" data-act="today-ai">✦ Спросить Claude</button></div></div>`;
  if (!list.length) return h + '<div class="empty" style="margin-top:12px">Не получилось собрать образ: добавь вещи разных категорий (верх, низ, обувь).</div>';
  h += '<div class="outfits" style="margin-top:12px">' + list.map((o, n) => {
    const its = o.items.map(byId).filter(Boolean);
    const notes = assess(o.items).filter((x) => x[0] !== "ok" || /Стиль|акцент/.test(x[1]));
    return `<div class="idea"><div class="row between"><b>Вариант ${n + 1}</b><span class="muted small">${its.length} ${plural(its.length, "вещь", "вещи", "вещей")}</span></div>
      ${miniRow(o.items)}
      <div class="score">${notes.map((x) => `<span class="pill${x[0] === "ok" ? "" : " " + x[0]}">${esc(x[1])}</span>`).join("")}</div>
      <div class="row" style="gap:6px"><button class="btn cherry" style="padding:6px 12px;font-size:13px" data-act="today-wear" data-n="${n}">Надену это</button><button class="btn ghost" style="padding:6px 12px;font-size:13px" data-act="today-open" data-n="${n}">В конструктор</button><button class="btn ghost" style="padding:6px 12px;font-size:13px" data-act="today-save" data-n="${n}">Сохранить</button></div></div>`;
  }).join("") + "</div>";
  return h;
}
function weatherPhrase() {
  const w = S.weather; if (!w) return "";
  return `${w.temp > 0 ? "+" : ""}${w.temp}°, ${weatherText(w.code).text}, осадки ${w.rainChance}%`;
}

/* ---------- статистика ---------- */
function calendar() {
  const [y, mo] = S.calMonth.split("-").map(Number);
  const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // понедельник первым
  const byDate = Object.fromEntries(S.wears.map((w) => [w.date, w]));
  const today = dayKey();
  let cells = "";
  for (let k = 0; k < lead; k++) cells += '<span class="cd empty"></span>';
  for (let d = 1; d <= days; d++) {
    const key = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const w = byDate[key];
    const dots = w ? w.items.map(byId).filter(Boolean).slice(0, 4).map((it) => `<i style="background:${(COL[it.color] || {}).hex || "#ccc"}"></i>`).join("") : "";
    cells += `<button class="cd${w ? " on" : ""}${key === today ? " is-today" : ""}${S.calDay === key ? " sel" : ""}" data-act="cal-day" data-d="${key}" aria-label="${fmtDay(key)}${w ? ", есть образ" : ""}"><span>${d}</span><span class="dots">${dots}</span></button>`;
  }
  const sel = S.calDay && byDate[S.calDay];
  return `<div class="panel stack"><div class="row between"><h3>Календарь образов</h3><div class="row" style="gap:6px"><button class="btn ghost" style="padding:4px 10px" data-act="cal-prev" aria-label="Предыдущий месяц">‹</button><span class="small" style="min-width:110px;text-align:center">${RU_MONTHS[mo - 1]} ${y}</span><button class="btn ghost" style="padding:4px 10px" data-act="cal-next" aria-label="Следующий месяц">›</button></div></div>
    <div class="cal"><span class="cw">пн</span><span class="cw">вт</span><span class="cw">ср</span><span class="cw">чт</span><span class="cw">пт</span><span class="cw">сб</span><span class="cw">вс</span>${cells}</div>
    ${sel ? `<div class="stack" style="gap:8px"><div class="row between"><b>${fmtDay(S.calDay)}</b><button class="linkbtn" data-act="unwear" data-date="${S.calDay}">удалить отметку</button></div>${miniRow(sel.items)}</div>` : '<span class="muted small">Нажми на день с точками, чтобы увидеть образ. Отмечай образы кнопкой «Надену это» или «Надела сегодня».</span>'}</div>`;
}
function viewStats() {
  const st = wearStats(S.items, S.wears);
  const never = st.rows.filter((r) => r.count === 0).length;
  const tiles = [[st.totalWears, "отметок всего"], [st.month, "в этом месяце"], [st.streak, st.streak === 1 ? "день подряд" : "дней подряд"], [never, "вещей ещё не надевала"]];
  let h = `<div class="stack" style="gap:2px"><h2>Статистика</h2><span class="muted small">Что ты носишь на самом деле и чего не хватает гардеробу</span></div>
    <div class="tiles">${tiles.map(([n, l]) => `<div class="tile-n"><b>${n}</b><span>${l}</span></div>`).join("")}</div>
    <div class="an-grid two">${calendar()}<div class="stack">`;
  const top = st.byCount.filter((r) => r.count > 0).slice(0, 5);
  h += `<div class="panel stack"><h3>Чаще всего</h3>${top.length ? `<ol class="rank">${top.map((r) => { const it = byId(r.id); return `<li>${tile(it)}<span><b>${esc(it.name)}</b><span class="muted small">${r.count} ${plural(r.count, "раз", "раза", "раз")}${r.cpw ? ` · ${r.cpw.toLocaleString("ru-RU")} ₽ за выход` : ""}</span></span></li>`; }).join("")}</ol>` : '<span class="muted small">Пока нет отметок.</span>'}</div>`;
  const idle = st.idle.slice(0, 6);
  h += `<div class="panel stack"><h3>Давно не надевала</h3>${idle.length ? `<ol class="rank">${idle.map((r) => { const it = byId(r.id); return `<li>${tile(it)}<span><b>${esc(it.name)}</b><span class="muted small">${r.since === null ? "ещё ни разу" : `${r.since} ${plural(r.since, "день", "дня", "дней")} назад`}</span></span><button class="btn ghost" style="padding:4px 10px;font-size:12.5px" data-act="build-with" data-id="${esc(it.id)}">Собрать образ</button></li>`; }).join("")}</ol>` : '<span class="muted small">Все вещи в ходу.</span>'}</div>`;
  const priced = st.rows.filter((r) => r.cpw).sort((a, b) => b.cpw - a.cpw).slice(0, 6);
  h += `<div class="panel stack"><h3>Цена за выход</h3>${priced.length ? `<ol class="rank">${priced.map((r) => { const it = byId(r.id); return `<li>${tile(it)}<span><b>${esc(it.name)}</b><span class="muted small">${it.price.toLocaleString("ru-RU")} ₽ · ${r.count} ${plural(r.count, "выход", "выхода", "выходов")}</span></span><b class="cpw">${r.cpw.toLocaleString("ru-RU")} ₽</b></li>`; }).join("")}</ol>` : '<span class="muted small">Укажи цену в карточке вещи, и здесь появится стоимость одного выхода.</span>'}</div>`;
  h += "</div></div>" + viewGaps();
  return h;
}

/* ---------- чего не хватает + вишлист ---------- */
function viewGaps() {
  const a = analysis();
  const season = S.weather ? weatherNeeds(S.weather).season : "any";
  const g = wardrobeGaps(S.items, kindOf, { palette: a?.palette || [], season });
  let h = `<div class="stack" style="margin-top:22px;gap:12px"><div class="stack" style="gap:2px"><h2>Чего не хватает</h2><span class="muted small">Сейчас гардероб даёт ${g.base} ${plural(g.base, "базовый образ", "базовых образа", "базовых образов")}${season !== "any" ? " на этот сезон" : ""}. Вот что добавит больше всего новых сочетаний.</span></div>`;
  h += '<div class="gaps">' + g.ideas.map((x) => {
    const inList = S.wishlist.some((w) => w.key === x.key && !w.done);
    return `<div class="gap"><i class="gsw" style="background:${(COL[x.color] || {}).hex || "#ccc"}"></i><span class="stack" style="gap:2px"><b>${esc(x.title)}</b><span class="muted small">${esc(x.why)}. Например: ${esc((COL[x.color] || {}).t || "")}, ${esc(CATT[x.cat].toLowerCase())}.</span>
      <span class="row" style="gap:6px">${x.urgent ? '<span class="pill bad">важно</span>' : ""}${x.gain > 0 ? `<span class="pill">+${x.gain} ${plural(x.gain, "образ", "образа", "образов")}</span>` : ""}</span></span>
      <button class="btn ghost" style="padding:5px 10px;font-size:12.5px" data-act="wish-add" data-key="${x.key}"${inList ? " disabled" : ""}>${inList ? "В вишлисте" : "В вишлист"}</button></div>`;
  }).join("") + "</div>";
  if (g.faceAvoid.length) h += `<div class="notice warn small">У лица сейчас ${g.faceAvoid.length} ${plural(g.faceAvoid.length, "вещь", "вещи", "вещей")} не из твоей палитры: ${g.faceAvoid.map((id) => esc(byId(id)?.name)).join(", ")}. Их можно сочетать с шарфом или воротником подходящего цвета.</div>`;
  const open = S.wishlist.filter((w) => !w.done).length;
  h += `<div class="row"><button class="btn ghost" data-tab="wish">Открыть вишлист${open ? ` · ${open}` : ""}</button></div></div>`;
  return h;
}

/* ---------- капсулы ---------- */
function viewCapsules() {
  const c = S.cap, r = S.capResult;
  let h = `<div class="stack" style="gap:2px"><h2>Капсулы</h2><span class="muted small">Небольшой набор вещей из твоего гардероба, который даёт максимум сочетаний</span></div>
  <div class="panel stack" style="margin-top:14px">
    <div class="fieldset"><span>Для чего</span><div class="chips">${Object.entries(CAPSULE_PRESETS).map(([k, p]) => `<button class="chip" data-act="cap-preset" data-k="${k}" aria-pressed="${c.preset === k}">${p.title} · ${p.size}</button>`).join("")}</div></div>
    <div class="fieldset"><span>Сезон</span><div class="chips">${[["any", "любой"], ...SEASONS].map(([k, t]) => `<button class="chip" data-act="cap-season" data-k="${k}" aria-pressed="${c.season === k}">${t}</button>`).join("")}</div></div>
    <div class="fieldset"><span>Стиль <span class="muted" style="font-weight:500">(необязательно)</span></span><div class="chips">${STYLES.map(([k, t]) => `<button class="chip" data-act="cap-style" data-k="${k}" aria-pressed="${c.styles.includes(k)}">${t}</button>`).join("")}</div></div>
    <div class="row"><button class="btn cherry" data-act="cap-build"${S.items.length < 4 ? " disabled" : ""}>Собрать капсулу</button>${S.items.length < 4 ? '<span class="muted small">Нужно хотя бы 4 вещи</span>' : ""}</div>
  </div>`;
  if (r) h += capsuleCard(r, true);
  if (S.capsules.length) h += `<div class="stack" style="margin-top:22px"><h3>Сохранённые капсулы</h3>${S.capsules.map((cp) => capsuleCard(cp, false)).join("")}</div>`;
  return h;
}
function capsuleCard(cp, fresh) {
  const its = cp.items.map(byId).filter(Boolean);
  const checked = new Set(cp.checked || []);
  const done = its.filter((i) => checked.has(i.id)).length;
  return `<div class="panel stack capsule" style="margin-top:14px">
    <div class="row between"><div class="stack" style="gap:2px"><h3>${esc(cp.name || cp.title)}</h3><span class="muted small">${its.length} ${plural(its.length, "вещь", "вещи", "вещей")} → ${cp.combos} ${plural(cp.combos, "образ", "образа", "образов")}${fresh ? "" : ` · собрано ${done}/${its.length}`}</span></div>
      <div class="row" style="gap:6px">${fresh ? '<button class="btn cherry" style="padding:6px 12px;font-size:13px" data-act="cap-save">Сохранить</button><button class="btn ghost" style="padding:6px 12px;font-size:13px" data-act="cap-build">Собрать заново</button>' : `<button class="linkbtn" data-act="cap-del" data-id="${cp.id}">удалить</button>`}</div></div>
    <ul class="checklist">${its.map((it) => `<li><label><input type="checkbox" data-cap="${fresh ? "new" : cp.id}" data-item="${esc(it.id)}"${checked.has(it.id) ? " checked" : ""}>${tile(it)}<span><b>${esc(it.name)}</b><span class="muted small">${esc(CATT[it.cat] || "")}</span></span></label></li>`).join("")}</ul>
    ${cp.examples?.length ? `<div class="stack" style="gap:8px"><span class="k">Примеры образов из капсулы</span>${cp.examples.map((ids, n) => `<div class="row" style="gap:8px;align-items:center"><span class="lg-n">${n + 1}</span>${miniRow(ids)}</div>`).join("")}</div>` : ""}
  </div>`;
}

/* ---------- найти образ по коллажу ---------- */
function lookMatches(it) {
  const same = S.items.filter((w) => w.cat === it.cat && w.color === it.color);
  if (same.length) return { exact: true, list: same.slice(0, 3) };
  const near = S.items.filter((w) => w.cat === it.cat && kindOf(w.color) === "neutral" && kindOf(it.color) === "neutral");
  return { exact: false, list: near.slice(0, 3) };
}
function lookImgUrl() {
  const r = S.lookRes;
  if (r?.photoKey) return S.urls[r.photoKey];
  return S.lookImg?.url || null;
}
function viewShop() {
  let h = `<div class="stack" style="gap:2px"><h2>Найти образ</h2><span class="muted small">Загрузи коллаж или фото образа. Claude разберёт его на вещи, а сайт подскажет, где искать похожие на Wildberries, Ozon и Яндекс Маркете.</span></div>`;
  const r = S.lookRes, img = lookImgUrl();
  if (!r) {
    h += `<div class="shop-up" style="margin-top:14px">
      <label class="drop look-drop" for="look-in">${img ? `<img src="${img}" alt="Загруженный коллаж">` : "<span>Перетащи сюда коллаж<br>или нажми, чтобы выбрать</span>"}</label>
      <input class="sr" type="file" id="look-in" accept="image/jpeg,image/png,image/webp">
      <div class="stack">${img ? (S.br?.kind === "look" ? bridgeBox("look") : '<div class="row"><button class="btn cherry" data-act="look-go">✦ Разобрать через Claude</button><button class="btn ghost" data-act="look-reset">Другая картинка</button></div><p class="muted small">Совет: включи в claude.ai веб-поиск, тогда Claude пришлёт и прямые ссылки на товары.</p>') : '<p class="muted small">Подойдут коллажи из Pinterest, скриншоты из соцсетей или фото образа целиком.</p>'}</div>
    </div>`;
  } else {
    const marks = r.items.map((it, n) => ({ ...it, n: n + 1 })).filter((m) => m.x !== null && m.y !== null);
    h += `<div class="shop-res" style="margin-top:14px">
      <div class="stack" style="gap:10px">
        ${img ? `<div class="pip look-photo shop-photo"><img src="${img}" alt="Коллаж образа"><div class="layer">${marks.map((m) => `<i class="pt static" style="left:${(m.x * 100).toFixed(1)}%;top:${(m.y * 100).toFixed(1)}%;background:${(COL[m.color] || {}).hex || "var(--accent)"};color:${inkOn((COL[m.color] || {}).hex)}">${m.n}</i>`).join("")}</div></div>` : ""}
        <div class="row" style="gap:6px">${r.photoKey ? `<button class="linkbtn" data-act="look-del" data-id="${r.id}">удалить разбор</button>` : '<button class="btn cherry" data-act="look-save">Сохранить разбор</button>'}<button class="btn ghost" data-act="look-build">Собрать похожий из моих вещей</button><button class="btn ghost" data-act="look-new">Новый коллаж</button></div>
      </div>
      <div class="stack" style="gap:12px">
        <div class="stack" style="gap:4px"><h3>${esc(r.title)}</h3>${r.style ? `<span class="muted small">${esc(r.style)}</span>` : ""}${r.tip ? `<p class="small" style="margin:0">${esc(r.tip)}</p>` : ""}</div>
        ${(() => { const withL = r.items.filter((it) => it.links.length).length, total = r.items.reduce((t, it) => t + it.links.length, 0), miss = r.items.length - withL;
          return `<div class="found ${miss ? "part" : "all"}"><span><b>${total}</b> ${plural(total, "товар", "товара", "товаров")} для ${withL} из ${r.items.length} ${plural(r.items.length, "вещи", "вещей", "вещей")}</span>${miss ? (S.br?.kind === "lookmore" ? "" : `<button class="btn cherry" style="padding:6px 12px;font-size:13px" data-act="look-more">✦ Найти товары ещё для ${miss}</button>`) : ""}</div>${S.br?.kind === "lookmore" ? bridgeBox("lookmore") : ""}${!total ? '<div class="notice warn small">Claude не прислал ссылок на товары. Скорее всего, в чате был выключен веб-поиск: включи его и нажми «Найти товары ещё».</div>' : ""}`; })()}
        ${r.items.map((it, n) => shopItem(it, n)).join("")}
      </div>
    </div>`;
  }
  if (S.looks.length) h += `<div class="stack" style="margin-top:24px"><h3>Сохранённые разборы</h3><div class="looks-grid">${S.looks.map((l) => `<button class="look-card" data-act="look-open" data-id="${l.id}">${S.urls[l.photoKey] ? `<img src="${S.urls[l.photoKey]}" alt="">` : ""}<span><b>${esc(l.title)}</b><span class="muted small">${l.items.length} ${plural(l.items.length, "вещь", "вещи", "вещей")}</span></span></button>`).join("")}</div></div>`;
  return h;
}
// Вырезки вещей из коллажа: по рамке bbox от Claude (или вокруг центра), кэшируются в памяти.
const crops = {};
const cropKey = (n) => `${S.lookRes?.id || "tmp"}:${n}`;
async function lookBlob() {
  const r = S.lookRes;
  if (r?.photoKey) return store.get("photos", r.photoKey);
  return S.lookImg?.blob || null;
}
async function buildCrops() {
  const r = S.lookRes; if (!r) return;
  const todo = r.items.map((it, n) => [it, n]).filter(([, n]) => !(cropKey(n) in crops));
  if (!todo.length) return;
  todo.forEach(([, n]) => (crops[cropKey(n)] = null)); // помечаем сразу, чтобы не запускать повторно
  const blob = await lookBlob(); if (!blob) return;
  const bmp = await createImageBitmap(blob);
  for (const [it, n] of todo) {
    let box = it.bbox;
    if (!box && it.x !== null && it.y !== null) box = [it.x - 0.14, it.y - 0.14, it.x + 0.14, it.y + 0.14];
    if (!box) continue;
    const pad = 0.02;
    const [x1, y1, x2, y2] = [Math.max(0, box[0] - pad), Math.max(0, box[1] - pad), Math.min(1, box[2] + pad), Math.min(1, box[3] + pad)];
    const sw = (x2 - x1) * bmp.width, sh = (y2 - y1) * bmp.height;
    if (sw < 8 || sh < 8) continue;
    const k = Math.min(1, 700 / Math.max(sw, sh));
    const cv = document.createElement("canvas");
    cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
    const g = cv.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(bmp, x1 * bmp.width, y1 * bmp.height, sw, sh, 0, 0, cv.width, cv.height);
    const png = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!png) continue;
    crops[cropKey(n)] = { url: URL.createObjectURL(png), png, small: cv.toDataURL("image/jpeg", 0.8) };
  }
  if (S.tab === "look") render();
}
async function copyCrop(n) {
  const c = crops[cropKey(n)]; if (!c) return;
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": c.png })]); toast("Фото вещи скопировано. Вставь его в поиск по фото"); }
  catch { toast("Браузер не дал скопировать картинку. Нажми «Скачать» и загрузи файл в поиск по фото"); }
}
const MATCH_T = { exact: ["та же вещь", ""], very_close: ["очень похожа", ""], similar: ["похожа по духу", " warn"] };
function productCard(l) {
  const sh = SHOPS[l.shop], mt = MATCH_T[l.match] || MATCH_T.similar;
  return `<a class="prod" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
    <span class="prod-shop ${l.shop}">${esc(sh.title)}</span>
    <span class="prod-body"><b>${esc(l.title || "Товар")}</b>${l.note ? `<span class="muted small">${esc(l.note)}</span>` : ""}</span>
    <span class="prod-side">${l.price ? `<b class="prod-price">${esc(l.price)}</b>` : ""}<span class="pill${mt[1]}">${mt[0]}</span><span class="prod-go">Открыть ↗</span></span>
  </a>`;
}
function shopItem(it, n) {
  const c = COL[it.color];
  const pal = analysis()?.palette || [];
  const fit = !c ? "" : c.kind === "avoid" ? (["top", "outer", "dress"].includes(it.cat) ? '<span class="pill bad">не у лица</span>' : '<span class="pill warn">не твой цвет</span>') : pal.includes(it.color) ? '<span class="pill">в твоей палитре</span>' : "";
  const m = lookMatches(it);
  const inWish = S.wishlist.some((w) => w.fromLook === it.query && !w.done);
  const cr = crops[cropKey(n)];
  return `<div class="shop-item">
    <div class="si-head">${cr ? `<img class="si-crop" src="${cr.url}" alt="${esc(it.name)}">` : ""}
      <div class="stack" style="gap:4px;min-width:0"><div class="row" style="gap:8px;align-items:center"><span class="lg-n">${n + 1}</span><b>${esc(it.name)}</b>${fit}</div>
        <span class="muted small">${esc(CATT[it.cat] || "")}${c ? ` · <i class="dot" style="background:${c.hex}"></i> ${esc(c.t)}` : ""}</span>
        ${it.details ? `<p class="small" style="margin:0">${esc(it.details)}</p>` : ""}</div></div>
    ${it.links.length ? `<div class="prods">${it.links.map(productCard).join("")}</div>` : '<div class="notice small">Для этой вещи товаров пока нет. Нажми «Найти товары ещё» выше или найди по фото.</div>'}
    <details class="si-more"><summary>Искать самой: по фото или по запросу</summary>
      ${cr ? `<div class="stack" style="gap:6px"><div class="row" style="gap:6px"><button class="btn ghost" style="padding:6px 12px;font-size:13px" data-act="crop-copy" data-n="${n}">Скопировать фото вещи</button><a class="btn ghost" style="padding:6px 12px;font-size:13px" href="${cr.url}" download="вещь-${n + 1}.png">Скачать</a></div>
        <span class="muted small">Вставь фото в поиск по картинке: <a href="${SHOPS.wb.photo}" target="_blank" rel="noopener">Wildberries</a> и <a href="${SHOPS.ozon.photo}" target="_blank" rel="noopener">Ozon</a> — значок камеры в строке поиска, <a href="https://ya.ru/images/" target="_blank" rel="noopener">Яндекс Картинки</a>.</span></div>` : ""}
      ${it.query ? `<span class="muted small">По запросу «${esc(it.query)}»: ${Object.entries(SHOPS).map(([k, sh]) => `<a href="${sh.search(it.query)}" target="_blank" rel="noopener noreferrer">${sh.title}</a>`).join(" · ")}</span>` : ""}
    </details>
    <div class="row between" style="gap:8px">${m.list.length ? `<span class="stack" style="gap:4px"><span class="small muted">${m.exact ? "У тебя уже есть похожее" : "Можно заменить своим"}</span>${miniRow(m.list.map((x) => x.id))}</span>` : '<span class="small muted">Похожего в гардеробе нет</span>'}
      <button class="btn ghost" style="padding:5px 10px;font-size:12.5px" data-act="look-wish" data-n="${n}"${inWish ? " disabled" : ""}>${inWish ? "В вишлисте" : "В вишлист"}</button></div>
  </div>`;
}

/* ---------- вишлист ---------- */
function viewWishlist() {
  const open = S.wishlist.filter((w) => !w.done), done = S.wishlist.filter((w) => w.done);
  const card = (w) => `<div class="wcard${w.done ? " done" : ""}">
      ${w.crop ? `<img class="wc-img" src="${w.crop}" alt="">` : `<i class="wc-img sw" style="background:${(COL[w.color] || {}).hex || "var(--sunk)"}"></i>`}
      <div class="stack" style="gap:4px;min-width:0"><b>${esc(w.title)}</b>
        <span class="muted small">${[CATT[w.cat], (COL[w.color] || {}).t, w.source].filter(Boolean).map(esc).join(" · ")}</span>
        ${w.links?.length && !w.done ? `<div class="prods">${w.links.filter((l) => SHOPS[l.shop]).map(productCard).join("")}</div>` : ""}
        ${w.query && !w.done && !w.links?.length ? `<div class="row" style="gap:6px">${Object.entries(SHOPS).map(([k, sh]) => `<a class="shopbtn ${k}" href="${sh.search(w.query)}" target="_blank" rel="noopener noreferrer">${sh.title} ↗</a>`).join("")}</div>` : ""}
        <div class="row" style="gap:8px">${w.done ? '<span class="pill">куплено</span>' : `<button class="btn ghost" style="padding:5px 10px;font-size:12.5px" data-act="wish-bought" data-id="${w.id}">Купила</button>`}<button class="linkbtn" data-act="wish-del" data-id="${w.id}">убрать</button></div>
      </div></div>`;
  return `<div class="stack" style="gap:2px"><h2>Вишлист</h2><span class="muted small">Вещи, которые хочешь купить: из разобранных образов, из подсказок «Чего не хватает» и свои</span></div>
    <form class="row" id="wish-form" style="gap:8px;margin-top:14px"><label class="f" style="flex:1;min-width:200px"><span class="sr">Что купить</span><input type="text" id="wish-in" placeholder="Например: серебряные серьги-кольца" maxlength="80"></label><button class="btn cherry" type="submit">Добавить</button></form>
    ${open.length ? `<div class="wgrid" style="margin-top:14px">${open.map(card).join("")}</div>` : '<div class="empty" style="margin-top:14px">Пока пусто. Добавляй вещи кнопкой «В вишлист» во вкладках «Найти образ» и «Статистика» или впиши свою выше.</div>'}
    ${done.length ? `<details style="margin-top:18px"><summary class="small" style="cursor:pointer">Куплено · ${done.length}</summary><div class="wgrid" style="margin-top:10px">${done.map(card).join("")}</div></details>` : ""}`;
}

async function setLookFile(file) {
  if (!file || !/^image\//.test(file.type)) { toast("Нужна картинка: JPG, PNG или WebP"); return; }
  try {
    const b = await downscale(file, 1400);
    if (S.lookImg) URL.revokeObjectURL(S.lookImg.url);
    S.lookImg = { blob: b, url: URL.createObjectURL(b) }; S.lookRes = null; if (S.br?.kind === "look") S.br = null; render();
  } catch { toast("Не получилось открыть эту картинку"); }
}

/* ---------- точность: уверенность, справочник, драпировка ---------- */
function confPill(c) {
  if (!c) return "";
  const t = { high: ["высокая уверенность", ""], medium: ["средняя уверенность", " warn"], low: ["низкая уверенность", " bad"] }[c];
  return t ? `<span class="pill${t[1]}">${t[0]}</span>` : "";
}
function kbBlock(a) {
  const s = SEASON_KB[a.season], k = KIBBE_KB[a.kibbe], arch = (a.archetypes || []).map((x) => [x, ARCHETYPES[x]]).filter((x) => x[1]);
  if (!s && !k && !arch.length) return "";
  const nb = s ? s.neighbors.map((n) => SEASON_KB[n]?.name).filter(Boolean).join(" и ") : "";
  return `<div class="stack" style="gap:10px"><span class="k" style="font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)">Справочник по твоему типажу</span>
  <div class="an-grid two">
    ${s ? `<div class="an-card kb"><span class="k">${esc(s.name)}</span><p class="small">${esc(s.look)}</p>
      <dl><dt>Ведущая черта</dt><dd>${esc(s.lead)}, затем ${esc(s.second)}</dd><dt>Лучшие цвета</dt><dd>${esc(s.best)}</dd><dt>Осторожно</dt><dd>${esc(s.avoid)}</dd><dt>Металл</dt><dd>${esc(s.metal)}</dd>${nb ? `<dt>Соседние типы</dt><dd>${esc(nb)}: если сомневаешься, сравни с ними</dd>` : ""}</dl>
      ${swatches(s.keys)}</div>` : ""}
    ${k ? `<div class="an-card kb"><span class="k">${esc(k.ru)} · ${esc(k.name)} · ${esc(k.yy)}</span><p class="small">${esc(k.look)}</p>
      <dl><dt>Силуэт</dt><dd>${esc(k.silhouette)}</dd><dt>Ткани</dt><dd>${esc(k.fabrics)}</dd><dt>Детали</dt><dd>${esc(k.details)}</dd><dt>Избегать</dt><dd>${esc(k.avoid)}</dd></dl></div>` : ""}
  </div>
  ${arch.length ? `<div class="an-grid two">${arch.map(([key, x]) => `<div class="an-card kb"><span class="k">Архетип · ${esc(x.name)}</span><b>${esc(x.idea)}</b><p class="small">${esc(x.style)}</p><div class="chips">${x.aesthetics.split(", ").map((t) => `<a class="chip" href="https://www.pinterest.com/search/pins/?q=${encodeURIComponent(t + " outfit")}" target="_blank" rel="noopener">${esc(t)}</a>`).join("")}</div></div>`).join("")}</div>` : ""}
  </div>`;
}
const DRAPE_T = { cool: "холодный", warm: "тёплый", soft: "мягкая", clear: "чистая", light: "светлая", deep: "глубокая" };
function drapeCompare(a) {
  const d = S.profile?.drape; if (!d) return "";
  const sc = a.scales || {};
  const rows = [["undertone", "Подтон"], ["chroma", "Насыщенность"], ["depth", "Глубина"]].filter(([k]) => d[k]).map(([k, l]) => {
    const claude = k === "chroma" ? (sc.chroma === "medium" ? "" : sc.chroma) : sc[k] === "neutral" || sc[k] === "medium" ? "" : sc[k];
    const same = claude && claude === d[k];
    return `<li>${l}: драпировка — <b>${DRAPE_T[d[k]]}</b>${claude ? (same ? " ✓ совпадает" : ` · разбор — ${DRAPE_T[claude] || claude} <span class="pill warn">расходится</span>`) : ""}</li>`;
  });
  return rows.length ? `<div class="drape-sum"><span class="small muted">Цифровая драпировка</span><ul>${rows.join("")}</ul></div>` : "";
}
function drapeBand(key) {
  const a = analysis(); const idx = (S.profile?.photos || []).indexOf(key) + 1;
  const ys = (a?.markers || []).filter((m) => m.photo === idx && ["lips", "skin", "face"].includes(m.kind)).map((m) => m.y);
  const top = ys.length ? Math.max(...ys) + 0.13 : 0.7;
  return Math.min(0.86, Math.max(0.55, top));
}
function drapeBlock() {
  const photos = (S.profile?.photos || []).filter((k) => S.urls[k]);
  if (!photos.length) return "";
  const dr = S.drape;
  if (!dr) return `<div class="an-card drape"><span class="k">Проверка драпировкой</span><p class="small">Как у колориста, только на твоём фото: ${DRAPE_ROUNDS.length} пар цветов у лица, выбирай, с каким лицо выглядит свежее, кожа ровнее, а глаза ярче. Лучше смотреть на экране с нормальной яркостью, без ночного режима.</p>
    <div class="row">${photos.map((k, i) => `<button class="btn ${i ? "ghost" : "cherry"}" data-act="drape-start" data-k="${k}">${photos.length > 1 ? `С фото ${i + 1}` : "Начать драпировку"}</button>`).join("")}</div></div>`;
  if (dr.done) {
    const d = S.profile?.drape || {};
    return `<div class="an-card drape"><span class="k">Драпировка готова</span><ul class="small">${["undertone", "chroma", "depth"].map((k) => `<li>${{ undertone: "Подтон", chroma: "Насыщенность", depth: "Глубина" }[k]}: ${d[k] ? `<b>${DRAPE_T[d[k]]}</b>` : "разницы не видно"}</li>`).join("")}</ul>
      <p class="small">Сравнение с разбором — в карточке цветотипа выше. Если есть расхождения, уточни разбор: сайт добавит результат драпировки в запрос.</p>
      <div class="row"><button class="btn cherry" data-act="drape-reanalyze">✦ Уточнить разбор с драпировкой</button><button class="btn ghost" data-act="drape-close">Готово</button></div></div>`;
  }
  const r = DRAPE_ROUNDS[dr.i], url = S.urls[dr.key], band = drapeBand(dr.key);
  const side = (c, v) => `<button class="drape-opt" data-act="drape-pick" data-v="${v}" aria-label="${esc(c.t)}"><span class="drape-img"><img src="${url}" alt=""><i style="top:${(band * 100).toFixed(0)}%;background:${c.hex}"></i></span><span class="small">${esc(c.t)}</span></button>`;
  return `<div class="an-card drape"><div class="row between"><span class="k">Драпировка · ${dr.i + 1} из ${DRAPE_ROUNDS.length}</span><button class="linkbtn" data-act="drape-close">прервать</button></div>
    <p class="small">С каким цветом лицо выглядит свежее? Смотри на кожу и глаза, а не на то, какой цвет нравится.</p>
    <div class="drape-pair">${side(r.a, r.a.v)}${side(r.b, r.b.v)}</div>
    <div class="row"><button class="btn ghost" data-act="drape-pick" data-v="same">Не вижу разницы</button></div></div>`;
}

/* ---------- события ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { if (S.br && S.br.kind !== "analyze") S.br = null; S.tab = d.tab; try { sessionStorage.setItem("wd-tab", S.tab); } catch {} if (S.tab !== "wardrobe") { S.edit = null; S.draft = null; } render(); $("tab-" + S.tab)?.focus(); return; }
  if (d.filter) { S.filter = d.filter; render(); return; }
  if (d.edit) { const it = byId(d.edit); if (!it) return; S.edit = it.id; S.draft = { name: it.name, cat: it.cat, color: it.color, seasons: [...(it.seasons || [])], styles: [...(it.styles || [])], photo_path: it.photo_path, file: null, preview: null, price: it.price ?? "" }; render(); window.scrollTo(0, 0); return; }
  if (d.season) { readForm(); const a = S.draft.seasons, i = a.indexOf(d.season); i >= 0 ? a.splice(i, 1) : a.push(d.season); render(); return; }
  if (d.style) { readForm(); const a = S.draft.styles, i = a.indexOf(d.style); i >= 0 ? a.splice(i, 1) : a.push(d.style); render(); return; }
  if (d.slot) { S.activeSlot = d.slot; render(); return; }
  if (d.pick) { choose(d.pick); return; }
  switch (d.act) {
    case "export": {
      toast("Собираю копию…");
      const data = await exportAll();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = `гардероб-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return;
    }
    case "import-no": S.importConfirm = null; render(); return;
    case "import-yes": {
      try {
        await importAll(S.importConfirm);
        Object.values(S.urls).forEach((u) => URL.revokeObjectURL(u)); S.urls = {};
        S.importConfirm = null; S.loaded = false; toast("Копия загружена"); await loadAll();
      } catch (err) { S.importConfirm = null; toast(err.message || "Не получилось загрузить копию"); render(); }
      return;
    }
    case "new": S.edit = "new"; S.draft = blankDraft(); render(); window.scrollTo(0, 0); return;
    case "goto-add": S.tab = "wardrobe"; S.edit = "new"; S.draft = blankDraft(); S.draft.cat = d.cat; render(); window.scrollTo(0, 0); return;
    case "cancel": closeForm(); return;
    case "del": S.delConfirm = S.edit; render(); return;
    case "del-no": S.delConfirm = null; render(); return;
    case "del-yes": deleteItem(S.edit); return;
    case "autotag": autotag(); return;
    case "locate": locate(); return;
    case "city-edit": S.editCity = true; render(); return;
    case "w-refresh": refreshWeather(true); return;
    case "today-more": S.seed++; render(); return;
    case "today-wear": { const o = S.todayList?.[+d.n]; if (o) logWear(o.items, "today"); return; }
    case "today-open": { const o = S.todayList?.[+d.n]; if (o) tryOutfit(o); return; }
    case "today-save": { const o = S.todayList?.[+d.n]; if (o) saveOutfit(o.items, "На каждый день", S.weather ? "Под погоду: " + weatherPhrase() : "", "manual"); return; }
    case "today-ai": S.req.weather = weatherPhrase(); S.req.occasion ||= "на каждый день"; S.tab = "builder"; askAI(); window.scrollTo(0, 0); return;
    case "wear-build": logWear(outfitIds(), "builder"); return;
    case "wear-outfit": { const o = S.outfits.find((x) => x.id === d.id); if (o) logWear(o.items, "outfit"); return; }
    case "unwear": S.wears = S.wears.filter((w) => w.date !== d.date); await saveKv("wears", S.wears); if (S.calDay === d.date) S.calDay = null; toast("Отметка снята"); render(); return;
    case "cal-day": S.calDay = S.calDay === d.d ? null : d.d; render(); return;
    case "cal-prev": case "cal-next": { const [y, m] = S.calMonth.split("-").map(Number); const dt = new Date(y, m - 1 + (d.act === "cal-next" ? 1 : -1), 1); S.calMonth = dayKey(dt).slice(0, 7); S.calDay = null; render(); return; }
    case "build-with": { const it = byId(d.id); if (!it) return; S.build = EMPTY_BUILD(); if (it.cat === "acc") S.build.acc = [it.id]; else S.build[it.cat] = it.id; S.activeSlot = it.cat === "dress" ? "shoes" : it.cat === "top" ? "bottom" : "top"; S.fwOnly = false; S.tab = "builder"; render(); window.scrollTo(0, 0); return; }
    case "wish-add": {
      const g = wardrobeGaps(S.items, kindOf, { palette: analysis()?.palette || [] }).ideas.find((x) => x.key === d.key);
      if (!g) return;
      S.wishlist = [...S.wishlist, { id: newId(), key: g.key, title: g.title, cat: g.cat, color: g.color, query: `${(COL[g.color] || {}).t || ""} ${CATT[g.cat].toLowerCase()}`.trim(), source: "подсказка «Чего не хватает»", done: false, created_at: Date.now() }];
      await saveKv("wishlist", S.wishlist); toast("Добавлено в вишлист"); render(); return;
    }
    case "wish-del": S.wishlist = S.wishlist.filter((w) => w.id !== d.id); await saveKv("wishlist", S.wishlist); render(); return;
    case "wish-bought": {
      const w = S.wishlist.find((x) => x.id === d.id); if (!w) return;
      S.wishlist = S.wishlist.map((x) => (x.id === d.id ? { ...x, done: true } : x)); await saveKv("wishlist", S.wishlist);
      S.tab = "wardrobe"; S.edit = "new"; S.draft = { ...blankDraft(), name: w.key ? "" : w.title, cat: w.cat || "top", color: w.color || "black" };
      toast("Добавь купленную вещь в гардероб"); render(); window.scrollTo(0, 0); return;
    }
    case "look-go": openBridge("look", lookPrompt()); return;
    case "look-reset": case "look-new": if (S.lookImg && !S.lookRes?.photoKey) URL.revokeObjectURL(S.lookImg.url); S.lookImg = null; S.lookRes = null; if (S.br?.kind === "look") S.br = null; render(); return;
    case "look-save": {
      const r = S.lookRes; if (!r || !S.lookImg) return;
      const key = "look-" + newId();
      await store.put("photos", S.lookImg.blob, key);
      S.urls[key] = S.lookImg.url; S.lookImg = null;
      const saved = { ...r, id: newId(), photoKey: key };
      S.looks = [saved, ...S.looks]; S.lookRes = saved;
      await saveKv("looks", S.looks); toast("Разбор сохранён"); render(); return;
    }
    case "look-open": { const l = S.looks.find((x) => x.id === d.id); if (l) { S.lookRes = l; S.lookImg = null; render(); window.scrollTo(0, 0); } return; }
    case "look-del": {
      const l = S.looks.find((x) => x.id === d.id); if (!l) return;
      S.looks = S.looks.filter((x) => x.id !== d.id); await saveKv("looks", S.looks);
      store.del("photos", l.photoKey).catch(() => {}); dropUrl(l.photoKey); S.lookRes = null; toast("Разбор удалён"); render(); return;
    }
    case "look-wish": {
      const it = S.lookRes?.items[+d.n]; if (!it) return;
      const cr = crops[cropKey(+d.n)];
      S.wishlist = [...S.wishlist, { id: newId(), title: it.name, cat: it.cat, color: it.color, fromLook: it.query, query: it.query, links: it.links, crop: cr?.small || null, source: "из образа «" + (S.lookRes.title || "") + "»", done: false, created_at: Date.now() }];
      await saveKv("wishlist", S.wishlist); toast("Добавлено в вишлист"); render(); return;
    }
    case "crop-copy": copyCrop(+d.n); return;
    case "look-more": if (S.lookRes) { openBridge("lookmore", lookMorePrompt(S.lookRes)); document.querySelector(".bridge")?.scrollIntoView({ block: "center" }); } return;
    case "look-build": {
      const r = S.lookRes; if (!r) return;
      const ids = [];
      for (const it of r.items) { const m = lookMatches(it); if (m.list[0] && !ids.includes(m.list[0].id)) ids.push(m.list[0].id); }
      if (ids.length < 2) { toast("В гардеробе мало похожих вещей"); return; }
      tryOutfit({ items: ids }); toast("Собрала из похожих вещей, проверь в конструкторе"); return;
    }
    case "cap-preset": S.cap.preset = d.k; render(); return;
    case "cap-season": S.cap.season = d.k; render(); return;
    case "cap-style": { const a = S.cap.styles, i = a.indexOf(d.k); i >= 0 ? a.splice(i, 1) : a.push(d.k); render(); return; }
    case "cap-build": S.capResult = { ...buildCapsule(S.items, kindOf, S.cap), checked: [] }; render(); return;
    case "cap-save": {
      const r = S.capResult; if (!r) return;
      const name = `${r.title} · ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
      S.capsules = [{ ...r, id: newId(), name, created_at: Date.now() }, ...S.capsules]; S.capResult = null;
      await saveKv("capsules", S.capsules); toast("Капсула сохранена"); render(); return;
    }
    case "cap-del": S.capsules = S.capsules.filter((c) => c.id !== d.id); await saveKv("capsules", S.capsules); render(); return;
    case "br-copy": copyPrompt(); return;
    case "br-apply": applyAnswer(); return;
    case "br-close": S.br = null; render(); return;
    case "no-dress": S.build.dress = null; S.activeSlot = "top"; render(); return;
    case "fw": S.fwOnly = !S.fwOnly; render(); return;
    case "shuffle": autoBuild(); return;
    case "clear": S.build = EMPTY_BUILD(); render(); return;
    case "save-outfit": saveOutfit(outfitIds(), $("outfit-title")?.value, "", "manual"); return;
    case "ai-go": askAI(); return;
    case "ai-try": { const o = S.ai.out?.outfits[+d.n]; if (o) tryOutfit(o); return; }
    case "ai-save": { const o = S.ai.out?.outfits[+d.n]; if (o) { t.disabled = true; saveOutfit(o.items, o.title, o.why, "ai"); } return; }
    case "out-open": { const o = S.outfits.find((x) => x.id === d.id); if (o) tryOutfit(o); return; }
    case "out-del": S.outDel = d.id; render(); return;
    case "out-del-no": S.outDel = null; render(); return;
    case "out-del-yes": {
      try { await store.del("outfits", d.id); } catch { toast("Не получилось удалить"); return; }
      S.outDel = null; await reloadOutfits(); render(); toast("Образ удалён"); return;
    }
    case "an-go": openBridge("analyze", analyzePrompt(S.selfies.length, analyzeCtx()), { n: S.selfies.length }); return;
    case "an-mode": S.anMode = d.m; refreshAnalyzeBridge(); render(); return;
    case "drape-start": { const k = d.k; S.drape = { key: k, i: 0, answers: {} }; render(); document.querySelector(".drape")?.scrollIntoView({ block: "start" }); return; }
    case "drape-pick": {
      if (!S.drape) return;
      S.drape.answers[S.drape.i] = d.v; S.drape.i++;
      if (S.drape.i >= DRAPE_ROUNDS.length) {
        const sum = drapeSummary(S.drape.answers);
        await setProfile({ ...S.profile, drape: { ...sum, at: Date.now() } });
        S.drape.done = true;
      }
      render(); return;
    }
    case "drape-close": S.drape = null; render(); return;
    case "drape-reanalyze": {
      S.drape = null;
      const n = (S.profile?.photos || []).length;
      openBridge("analyze", analyzePrompt(n, { quiz: S.quiz, drape: S.profile?.drape }), { n });
      render(); document.querySelector(".bridge")?.scrollIntoView({ block: "center" }); return;
    }
    case "selfie-rm": { const x = S.selfies.splice(+d.i, 1)[0]; if (x) URL.revokeObjectURL(x.url); refreshAnalyzeBridge(); render(); return; }
    case "look": S.viewPhoto = +d.i; render(); return;
    case "skip-onb": S.skipOnb = true; try { sessionStorage.setItem("wd-skip", "1"); } catch {} render(); return;
    case "p-save": saveProfileText($("p-text").value.trim() || null); return;
    case "p-reset": saveProfileText(null); return;
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  if (e.target.id === "item-form") saveItem();
  if (e.target.id === "city-form") { const q = $("city-in").value.trim(); if (q) { S.cityDraft = q; S.editCity = false; setCity(q); } }
  if (e.target.id === "wish-form") {
    const t = $("wish-in").value.trim(); if (!t) return;
    S.wishlist = [...S.wishlist, { id: newId(), title: t.slice(0, 80), done: false, created_at: Date.now() }];
    saveKv("wishlist", S.wishlist).then(render);
  }
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "f-photo" && e.target.files?.[0]) setFile(e.target.files[0]);
  if (id === "look-in" && e.target.files?.[0]) setLookFile(e.target.files[0]);
  if (id === "selfie-in" && e.target.files?.length) addSelfies(e.target.files);
  if (id === "import-in" && e.target.files?.[0]) {
    e.target.files[0].text().then((t) => { try { S.importConfirm = JSON.parse(t); } catch { toast("Файл не похож на копию гардероба"); } render(); });
  }
  if (id === "f-color" || id === "f-cat") { readForm(); render(); }
  if (e.target.dataset?.quiz) { S.quiz = { ...S.quiz, [e.target.dataset.quiz]: e.target.value }; saveKv("quiz", S.quiz); refreshAnalyzeBridge(); if (S.br?.kind === "analyze") render(); }
  if (e.target.dataset?.cap) {
    const capId = e.target.dataset.cap, item = e.target.dataset.item, on = e.target.checked;
    const upd = (c) => ({ ...c, checked: on ? [...new Set([...(c.checked || []), item])] : (c.checked || []).filter((x) => x !== item) });
    if (capId === "new") { S.capResult = upd(S.capResult); }
    else { S.capsules = S.capsules.map((c) => (c.id === capId ? upd(c) : c)); saveKv("capsules", S.capsules).then(render); }
  }
});
document.addEventListener("input", (e) => {
  if (/^r-/.test(e.target.id)) S.req[e.target.id.slice(2)] = e.target.value;
  if (e.target.id === "br-answer" && S.br) S.br.answer = e.target.value;
});
document.addEventListener("dragover", (e) => { if (e.target.closest?.(".look-drop")) e.preventDefault(); const z = e.target.closest?.("#drop"); if (z) { e.preventDefault(); z.classList.add("over"); } });
document.addEventListener("dragleave", (e) => { e.target.closest?.("#drop")?.classList.remove("over"); });
document.addEventListener("drop", (e) => { const lz = e.target.closest?.(".look-drop"); if (lz) { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setLookFile(f); return; } const z = e.target.closest?.("#drop"); if (z) { e.preventDefault(); z.classList.remove("over"); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); } });

/* ---------- запуск ---------- */
persist();
loadAll();
