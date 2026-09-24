import { store, byNewest, persist, exportAll, importAll } from "./db.js";
import { CATS, COLORS, STYLES, SEASONS } from "./catalog.js";
import { CHAT_URL, analyzePrompt, parseAnalysis, tagPrompt, parseTag, outfitsPrompt, parseOutfits } from "./bridge.js";

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
  skipOnb: false, outDel: null,
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
      <li>Открой <a href="${CHAT_URL}" target="_blank" rel="noopener">claude.ai</a> в новой вкладке, ${HINTS[kind]}, вставь запрос и отправь.</li>
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
      await setProfile({ analysis: parseAnalysis(b.answer), text: null });
      S.br = null; S.tab = "profile";
      try { sessionStorage.setItem("wd-tab", "profile"); } catch {}
      toast("Типаж определён"); render(); window.scrollTo(0, 0);
    } else if (b.kind === "tag") {
      readForm();
      Object.assign(S.draft, parseTag(b.answer));
      S.br = null; toast("Заполнила по фото, проверь поля"); render();
    } else if (b.kind === "outfits") {
      S.ai.out = parseOutfits(b.answer, b.map);
      S.br = null; render();
    }
  } catch (e) { b.err = e.message; render(); }
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
  for (const it of S.items) {
    if (!it.photo_path || S.urls[it.photo_path]) continue;
    const b = await store.get("photos", it.photo_path);
    if (b) S.urls[it.photo_path] = URL.createObjectURL(b);
  }
}
async function reloadItems() { S.items = (await store.all("items")).sort(byNewest); await photoUrls(); }
async function reloadOutfits() { S.outfits = (await store.all("outfits")).sort(byNewest); }
async function setProfile(p) { S.profile = p; await store.put("kv", p, "profile"); applyKinds(analysis()); }
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
    return `<div class="idea"><div class="row between"><b>${esc(o.title)}</b><span class="muted small">${o.source === "ai" ? "✦ стилист" : "сама"}</span></div>
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
  return S.br?.kind === "analyze" ? bridgeBox("analyze") : '<div class="row"><button class="btn cherry" data-act="an-go">✦ Определить мой типаж</button></div>';
}
function viewOnboarding() {
  return `<div class="hero"><div class="stack" style="gap:8px"><span class="muted small" style="font-family:var(--mono);letter-spacing:.07em;text-transform:uppercase">Перед стартом</span>
    <h1>Сначала разберём твой <em>типаж</em></h1>
    <p class="lead muted">Разбор делает Claude в обычном чате на claude.ai, подойдёт и бесплатный аккаунт. Сайт подготовит запрос, ты отправишь его вместе с 2–5 своими фото (лицо при дневном свете, без фильтров) и вставишь ответ сюда. Потом сайт будет подбирать образы и предупреждать о неподходящих цветах. Фото остаются только в твоём чате, а гардероб хранится в этом браузере.</p></div>
    ${analyzeControls()}
    <button class="btn ghost" style="justify-self:start" data-act="skip-onb">Пропустить и сразу к вещам</button></div>`;
}
function viewAnalysis(a) {
  const chips = (keys, warn) => '<div class="chips">' + (keys || []).filter((k) => COL[k]).map((k) => `<span class="chip" style="cursor:default${warn ? ";color:var(--warn)" : ""}"><i class="dot" style="background:${COL[k].hex}"></i>${esc(COL[k].t)}</span>`).join("") + "</div>";
  const ct = a.colortype || {}, ty = a.type || {};
  return `<div class="an">${a.summary ? `<p class="lead">${esc(a.summary)}</p>` : ""}
    <div class="an-grid">
      <div class="an-card"><span class="k">Цветотип</span><b>${esc(ct.name || "—")}</b><p><span class="muted">Подтон:</span> ${esc(ct.undertone)}</p><p><span class="muted">Глаза:</span> ${esc(ct.eyes)}</p><p><span class="muted">Волосы:</span> ${esc(ct.hair)}</p><p><span class="muted">Контраст:</span> ${esc(ct.contrast)}</p></div>
      <div class="an-card"><span class="k">Типаж внешности</span><b>${esc(ty.name || "—")}</b><p>${esc(ty.features)}</p></div>
      <div class="an-card"><span class="k">Формула стиля</span><b>${esc(a.formula || "—")}</b>${a.aesthetics?.length ? `<p class="muted">${esc(a.aesthetics.join(" · "))}</p>` : ""}</div>
    </div>
    <div class="an-grid">
      <div class="an-card"><span class="k">Твоя палитра</span>${chips(a.palette)}<p class="muted small">Металл: ${esc(a.metal)}</p></div>
      <div class="an-card"><span class="k">Лучше не у лица</span>${chips(a.avoid, true)}</div>
    </div>
    <div class="an-grid">
      ${a.hair ? `<div class="an-card"><span class="k">Волосы</span><p>${esc(a.hair)}</p></div>` : ""}
      ${a.makeup ? `<div class="an-card"><span class="k">Макияж</span><p>${esc(a.makeup)}</p></div>` : ""}
      ${a.tips?.length ? `<div class="an-card"><span class="k">Советы</span><ul>${a.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
    </div>
    ${a.unsure ? `<p class="muted small">Что по фото определить не получилось: ${esc(a.unsure)}</p>` : ""}</div>`;
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
    case "an-go": openBridge("analyze", analyzePrompt()); return;
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
