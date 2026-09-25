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

console.log("OK: все проверки прошли");
