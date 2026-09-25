// Логика без интерфейса: погода, подбор образов, статистика носки, пробелы в гардеробе, капсулы.
// Функции чистые: цвет вещи оценивается через kindOf(colorKey) -> "neutral" | "accent" | "avoid".

/* ---------- погода ---------- */
const WMO = [
  [[0], "ясно", "☀️"], [[1, 2], "переменная облачность", "🌤"], [[3], "пасмурно", "☁️"],
  [[45, 48], "туман", "🌫"], [[51, 53, 55, 56, 57], "морось", "🌦"], [[61, 63, 65, 66, 67], "дождь", "🌧"],
  [[71, 73, 75, 77], "снег", "🌨"], [[80, 81, 82], "ливень", "🌧"], [[85, 86], "снегопад", "❄️"], [[95, 96, 99], "гроза", "⛈"],
];
export function weatherText(code) {
  const w = WMO.find((x) => x[0].includes(code));
  return w ? { text: w[1], icon: w[2] } : { text: "", icon: "" };
}

// Что погода значит для одежды.
export function weatherNeeds(w) {
  if (!w) return { season: "any", needOuter: false, noOuter: false, advice: [] };
  const t = w.feels ?? w.temp;
  const wet = w.rainChance >= 50 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95].includes(w.code);
  const snow = [71, 73, 75, 77, 85, 86].includes(w.code);
  const advice = [];
  if (t <= 0) advice.push("Мороз: тёплая верхняя одежда, шапка и перчатки.");
  else if (t <= 10) advice.push("Прохладно: нужна верхняя одежда.");
  else if (t <= 17) advice.push("Свежо: пригодится куртка или жакет.");
  else if (t >= 25) advice.push("Жарко: лёгкие ткани, без верхней одежды.");
  if (wet) advice.push("Возможен дождь: закрытая обувь и зонт.");
  if (snow) advice.push("Снег: обувь с нескользящей подошвой.");
  if (w.wind >= 30) advice.push("Сильный ветер: лучше без летящих юбок.");
  return {
    season: t <= 14 ? "fw" : t >= 20 ? "ss" : "any",
    needOuter: t <= 17,
    noOuter: t >= 23,
    wet, snow, advice,
  };
}

/* ---------- образы ---------- */
const FACE = new Set(["top", "outer", "dress"]);
const fits = (it, season) => season === "any" || !it.seasons?.length || it.seasons.includes(season);

// Оценка сочетания: чем выше, тем лучше. Возвращает и замечания.
export function scoreOutfit(its, kindOf) {
  let score = 0;
  const notes = [];
  const has = (c) => its.some((i) => i.cat === c);
  if (has("dress") || (has("top") && has("bottom"))) score += 3; else { score -= 6; notes.push("нужен верх и низ или платье"); }
  if (has("shoes")) score += 2; else { score -= 3; notes.push("нет обуви"); }
  const accents = new Set(its.filter((i) => kindOf(i.color) === "accent").map((i) => i.color));
  if (accents.size === 0) score -= 0.5;
  else if (accents.size <= 2) score += 2;
  else { score -= 3 * (accents.size - 2); notes.push("слишком много акцентов"); }
  for (const i of its) if (kindOf(i.color) === "avoid") score -= FACE.has(i.cat) ? 8 : 1;
  const st = {};
  its.forEach((i) => (i.styles || []).forEach((s) => (st[s] = (st[s] || 0) + 1)));
  const top = Math.max(0, ...Object.values(st));
  if (top >= 2) score += Math.min(2, top - 1);
  return { score, notes };
}

// Простой генератор случайных чисел с зерном, чтобы «другой вариант» был воспроизводим.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Несколько разных образов под погоду. exclude — id вещей, которые не предлагать (например, надетые вчера).
export function suggestOutfits(items, kindOf, needs = {}, { n = 3, seed = 1, exclude = [] } = {}) {
  const rand = rng(seed);
  const season = needs.season || "any";
  const ex = new Set(exclude);
  const pool = (cat) => {
    let list = items.filter((i) => i.cat === cat && fits(i, season) && !ex.has(i.id));
    if (!list.length) list = items.filter((i) => i.cat === cat && !ex.has(i.id));
    if (!list.length) list = items.filter((i) => i.cat === cat);
    return list;
  };
  const P = { outer: pool("outer"), top: pool("top"), bottom: pool("bottom"), dress: pool("dress"), shoes: pool("shoes"), acc: pool("acc") };
  const pick = (a) => (a.length ? a[Math.floor(rand() * a.length)] : null);
  const cands = [];
  for (let k = 0; k < 250; k++) {
    const useDress = P.dress.length && (rand() < 0.3 || !P.top.length || !P.bottom.length);
    const its = [];
    if (useDress) its.push(pick(P.dress)); else its.push(pick(P.top), pick(P.bottom));
    its.push(pick(P.shoes));
    if (!needs.noOuter && (needs.needOuter || rand() < 0.4)) its.push(pick(P.outer));
    if (P.acc.length && rand() < 0.7) its.push(pick(P.acc));
    const clean = [...new Set(its.filter(Boolean))];
    if (clean.length < 2) continue;
    let { score } = scoreOutfit(clean, kindOf);
    if (needs.needOuter && !clean.some((i) => i.cat === "outer") && P.outer.length) score -= 3;
    cands.push({ items: clean.map((i) => i.id), score: score + rand() * 1.2 });
  }
  cands.sort((a, b) => b.score - a.score);
  // берём лучшие, но непохожие: у каждого следующего не больше половины общих вещей
  const out = [];
  for (const c of cands) {
    if (out.some((o) => c.items.filter((id) => o.items.includes(id)).length > Math.floor(c.items.length / 2))) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

// Сколько разных «базовых» образов (верх+низ+обувь или платье+обувь) даёт набор вещей.
export function countCombos(items, kindOf, season = "any", cap = 100000) {
  const f = (c) => items.filter((i) => i.cat === c && fits(i, season));
  const tops = f("top"), bottoms = f("bottom"), dresses = f("dress"), shoes = f("shoes");
  const ok = (arr) => new Set(arr.filter((i) => kindOf(i.color) === "accent").map((i) => i.color)).size <= 2;
  let n = 0;
  for (const s of shoes) {
    for (const t of tops) for (const b of bottoms) { if (ok([t, b, s])) n++; if (n >= cap) return n; }
    for (const d of dresses) if (ok([d, s])) n++;
  }
  return n;
}

/* ---------- носка и статистика ---------- */
export const dayKey = (d = new Date()) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 86400000);

export function wearStats(items, wears, today = dayKey()) {
  const per = {};
  for (const it of items) per[it.id] = { count: 0, last: null };
  for (const w of wears) for (const id of w.items || []) {
    if (!per[id]) continue;
    per[id].count++;
    if (!per[id].last || w.date > per[id].last) per[id].last = w.date;
  }
  const rows = items.map((it) => {
    const p = per[it.id];
    const since = p.last ? daysBetween(p.last, today) : null;
    const cpw = it.price > 0 ? Math.round(it.price / Math.max(1, p.count)) : null;
    return { id: it.id, count: p.count, last: p.last, since, cpw };
  });
  const byCount = [...rows].sort((a, b) => b.count - a.count);
  const addedAgo = (it) => (it.created_at ? Math.round((Date.now() - it.created_at) / 86400000) : 999);
  const idle = rows.filter((r) => (r.since === null ? addedAgo(items.find((i) => i.id === r.id)) >= 30 : r.since >= 60))
    .sort((a, b) => (b.since ?? 9999) - (a.since ?? 9999));
  const days = new Set(wears.map((w) => w.date));
  let streak = 0;
  for (let d = new Date(today + "T12:00"); days.has(dayKey(d)); d.setDate(d.getDate() - 1)) streak++;
  return { rows, byCount, idle, streak, totalWears: wears.length, month: wears.filter((w) => w.date.slice(0, 7) === today.slice(0, 7)).length };
}

/* ---------- чего не хватает ---------- */
// Для каждого возможного пополнения считаем, сколько новых образов оно даст.
export function wardrobeGaps(items, kindOf, { palette = [], season = "any" } = {}) {
  const base = countCombos(items, kindOf, season);
  const neutral = palette.filter((k) => kindOf(k) === "neutral");
  const accent = palette.filter((k) => kindOf(k) === "accent");
  const pickColor = (list, fallback) => list.find((k) => !items.some((i) => i.color === k)) || list[0] || fallback;
  const fake = (cat, color, seasons = ["fw", "ss"]) => ({ id: "__gap", cat, color, seasons, styles: [] });
  const cnt = (c, pred = () => true) => items.filter((i) => i.cat === c && pred(i)).length;
  const ideas = [
    { key: "top-neutral", cat: "top", color: pickColor(neutral, "black"), title: "Базовый верх нейтрального цвета", why: "С ним сочетается почти любой низ" },
    { key: "bottom-neutral", cat: "bottom", color: pickColor(neutral, "denim"), title: "Базовый низ нейтрального цвета", why: "Держит на себе акцентный верх" },
    { key: "shoes-fw", cat: "shoes", color: pickColor(neutral, "black"), seasons: ["fw"], title: "Обувь на осень–зиму", why: "Без неё не собрать холодные образы" },
    { key: "shoes-ss", cat: "shoes", color: pickColor(neutral, "white"), seasons: ["ss"], title: "Обувь на весну–лето", why: "Лёгкая пара для тёплых дней" },
    { key: "outer-fw", cat: "outer", color: pickColor(neutral, "black"), seasons: ["fw"], title: "Тёплая верхняя одежда", why: "Нужна при температуре ниже +10" },
    { key: "top-accent", cat: "top", color: pickColor(accent, "green"), title: "Верх в акцентном цвете из твоей палитры", why: "Оживляет базовые сочетания у лица" },
    { key: "dress", cat: "dress", color: pickColor(palette, "black"), title: "Платье или комбинезон", why: "Готовый образ одной вещью" },
    { key: "acc", cat: "acc", color: pickColor(accent, "silver"), title: "Аксессуар в акцентном цвете", why: "Шарф или сумка добавят акцент без новой одежды" },
  ];
  const out = [];
  for (const g of ideas) {
    const extra = fake(g.cat, g.color, g.seasons);
    const gain = countCombos([...items, extra], kindOf, season) - base;
    let urgent = false;
    if (g.key === "shoes-fw" && cnt("shoes", (i) => !i.seasons?.length || i.seasons.includes("fw")) === 0) urgent = true;
    if (g.key === "shoes-ss" && cnt("shoes", (i) => !i.seasons?.length || i.seasons.includes("ss")) === 0) urgent = true;
    if (g.key === "outer-fw" && cnt("outer", (i) => !i.seasons?.length || i.seasons.includes("fw")) === 0) urgent = true;
    if (g.key === "top-neutral" && cnt("top", (i) => kindOf(i.color) === "neutral") < 2) urgent = true;
    if (g.key === "bottom-neutral" && cnt("bottom", (i) => kindOf(i.color) === "neutral") < 2) urgent = true;
    if (!urgent && gain <= 0 && g.key !== "acc") continue;
    out.push({ ...g, gain, urgent });
  }
  // вещи неподходящего цвета у лица — отдельная подсказка
  const faceAvoid = items.filter((i) => FACE.has(i.cat) && kindOf(i.color) === "avoid").map((i) => i.id);
  out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.gain - a.gain);
  return { base, ideas: out.slice(0, 6), faceAvoid };
}

/* ---------- капсулы ---------- */
export const CAPSULE_PRESETS = {
  trip: { title: "Поездка", size: 11, parts: { outer: 1, top: 4, bottom: 2, dress: 1, shoes: 2, acc: 1 } },
  work: { title: "Рабочая неделя", size: 12, parts: { outer: 1, top: 5, bottom: 3, dress: 1, shoes: 2, acc: 1 } },
  week: { title: "Неделя на каждый день", size: 12, parts: { outer: 1, top: 4, bottom: 3, dress: 1, shoes: 2, acc: 1 } },
};

// Жадно набирает вещи так, чтобы каждая следующая давала больше всего новых сочетаний.
export function buildCapsule(items, kindOf, { preset = "week", season = "any", styles = [] } = {}) {
  const P = CAPSULE_PRESETS[preset] || CAPSULE_PRESETS.week;
  const pool = items.filter((i) => fits(i, season));
  const chosen = [];
  const left = { ...P.parts };
  const styleBonus = (it) => (styles.length && (it.styles || []).some((s) => styles.includes(s)) ? 0.5 : 0);
  const neutralBonus = (it) => (kindOf(it.color) === "neutral" ? 0.3 : kindOf(it.color) === "avoid" ? -1 : 0);
  for (let step = 0; step < P.size; step++) {
    let best = null, bestScore = -Infinity;
    const base = countCombos(chosen, kindOf, "any", 5000);
    for (const it of pool) {
      if (chosen.includes(it) || !(left[it.cat] > 0)) continue;
      const gain = countCombos([...chosen, it], kindOf, "any", 5000) - base;
      const s = gain + styleBonus(it) + neutralBonus(it) + (it.cat === "shoes" && !chosen.some((c) => c.cat === "shoes") ? 3 : 0);
      if (s > bestScore) { bestScore = s; best = it; }
    }
    if (!best) break;
    chosen.push(best);
    left[best.cat]--;
  }
  const combos = countCombos(chosen, kindOf, "any");
  const examples = suggestOutfits(chosen, kindOf, { season: "any" }, { n: 5, seed: 7 });
  return { title: P.title, items: chosen.map((i) => i.id), combos, examples: examples.map((e) => e.items), preset };
}
