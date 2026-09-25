// «Мост» к Claude через обычный чат: сайт составляет запрос, человек отправляет его
// в claude.ai (вместе с фото), а ответ вставляет обратно. Здесь только чистые функции:
// составить запрос и разобрать ответ. Их же проверяет scripts/check.js.

import { CATS, COLORS, STYLES, SEASON_KEYS, SCALES } from "./catalog.js";
import { KIBBE_KEYS, ARCHETYPE_KEYS, knowledgeForPrompt } from "./knowledge.js";

export const CHAT_URL = "https://claude.ai/new";

const COLOR_KEYS = new Set(COLORS.map((c) => c[0]));
const CAT_KEYS = new Set(CATS.map((c) => c.id));
const STYLE_KEYS = new Set(STYLES.map((s) => s[0]));
const COLOR_T = Object.fromEntries(COLORS.map((c) => [c[0], c[1]]));
const STYLE_T = Object.fromEntries(STYLES);

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const arr = (v) => (Array.isArray(v) ? v : []);
const uniq = (a) => [...new Set(a)];

// Достаёт JSON из ответа: целиком, из блока ```json ... ``` или от первой { до последней }.
export function extractJson(text) {
  const t = String(text || "").trim();
  if (!t) throw new Error("Вставь ответ Claude в поле.");
  const tries = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1]);
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const x of tries) {
    try { const v = JSON.parse(x); if (v && typeof v === "object") return v; } catch {}
  }
  throw new Error("Не получилось прочитать ответ. Скопируй ответ Claude целиком, вместе с фигурными скобками.");
}

const colorList = COLORS.map((c) => `${c[0]} — ${c[1]}`).join(", ");

/* ---------- разбор типажа ---------- */
// Метки признаков на фото: что это за признак и где он на фото.
export const MARK_KINDS = {
  skin: "кожа", eyes: "глаза", hair: "волосы", brows: "брови", lips: "губы",
  face: "форма лица", features: "черты", contrast: "контраст",
};
const SAMPLE_KINDS = new Set(["skin", "eyes", "hair", "brows", "lips"]);
export const sampleable = (kind) => SAMPLE_KINDS.has(kind);

// Вопросы анкеты точного режима: [ключ, вопрос, варианты].
export const QUIZ = [
  ["hair_nat", "Натуральный цвет волос (без окрашивания)", ["светлый русый / блонд", "русый", "рыжий / медный", "каштановый", "тёмный / чёрный", "седой"]],
  ["hair_child", "Цвет волос в детстве", ["очень светлый", "русый", "рыжий", "тёмный"]],
  ["veins", "Цвет вен на запястье при дневном свете", ["голубые / фиолетовые", "зеленоватые", "и те и другие", "не понять"]],
  ["sun", "Как кожа реагирует на солнце", ["быстро краснеет и обгорает", "сначала краснеет, потом загорает", "легко загорает", "почти не загорает, сразу темнеет"]],
  ["metal", "Что лучше смотрится на коже", ["серебро", "золото", "одинаково"]],
  ["white", "Что освежает лицо", ["чистый белый", "молочный / айвори", "не вижу разницы"]],
  ["height", "Рост", ["до 160 см", "160–170 см", "170–180 см", "выше 180 см"]],
  ["frame", "Кость и сложение", ["узкая, изящная", "средняя", "широкая, крупная"]],
];

const DR = { cool: "холодный", warm: "тёплый", soft: "мягкая", clear: "чистая", light: "светлая", deep: "глубокая" };

export function analyzePrompt(nPhotos = 0, ctx = {}) {
  const quizLines = QUIZ.map(([k, q]) => (ctx.quiz?.[k] ? `- ${q}: ${ctx.quiz[k]}` : "")).filter(Boolean);
  const qualityLines = (ctx.quality || []).map((fl, i) => (fl?.length ? `- фото ${i + 1}: ${fl.join("; ")}` : "")).filter(Boolean);
  const drape = ctx.drape && Object.values(ctx.drape).some(Boolean)
    ? `\nРезультат цифровой драпировки (человек сам выбирал, с каким цветом у лица выглядит свежее): подтон — ${DR[ctx.drape.undertone] || "не ясно"}, насыщенность — ${DR[ctx.drape.chroma] || "не ясно"}, глубина — ${DR[ctx.drape.depth] || "не ясно"}. Учитывай это как важный признак; если он расходится с фото, объясни, чему доверяешь больше.` : "";
  const extra = [
    quizLines.length ? `\nОтветы человека о себе (они надёжнее фото там, где фото искажает цвет):\n${quizLines.join("\n")}` : "",
    qualityLines.length ? `\nАвтоматическая проверка фото нашла:\n${qualityLines.join("\n")}\nДелай поправку на это при оценке подтона.` : "",
    drape,
  ].join("");
  const marks = nPhotos > 0 ? `

Фото пронумерованы по порядку прикрепления: от 1 до ${nPhotos}. В поле markers отметь на фото признаки, на которых основан разбор цветотипа и типажа: 3–6 меток на каждое фото, где хорошо видно лицо. Для каждой метки укажи номер фото, координаты точки (x и y от 0 до 1 от левого верхнего угла фото), вид признака и короткую подпись. Точку ставь прямо на признак: skin — на щеку или лоб, eyes — на радужку, hair — на прядь, brows — на бровь, lips — на губы, face/features/contrast — на соответствующую часть лица.` : "";
  const markSchema = nPhotos > 0 ? `,
  "markers": [{"photo": 1, "x": 0.52, "y": 0.41, "kind": "одно из: ${Object.keys(MARK_KINDS).join(", ")}", "label": "признак, 2–5 слов, например «холодный розовый подтон»", "note": "что это значит для стиля, одно короткое предложение"}]` : "";
  return `Я прикрепляю ${nPhotos > 0 ? nPhotos : "2–5"} ${nPhotos === 1 ? "своё фото" : "своих фото"}. Ты профессиональный стилист-колорист. Определи мой цветотип и типаж внешности и дай рекомендации по стилю. Отвечай по-русски.
Это может быть человек любого пола. Не предполагай пол заранее: ориентируйся на то, что видно на фото, и подбирай рекомендации под этого человека. Не советуй по умолчанию платья, юбки, каблуки или макияж; предлагай их, только если они уместны для этого образа. Обращайся на «ты» в нейтральной форме, без окончаний, выдающих пол.
Для типажа используй систему, которая подходит человеку (например, Kibbe или её аналоги для мужских типажей) и коротко объясни, что это значит для одежды.
Говори уважительно и только о цвете, чертах лица и стиле: не оценивай внешность и фигуру. Если что-то по фото не видно (свет, фильтры, макияж), пиши «похоже на» и укажи это в unsure.

${knowledgeForPrompt()}
${extra}

Работай пошагово: оцени каждое фото отдельно, сравни выводы между фото, затем дай итог. Если фото противоречат друг другу, скажи это в evidence и снизь уверенность. Всегда называй второй по вероятности вариант цветотипа и типажа.

Цвета для palette и avoid бери ТОЛЬКО из этих ключей: ${colorList}.${marks}

Ответь ТОЛЬКО одним JSON-объектом, без текста до и после:
{
  "summary": "1–2 коротких предложения: главное о типаже и стиле",
  "colortype": {"name": "сезон и подтип, например «мягкое Лето»", "undertone": "подтон кожи", "eyes": "цвет глаз", "hair": "цвет волос: натуральный или окрашенный, какой оттенок идёт", "contrast": "низкий / средний / высокий и почему"},
  "type": {"name": "типаж, например soft natural / classic / dramatic / gamine / romantic / ingénue", "features": "1–2 предложения о чертах и что это значит для одежды"},
  "formula": "формула стиля одной фразой",
  "aesthetics": ["2–4 эстетики так, как их ищут в Pinterest"],
  "palette": ["6–10 ключей цветов, которые идут"],
  "avoid": ["3–6 ключей цветов, которые не стоит носить у лица"],
  "metal": "серебро / золото / оба",
  "hair": "совет по цвету волос или стрижке (а если есть борода — и по ней), одно предложение",
  "makeup": "совет по уходу и макияжу, если он уместен: брови, кожа, губы или акцент на глаза; 1–2 предложения",
  "tips": ["3–4 совета по одежде и аксессуарам, каждый до 10 слов"],
  "season": "ключ цветотипа, одно из: ${SEASON_KEYS.join(", ")}",
  "scales": {${SCALES.map((s) => `"${s[0]}": "${s[2].map((x) => x[0]).join(" | ")}"`).join(", ")}},
  "type_tags": ["3–5 признаков черт лица, по 1–3 слова, например «мягкие линии», «округлые скулы»"],
  "wear": "womenswear | menswear | unisex — какой гардероб человек, судя по фото, скорее носит",
  "pinterest": ["3–4 поисковых запроса на английском для Pinterest с образами под этот типаж и стиль"],
  "season_alt": "второй по вероятности ключ цветотипа",
  "kibbe": "ключ типажа Kibbe, одно из: ${KIBBE_KEYS.join(", ")}",
  "kibbe_alt": "второй по вероятности ключ типажа",
  "archetypes": ["1–2 ключа стилевых архетипов из: ${ARCHETYPE_KEYS.join(", ")}"],
  "confidence": {"season": "high | medium | low", "type": "high | medium | low"},
  "evidence": ["3–5 коротких доводов: на что опирается вывод и что по фото не видно"],
  "unsure": "что по фото определить нельзя, или пустая строка"${markSchema}
}`;
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));

export function parseAnalysis(text, nPhotos = 0) {
  const r = extractJson(text);
  const ct = r.colortype || {}, ty = r.type || {};
  if (!str(ct.name, 100)) throw new Error("В ответе нет цветотипа. Проверь, что скопирован ответ на этот запрос.");
  const palette = uniq(arr(r.palette).filter((k) => COLOR_KEYS.has(k))).slice(0, 10);
  return {
    summary: str(r.summary, 600),
    colortype: { name: str(ct.name, 100), undertone: str(ct.undertone, 200), eyes: str(ct.eyes, 200), hair: str(ct.hair, 300), contrast: str(ct.contrast, 300) },
    type: { name: str(ty.name, 100), features: str(ty.features, 400) },
    formula: str(r.formula, 300),
    aesthetics: arr(r.aesthetics).map((x) => str(x, 60)).filter(Boolean).slice(0, 4),
    palette,
    avoid: uniq(arr(r.avoid).filter((k) => COLOR_KEYS.has(k) && !palette.includes(k))).slice(0, 6),
    metal: str(r.metal, 60),
    hair: str(r.hair, 300),
    makeup: str(r.makeup, 400),
    tips: arr(r.tips).map((x) => str(x, 200)).filter(Boolean).slice(0, 5),
    season: SEASON_KEYS.includes(r.season) ? r.season : "",
    scales: Object.fromEntries(SCALES.map(([k, , opts]) => [k, opts.some((o) => o[0] === r.scales?.[k]) ? r.scales[k] : ""])),
    type_tags: arr(r.type_tags).map((x) => str(x, 40)).filter(Boolean).slice(0, 5),
    wear: ["womenswear", "menswear", "unisex"].includes(r.wear) ? r.wear : "unisex",
    pinterest: arr(r.pinterest).map((x) => str(x, 80)).filter(Boolean).slice(0, 4),
    season_alt: SEASON_KEYS.includes(r.season_alt) && r.season_alt !== r.season ? r.season_alt : "",
    kibbe: KIBBE_KEYS.includes(r.kibbe) ? r.kibbe : "",
    kibbe_alt: KIBBE_KEYS.includes(r.kibbe_alt) && r.kibbe_alt !== r.kibbe ? r.kibbe_alt : "",
    archetypes: uniq(arr(r.archetypes).filter((k) => ARCHETYPE_KEYS.includes(k))).slice(0, 2),
    confidence: { season: ["high", "medium", "low"].includes(r.confidence?.season) ? r.confidence.season : "", type: ["high", "medium", "low"].includes(r.confidence?.type) ? r.confidence.type : "" },
    evidence: arr(r.evidence).map((x) => str(x, 200)).filter(Boolean).slice(0, 5),
    unsure: str(r.unsure, 300),
    markers: nPhotos > 0 ? arr(r.markers)
      .map((m) => ({
        photo: Math.round(Number(m?.photo)),
        x: clamp01(m?.x), y: clamp01(m?.y),
        kind: MARK_KINDS[m?.kind] ? m.kind : "features",
        label: str(m?.label, 60), note: str(m?.note, 160),
      }))
      .filter((m) => m.photo >= 1 && m.photo <= nPhotos && m.label && Number.isFinite(m.x) && Number.isFinite(m.y))
      .slice(0, 8 * nPhotos) : [],
    at: Date.now(),
  };
}

/* ---------- вещь по фото ---------- */
export function tagPrompt() {
  return `Я прикрепляю фото одной вещи из гардероба. Определи, что это. Отвечай по-русски.
Категории: ${CATS.map((c) => `${c.id} — ${c.t}`).join(", ")}.
Цвета: ${colorList}.
Стили: ${STYLES.map((s) => `${s[0]} — ${s[1]}`).join(", ")}.

Ответь ТОЛЬКО одним JSON-объектом, без текста до и после:
{"name": "название, 2–4 слова, с цветом, например «чёрная водолазка»", "cat": "ключ категории", "color": "ключ основного цвета", "seasons": ["fw" — осень–зима и/или "ss" — весна–лето], "styles": ["до 3 ключей стилей"]}`;
}

export function parseTag(text) {
  const r = extractJson(text);
  const name = str(r.name, 80);
  if (!name || !CAT_KEYS.has(r.cat)) throw new Error("Ответ не похож на описание вещи. Проверь, что скопирован ответ на этот запрос.");
  const seasons = uniq(arr(r.seasons).filter((s) => s === "fw" || s === "ss"));
  return {
    name,
    cat: r.cat,
    color: COLOR_KEYS.has(r.color) ? r.color : "black",
    seasons: seasons.length ? seasons : ["fw", "ss"],
    styles: uniq(arr(r.styles).filter((s) => STYLE_KEYS.has(s))).slice(0, 3),
  };
}

/* ---------- образы из гардероба ---------- */
export function profileText(p) {
  if (typeof p?.text === "string" && p.text.trim()) return p.text.trim().slice(0, 3000);
  const a = p?.analysis;
  if (!a) return "Типаж не определён. Подбирай универсальные сочетания.";
  const names = (keys) => arr(keys).map((k) => COLOR_T[k] || k).join(", ");
  return [
    `Цветотип: ${a.colortype?.name}. Подтон: ${a.colortype?.undertone}. Глаза: ${a.colortype?.eyes}. Волосы: ${a.colortype?.hair}. Контраст: ${a.colortype?.contrast}.`,
    `Типаж: ${a.type?.name} — ${a.type?.features}`,
    `Формула стиля: ${a.formula}. Эстетики: ${arr(a.aesthetics).join(", ")}.`,
    `Палитра: ${names(a.palette)}. Металл: ${a.metal}.`,
    `Не носить у лица: ${names(a.avoid)}.`,
  ].join("\n");
}

// Вещам даются короткие номера (v1, v2…), чтобы запрос был компактным.
export function outfitsPrompt(items, profile, req = {}) {
  const map = {};
  const rows = items.map((i, n) => {
    const key = "v" + (n + 1);
    map[key] = i.id;
    const st = arr(i.styles).map((s) => STYLE_T[s] || s).join(", ");
    return `${key}: ${i.name} — ${COLOR_T[i.color] || i.color}, ${(CATS.find((c) => c.id === i.cat) || {}).t || i.cat}${st ? ", " + st : ""}${arr(i.seasons).length === 1 ? (i.seasons[0] === "fw" ? ", осень–зима" : ", весна–лето") : ""}`;
  });
  const prompt = `Ты мой персональный стилист. Собери 3 разных образа ТОЛЬКО из вещей моего гардероба ниже. Отвечай по-русски, обращайся на «ты» в нейтральной форме, без окончаний, выдающих пол.

Мой профиль:
${profileText(profile)}

Гардероб (номер: вещь):
${rows.join("\n")}

Запрос:
- повод: ${str(req.occasion, 80) || "на каждый день"}
- погода: ${str(req.weather, 60) || "не указана"}
- пожелания: ${str(req.wish, 160) || "нет"}

Правила: в каждом образе верх и низ или платье, обувь; верхняя одежда по погоде; 0–2 аксессуара. Не больше двух цветовых акцентов. Цвета из «не носить у лица» держи подальше от лица (обувь, низ, сумка).

Ответь ТОЛЬКО одним JSON-объектом, без текста до и после:
{"outfits": [{"title": "название образа, 2–4 слова", "items": ["v1", "v5"], "why": "1–2 коротких предложения, почему это мне подходит"}], "tip": "какой вещи не хватает для этого запроса, или пустая строка"}`;
  return { prompt, map };
}

export function parseOutfits(text, map) {
  const r = extractJson(text);
  const outfits = arr(r.outfits)
    .map((o) => ({
      title: str(o?.title, 60) || "Образ",
      why: str(o?.why, 300),
      items: uniq(arr(o?.items).map((k) => map[String(k).trim().toLowerCase()]).filter(Boolean)),
    }))
    .filter((o) => o.items.length >= 2)
    .slice(0, 3);
  if (!outfits.length) throw new Error("В ответе нет образов из твоих вещей. Проверь, что скопирован ответ на этот запрос.");
  return { outfits, tip: str(r.tip, 300) };
}

/* ---------- разбор коллажа образа ---------- */
export const SHOPS = {
  wb: { title: "Wildberries", host: /(^|\.)wildberries\.ru$/, search: (q) => `https://www.wildberries.ru/catalog/0/search.aspx?search=${encodeURIComponent(q)}` },
  ozon: { title: "Ozon", host: /(^|\.)ozon\.ru$/, search: (q) => `https://www.ozon.ru/search/?text=${encodeURIComponent(q)}` },
  ym: { title: "Яндекс Маркет", host: /(^|\.)market\.yandex\.ru$/, search: (q) => `https://market.yandex.ru/search?text=${encodeURIComponent(q)}` },
};

export function lookPrompt() {
  return `Я прикрепляю картинку: коллаж образа (одежда, обувь, аксессуары). Ты стилист-байер. Разбери образ на отдельные вещи и помоги найти такие же или похожие на Wildberries, Ozon и Яндекс Маркете. Отвечай по-русски.

Для каждой вещи на картинке (и одежды, и аксессуаров) укажи:
- что это и чем она узнаваема (фасон, материал, фактура, детали);
- поисковый запрос для маркетплейса по-русски, 3–7 слов, без брендов, как ищут покупатели;
- где вещь на картинке: координаты её центра x и y от 0 до 1 от левого верхнего угла.
Если у тебя есть доступ к поиску в интернете, найди для каждой вещи по 1–2 конкретных похожих товара на wildberries.ru, ozon.ru или market.yandex.ru и дай прямые ссылки на карточки товаров. Если поиска нет или товар не нашёлся, оставь links пустым массивом. Не придумывай ссылки.

Категории: ${CATS.map((c) => `${c.id} — ${c.t}`).join(", ")}.
Цвета: ${colorList}.
Стили: ${STYLES.map((s) => `${s[0]} — ${s[1]}`).join(", ")}.

Ответь ТОЛЬКО одним JSON-объектом, без текста до и после:
{
  "title": "название образа, 2–4 слова",
  "style": "эстетика образа, например soft grunge или dark academia",
  "styles": ["1–3 ключа стилей"],
  "items": [{"name": "что это, 2–4 слова", "cat": "ключ категории", "color": "ключ основного цвета", "details": "фасон и детали, одно предложение", "query": "поисковый запрос", "x": 0.5, "y": 0.3, "links": [{"shop": "wb | ozon | ym", "url": "https://...", "title": "название товара", "price": "цена, если видна"}]}],
  "tip": "как повторить образ, одно-два предложения"
}`;
}

function cleanLink(l) {
  try {
    const u = new URL(String(l?.url || ""));
    if (u.protocol !== "https:") return null;
    const shop = Object.keys(SHOPS).find((k) => SHOPS[k].host.test(u.hostname));
    if (!shop) return null;
    return { shop, url: u.href, title: str(l?.title, 120), price: str(l?.price, 30) };
  } catch { return null; }
}

export function parseLook(text) {
  const r = extractJson(text);
  const items = arr(r.items).map((it) => ({
    name: str(it?.name, 60),
    cat: CAT_KEYS.has(it?.cat) ? it.cat : "acc",
    color: COLOR_KEYS.has(it?.color) ? it.color : "",
    details: str(it?.details, 200),
    query: str(it?.query, 80) || str(it?.name, 60),
    x: Number.isFinite(Number(it?.x)) ? clamp01(it.x) : null,
    y: Number.isFinite(Number(it?.y)) ? clamp01(it.y) : null,
    links: arr(it?.links).map(cleanLink).filter(Boolean).slice(0, 4),
  })).filter((it) => it.name).slice(0, 20);
  if (!items.length) throw new Error("В ответе нет вещей из образа. Проверь, что скопирован ответ на этот запрос.");
  return {
    title: str(r.title, 60) || "Образ с коллажа",
    style: str(r.style, 60),
    styles: uniq(arr(r.styles).filter((s) => STYLE_KEYS.has(s))).slice(0, 3),
    items,
    tip: str(r.tip, 300),
    at: Date.now(),
  };
}
