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

console.log("OK: все проверки прошли");
