import { store, byNewest, persist, exportAll, importAll } from "./db.js";
import { CATS, COLORS, STYLES, SEASONS, SEASON_TYPES, SCALES } from "./catalog.js";
import { PINS } from "./pins.js";
import { CHAT_URL, MARK_KINDS, sampleable, analyzePrompt, parseAnalysis, tagPrompt, parseTag, outfitsPrompt, parseOutfits } from "./bridge.js";

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
  tab: "wardrobe", loaded: false, importConfirm: null, br: null,
  items: [], outfits: [], profile: null, urls: {},
  filter: "all", edit: null, draft: null, delConfirm: null, saving: false, formErr: null,
  build: EMPTY_BUILD(), activeSlot: "top", fwOnly: true,
  req: { occasion: "", weather: "", wish: "" },
  ai: { out: null },
  skipOnb: false, outDel: null, selfies: [], viewPhoto: 0,
};
try {
  S.tab = sessionStorage.getItem("wd-tab") || "wardrobe";
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
      const photos = await saveSelfies(an);
      await setProfile({ analysis: an, text: null, photos });
      S.br = null; S.tab = "profile"; S.viewPhoto = 0;
      try { sessionStorage.setItem("wd-tab", "profile"); } catch {}
      toast("Типаж определён"); render(); window.scrollTo(0, 0);
    } else if (b.kind === "tag") {
      readForm();
      Object.assign(S.draft, parseTag(b.answer));
      S.br = null; toast("Поля заполнены по фото, проверь их"); render();
    } else if (b.kind === "outfits") {
      S.ai.out = parseOutfits(b.answer, b.map);
      S.br = null; render();
    }
  } catch (e) { b.err = e.message; render(); }
}
// Сохраняет загруженные фото типажа и снимает с них оттенки в точках меток.
async function saveSelfies(an) {
  if (!S.selfies.length) return S.profile?.photos || [];
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
function refreshAnalyzeBridge() {
  if (S.br?.kind === "analyze") { S.br.n = S.selfies.length; S.br.prompt = analyzePrompt(S.selfies.length); }
}
async function addSelfies(files) {
  const list = [...files].filter((f) => /^image\//.test(f.type)).slice(0, 5 - S.selfies.length);
  for (const f of list) { try { const b = await downscale(f, 1200); S.selfies.push({ blob: b, url: URL.createObjectURL(b) }); } catch {} }
  refreshAnalyzeBridge(); render();
}
function selfieBlock() {
  return '<div class="selfies">' + S.selfies.map((x, i) => `<div class="selfie"><img src="${x.url}" alt="Фото ${i + 1}"><span class="num">${i + 1}</span><button type="button" class="rm" data-act="selfie-rm" data-i="${i}" aria-label="Убрать фото ${i + 1}">×</button></div>`).join("") +
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
    const [items, outfits, profile] = await Promise.all([store.all("items"), store.all("outfits"), store.get("kv", "profile")]);
    S.items = items.sort(byNewest);
    S.outfits = outfits.sort(byNewest);
    S.profile = profile || null;
  } catch (e) {
    console.error(e);
    $("main").innerHTML = '<div class="notice err">Браузер не даёт сохранять данные на этом сайте (например, в режиме инкогнито). Открой сайт в обычном окне.</div>';
    return;
  }
  applyKinds(analysis());
  await photoUrls();
  S.loaded = true;
  render();
}
async function photoUrls() {
  const keys = [...S.items.map((it) => it.photo_path), ...(S.profile?.photos || [])];
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
  const tabs = [["wardrobe", "Мои вещи", S.items.length], ["builder", "Конструктор", null], ["outfits", "Образы", S.outfits.length], ["profile", "Мой типаж", null]];
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
  else m.innerHTML = viewProfile();
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
const blankDraft = () => ({ name: "", cat: "top", color: "black", seasons: ["fw"], styles: [], photo_path: null, file: null, preview: null });
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
    const row = { name: d.name.trim().slice(0, 80), cat: d.cat, color: d.color, seasons: d.seasons, styles: d.styles, photo_path };
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
    <div class="row"><label class="f" style="flex:1;min-width:180px"><span class="sr">Название образа</span><input type="text" id="outfit-title" placeholder="Название образа, например «Пятница в городе»" maxlength="60"></label><button class="btn cherry" data-act="save-outfit"${ids.length < 2 ? " disabled" : ""}>Сохранить образ</button></div>
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
        : `<button class="btn ghost" style="${sm}" data-act="out-open" data-id="${esc(o.id)}">Открыть в конструкторе</button><button class="btn ghost" style="${sm}" data-act="out-del" data-id="${esc(o.id)}">Удалить</button>`}</div></div>`;
  }).join("") + "</div>";
}

/* ---------- типаж ---------- */
const colNames = (keys) => (keys || []).filter((k) => COL[k]).map((k) => COL[k].t);
function analyzeControls() {
  const up = `<div class="stack" style="gap:8px"><span class="small"><b>Твои фото</b> <span class="muted">(необязательно, до 5): на них появятся метки признаков типажа. Фото хранятся только в этом браузере.</span></span>${selfieBlock()}</div>`;
  return up + (S.br?.kind === "analyze" ? bridgeBox("analyze") : '<div class="row"><button class="btn cherry" data-act="an-go">✦ Определить мой типаж</button></div>');
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
      <div class="an-card"><span class="k">Цветотип</span><b>${esc(ct.name || SEASON_NAME[a.season] || "—")}</b>${a.season ? seasonGrid(a.season) : ""}${scaleRows(a)}</div>
      <div class="an-card"><span class="k">Типаж внешности</span><b>${esc(ty.name || "—")}</b>
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

/* ---------- события ---------- */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { if (S.br && S.br.kind !== "analyze") S.br = null; S.tab = d.tab; try { sessionStorage.setItem("wd-tab", S.tab); } catch {} if (S.tab !== "wardrobe") { S.edit = null; S.draft = null; } render(); $("tab-" + S.tab)?.focus(); return; }
  if (d.filter) { S.filter = d.filter; render(); return; }
  if (d.edit) { const it = byId(d.edit); if (!it) return; S.edit = it.id; S.draft = { name: it.name, cat: it.cat, color: it.color, seasons: [...(it.seasons || [])], styles: [...(it.styles || [])], photo_path: it.photo_path, file: null, preview: null }; render(); window.scrollTo(0, 0); return; }
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
    case "an-go": openBridge("analyze", analyzePrompt(S.selfies.length), { n: S.selfies.length }); return;
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
});
document.addEventListener("change", (e) => {
  const id = e.target.id;
  if (id === "f-photo" && e.target.files?.[0]) setFile(e.target.files[0]);
  if (id === "selfie-in" && e.target.files?.length) addSelfies(e.target.files);
  if (id === "import-in" && e.target.files?.[0]) {
    e.target.files[0].text().then((t) => { try { S.importConfirm = JSON.parse(t); } catch { toast("Файл не похож на копию гардероба"); } render(); });
  }
  if (id === "f-color" || id === "f-cat") { readForm(); render(); }
});
document.addEventListener("input", (e) => {
  if (/^r-/.test(e.target.id)) S.req[e.target.id.slice(2)] = e.target.value;
  if (e.target.id === "br-answer" && S.br) S.br.answer = e.target.value;
});
document.addEventListener("dragover", (e) => { const z = e.target.closest?.("#drop"); if (z) { e.preventDefault(); z.classList.add("over"); } });
document.addEventListener("dragleave", (e) => { e.target.closest?.("#drop")?.classList.remove("over"); });
document.addEventListener("drop", (e) => { const z = e.target.closest?.("#drop"); if (z) { e.preventDefault(); z.classList.remove("over"); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); } });

/* ---------- запуск ---------- */
persist();
loadAll();
