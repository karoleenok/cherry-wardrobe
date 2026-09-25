// Проверка без браузера: запросы собираются, а ответы Claude в разных видах
// (чистый JSON, блок ```json, текст вокруг) разбираются и очищаются.
import assert from "node:assert/strict";
import { analyzePrompt, parseAnalysis, tagPrompt, parseTag, outfitsPrompt, parseOutfits, extractJson } from "./bridge.js";

// Запросы
assert.match(analyzePrompt(), /JSON/);
assert.match(tagPrompt(), /cat/);

// extractJson: разные обёртки
assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
assert.deepEqual(extractJson('Вот ответ:\n```json\n{"a":2}\n```\nГотово'), { a: 2 });
assert.deepEqual(extractJson('Конечно! {"a":3} Надеюсь, помогла.'), { a: 3 });
assert.throws(() => extractJson(""), /Вставь/);
assert.throws(() => extractJson("просто текст"), /прочитать/);

// Разбор типажа: чужие ключи цветов отбрасываются, avoid не пересекается с palette
const an = parseAnalysis("```json\n" + JSON.stringify({
  summary: "Мягкое лето",
  colortype: { name: "Мягкое Лето", undertone: "холодный", eyes: "серо-голубые", hair: "рыжие окрашенные", contrast: "средний" },
  type: { name: "soft gamine", features: "мягкие черты" },
  formula: "нежное + графичное",
  aesthetics: ["soft grunge", "cherry cola"],
  palette: ["black", "milk", "green", "нет-такого"],
  avoid: ["orange", "black", "camel"],
  metal: "серебро", hair: "вишня", makeup: "стрелки", tips: ["a", "b"], unsure: "",
}) + "\n```");
assert.equal(an.colortype.name, "Мягкое Лето");
assert.deepEqual(an.palette, ["black", "milk", "green"]);
assert.deepEqual(an.avoid, ["orange", "camel"]);
assert.ok(an.at > 0);
assert.throws(() => parseAnalysis('{"summary":"x"}'), /цветотип/);

// Вещь по фото
const t = parseTag('{"name":"Чёрная водолазка","cat":"top","color":"black","seasons":["fw","xx"],"styles":["minimal","???"]}');
assert.deepEqual(t, { name: "Чёрная водолазка", cat: "top", color: "black", seasons: ["fw"], styles: ["minimal"] });
assert.deepEqual(parseTag('{"name":"Шарф","cat":"acc","color":"не цвет","seasons":[]}').seasons, ["fw", "ss"]);
assert.throws(() => parseTag('{"name":"x","cat":"шляпа"}'), /не похож/);

// Образы: короткие номера превращаются обратно в id, несуществующие отбрасываются
const items = [
  { id: "id-a", name: "Водолазка", cat: "top", color: "black", seasons: ["fw"], styles: ["minimal"] },
  { id: "id-b", name: "Джинсы", cat: "bottom", color: "denim", seasons: ["fw", "ss"], styles: [] },
  { id: "id-c", name: "Ботинки", cat: "shoes", color: "black", seasons: ["fw"], styles: ["grunge"] },
];
const { prompt, map } = outfitsPrompt(items, { analysis: an }, { occasion: "учёба" });
assert.match(prompt, /v1: Водолазка/);
assert.match(prompt, /Мягкое Лето/);
assert.match(prompt, /учёба/);
const o = parseOutfits('{"outfits":[{"title":"Учёба","items":["v1","V2","v3","v9"],"why":"база"},{"title":"Мало","items":["v1"]}],"tip":"шарф"}', map);
assert.equal(o.outfits.length, 1, "образ из одной вещи отбрасывается");
assert.deepEqual(o.outfits[0].items, ["id-a", "id-b", "id-c"]);
assert.equal(o.tip, "шарф");
assert.throws(() => parseOutfits('{"outfits":[]}', map), /нет образов/);

// Метки на фото: номер фото в пределах, координаты зажаты в 0..1, неизвестный вид -> features
assert.match(analyzePrompt(2), /от 1 до 2/);
assert.doesNotMatch(analyzePrompt(0), /markers/);
const withMarks = parseAnalysis(JSON.stringify({
  colortype: { name: "Лето" }, type: {}, palette: [], avoid: [],
  markers: [
    { photo: 1, x: 0.5, y: 0.4, kind: "skin", label: "холодный подтон", note: "серебро" },
    { photo: 2, x: 1.4, y: -0.2, kind: "???", label: "мягкие черты" },
    { photo: 3, x: 0.1, y: 0.1, kind: "eyes", label: "нет такого фото" },
    { photo: 1, x: 0.2, y: 0.2, kind: "hair", label: "" },
  ],
}), 2);
assert.equal(withMarks.markers.length, 2);
assert.deepEqual([withMarks.markers[1].x, withMarks.markers[1].y, withMarks.markers[1].kind], [1, 0, "features"]);
assert.deepEqual(parseAnalysis('{"colortype":{"name":"Лето"},"markers":[{"photo":1,"x":0.5,"y":0.5,"label":"x"}]}', 0).markers, []);

// Наглядные поля разбора: сезон, шкалы, теги, гардероб, запросы для Pinterest
const vis = parseAnalysis(JSON.stringify({ colortype: { name: "Лето" }, season: "soft_summer", scales: { undertone: "cool", depth: "очень", contrast: "medium" }, type_tags: ["мягкие линии"], wear: "menswear", pinterest: ["soft summer men outfit"] }));
assert.equal(vis.season, "soft_summer");
assert.deepEqual(vis.scales, { undertone: "cool", depth: "", contrast: "medium", chroma: "" });
assert.equal(vis.wear, "menswear");
assert.equal(parseAnalysis('{"colortype":{"name":"x"},"season":"summer","wear":"?"}').season, "");
assert.equal(parseAnalysis('{"colortype":{"name":"x"},"wear":"?"}').wear, "unisex");
const { PINS } = await import("./pins.js");
const { SEASON_KEYS } = await import("./catalog.js");
for (const k of SEASON_KEYS) assert.ok(PINS[k]?.w?.length && PINS[k]?.m?.length, "нет пинов для " + k);

// ---------- logic.js ----------
const L = await import("./logic.js");
const kind = (c) => (["green", "burgundy", "cherry", "blue"].includes(c) ? "accent" : c === "orange" ? "avoid" : "neutral");
const W = [
  { id: "t1", cat: "top", color: "black", seasons: ["fw", "ss"], styles: ["minimal"] },
  { id: "t2", cat: "top", color: "green", seasons: ["fw"], styles: ["grunge"] },
  { id: "t3", cat: "top", color: "orange", seasons: ["ss"], styles: [] },
  { id: "b1", cat: "bottom", color: "denim", seasons: ["fw", "ss"], styles: ["casual"] },
  { id: "b2", cat: "bottom", color: "black", seasons: ["fw"], styles: ["grunge"] },
  { id: "s1", cat: "shoes", color: "black", seasons: ["fw"], styles: ["grunge"] },
  { id: "o1", cat: "outer", color: "black", seasons: ["fw"], styles: [] },
  { id: "a1", cat: "acc", color: "cherry", seasons: ["fw", "ss"], styles: [] },
];
// погода
assert.equal(L.weatherNeeds({ temp: 3, feels: 1, code: 61, rainChance: 80, wind: 10 }).needOuter, true);
assert.equal(L.weatherNeeds({ temp: 3, feels: 1, code: 61, rainChance: 80, wind: 10 }).season, "fw");
assert.equal(L.weatherNeeds({ temp: 27, feels: 27, code: 0, rainChance: 0, wind: 5 }).noOuter, true);
assert.equal(L.weatherText(63).text, "дождь");
// подбор: в холод есть верхняя одежда, образы разные и собраны
const cold = L.suggestOutfits(W, kind, L.weatherNeeds({ temp: 2, code: 3, rainChance: 0, wind: 5 }), { n: 3, seed: 5 });
assert.ok(cold.length >= 1);
for (const o of cold) {
  const its = o.items.map((id) => W.find((w) => w.id === id));
  assert.ok(its.some((i) => i.cat === "outer"), "в холод нужна верхняя одежда");
  assert.ok(its.some((i) => i.cat === "shoes"));
  assert.ok(!o.items.includes("t3"), "летний верх неподходящего цвета не предлагаем в холод");
}
const hot = L.suggestOutfits(W, kind, L.weatherNeeds({ temp: 28, code: 0, rainChance: 0, wind: 1 }), { n: 2, seed: 3 });
assert.ok(hot.every((o) => !o.items.includes("o1")), "в жару без верхней одежды");
// сочетания
assert.equal(L.countCombos(W, kind), 3 * 2 * 1);
// статистика носки
const st = L.wearStats(W, [{ date: "2026-09-20", items: ["t1", "b1", "s1"] }, { date: "2026-09-25", items: ["t1", "b2", "s1"] }, { date: "2026-09-26", items: ["t2", "b2", "s1"] }], "2026-09-26");
assert.equal(st.byCount[0].id, "s1");
assert.equal(st.byCount[0].count, 3);
assert.equal(st.streak, 2);
assert.equal(st.rows.find((r) => r.id === "t1").since, 1);
const priced = L.wearStats([{ ...W[0], price: 3000 }], [{ date: "2026-09-01", items: ["t1"] }, { date: "2026-09-02", items: ["t1"] }], "2026-09-26");
assert.equal(priced.rows[0].cpw, 1500);
// пробелы: без обуви на лето — срочно; неподходящий верх у лица отмечен
const g = L.wardrobeGaps(W, kind, { palette: ["black", "milk", "green", "burgundy"] });
assert.ok(g.ideas.some((x) => x.key === "shoes-ss" && x.urgent));
assert.deepEqual(g.faceAvoid, ["t3"]);
assert.ok(g.ideas[0].urgent);
// капсула: не больше лимитов по категориям, есть обувь, есть примеры
const cap = L.buildCapsule(W, kind, { preset: "trip" });
const capItems = cap.items.map((id) => W.find((w) => w.id === id));
assert.ok(capItems.some((i) => i.cat === "shoes"));
assert.ok(capItems.filter((i) => i.cat === "top").length <= 4);
assert.ok(cap.combos >= 1 && cap.examples.length >= 1);

// разбор коллажа: ссылки только на три магазина и только https
const B = await import("./bridge.js");
assert.match(B.lookPrompt(), /Wildberries/);
const look = B.parseLook('```json\n' + JSON.stringify({ title: "Готика", styles: ["grunge", "xx"], items: [
  { name: "Широкие брюки в полоску", cat: "bottom", color: "black", query: "широкие брюки в тонкую полоску", x: 0.5, y: 0.6, links: [
    { shop: "wb", url: "https://www.wildberries.ru/catalog/123/detail.aspx", title: "Брюки" },
    { shop: "wb", url: "https://www.wildberries.ru/catalog/0/search.aspx?search=брюки", title: "поиск — не карточка" },
    { shop: "ozon", url: "http://www.ozon.ru/product/1", title: "http нельзя" },
    { shop: "x", url: "https://evil.example.com/ozon.ru", title: "чужой сайт" },
    { url: "https://market.yandex.ru/product--x/1", title: "ЯМ" } ] },
  { name: "Сумка", cat: "шляпа", color: "бордо", x: 3 },
  { name: "" } ] }) + '\n```');
assert.equal(look.items.length, 2);
assert.deepEqual(look.items[0].links.map((l) => l.shop), ["wb", "ym"]);
assert.equal(look.items[1].cat, "acc");
assert.equal(look.items[1].x, 1);
const lb = B.parseLook('{"items":[{"name":"a","bbox":[0.1,0.2,0.5,0.9]},{"name":"b","bbox":[0.5,0.5,0.2,0.9]},{"name":"c","bbox":[0,1]}]}');
assert.deepEqual(lb.items.map((i) => i.bbox), [[0.1, 0.2, 0.5, 0.9], null, null]);
assert.deepEqual(look.styles, ["grunge"]);
assert.match(B.SHOPS.wb.search("чёрные ботинки"), /wildberries\.ru\/catalog\/0\/search\.aspx\?search=/);
assert.throws(() => B.parseLook('{"items":[]}'), /нет вещей/);

// точный режим: качество фото, драпировка, новые поля разбора
const px = (r, g, b, n = 400) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set([r, g, b, 255], i * 4); return a; };
assert.ok(L.photoQuality(px(200, 200, 200), 1200, 1600).ok, "нейтральное светлое фото — ок");
assert.ok(L.photoQuality(px(30, 30, 30), 1200, 1600).flags.some((f) => f[0] === "dark"));
assert.ok(L.photoQuality(px(230, 190, 140), 1200, 1600).flags.some((f) => f[0] === "warm"), "жёлтый свет");
assert.ok(L.photoQuality(px(150, 170, 215), 1200, 1600).flags.some((f) => f[0] === "cool"), "синий свет");
assert.ok(L.photoQuality(px(200, 200, 200), 300, 400).flags.some((f) => f[0] === "small"));
const ds = L.drapeSummary({ 0: "cool", 1: "cool", 2: "warm", 3: "soft", 4: "clear", 5: "light", 6: "light" });
assert.deepEqual(ds, { undertone: "cool", chroma: "", depth: "light" });
const acc = parseAnalysis(JSON.stringify({ colortype: { name: "Лето" }, season: "soft_summer", season_alt: "soft_summer", kibbe: "soft_gamine", kibbe_alt: "romantic", archetypes: ["rebel", "magician", "xx", "lover"], confidence: { season: "high", type: "шум" }, evidence: ["a", "b"] }));
assert.equal(acc.season_alt, "", "второй вариант не совпадает с первым");
assert.equal(acc.kibbe, "soft_gamine");
assert.deepEqual(acc.archetypes, ["rebel", "magician"]);
assert.deepEqual(acc.confidence, { season: "high", type: "" });
const KB = await import("./knowledge.js");
for (const k of SEASON_KEYS) assert.ok(KB.SEASON_KB[k]?.name && KB.SEASON_KB[k].neighbors.every((n) => KB.SEASON_KB[n]), "справочник сезона " + k);
const promptAcc = analyzePrompt(2, { quiz: { veins: "зеленоватые" }, quality: [["тёплый свет"], []], drape: { undertone: "cool" } });
assert.match(promptAcc, /КРИТЕРИИ ЦВЕТОТИПА/);
assert.match(promptAcc, /зеленоватые/);
assert.match(promptAcc, /подтон — холодный/);

console.log("OK: все проверки прошли");
