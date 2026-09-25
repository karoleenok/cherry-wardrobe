// Общий справочник: его импортируют и страница, и серверные функции.

export const CATS = [
  { id: "outer", t: "Верхняя одежда" },
  { id: "top", t: "Верх" },
  { id: "bottom", t: "Низ" },
  { id: "dress", t: "Платья" },
  { id: "shoes", t: "Обувь" },
  { id: "acc", t: "Аксессуары" },
];

// [ключ, название, цвет плашки, базовая роль: neutral — база, accent — акцент]
// Какие цвета человеку не идут, решает разбор типажа (поле avoid), а не этот список.
export const COLORS = [
  ["black", "чёрный", "#161314", "neutral"],
  ["milk", "молочный", "#efe8dc", "neutral"],
  ["white", "белый", "#fbfbfa", "neutral"],
  ["graphite", "графит", "#4a4749", "neutral"],
  ["grey", "серый", "#9a9796", "neutral"],
  ["denim", "деним", "#4d6a8a", "neutral"],
  ["navy", "нейви", "#22304a", "neutral"],
  ["choc", "шоколад", "#4b3226", "neutral"],
  ["beige", "бежевый", "#d8c7ae", "neutral"],
  ["camel", "кэмел", "#b98a57", "neutral"],
  ["silver", "серебро", "#c4c7cb", "neutral"],
  ["gold", "золото", "#c9a24a", "neutral"],
  ["green", "бутылочный", "#2e4a37", "accent"],
  ["olive", "оливковый", "#5c6140", "accent"],
  ["burgundy", "бордо", "#6e1a26", "accent"],
  ["cherry", "вишнёвый", "#9b1f33", "accent"],
  ["red", "красный", "#c8202e", "accent"],
  ["blue", "серо-голубой", "#8fa3b5", "accent"],
  ["cobalt", "кобальт", "#1f4fa8", "accent"],
  ["lavender", "лавандовый", "#b7a6d4", "accent"],
  ["pink", "розовый", "#e7a3b8", "accent"],
  ["fuchsia", "фуксия", "#d0307c", "accent"],
  ["mustard", "горчичный", "#c79a2b", "accent"],
  ["orange", "оранжевый", "#d9662b", "accent"],
  ["terracotta", "терракота", "#b5573a", "accent"],
  ["print", "принт", "linear-gradient(135deg,#161314 25%,#efe8dc 25% 50%,#6e1a26 50% 75%,#2e4a37 75%)", "accent"],
];

export const COLOR_KEYS = COLORS.map((c) => c[0]);
export const CAT_KEYS = CATS.map((c) => c.id);

export const STYLES = [
  ["grunge", "soft grunge"],
  ["cherry", "cherry cola"],
  ["slavic", "slavic vintage"],
  ["witch", "whimsigoth"],
  ["minimal", "минимализм"],
  ["academia", "dark academia"],
  ["classic", "классика"],
  ["romantic", "романтичный"],
  ["sport", "спортивный"],
  ["casual", "casual"],
  ["evening", "вечерний"],
];
export const STYLE_KEYS = STYLES.map((s) => s[0]);

// 12 цветотипов: сезон × подтип
export const SEASON_TYPES = [
  ["spring", "Весна", [["light_spring", "светлая"], ["warm_spring", "тёплая"], ["bright_spring", "яркая"]]],
  ["summer", "Лето", [["light_summer", "светлое"], ["cool_summer", "холодное"], ["soft_summer", "мягкое"]]],
  ["autumn", "Осень", [["soft_autumn", "мягкая"], ["warm_autumn", "тёплая"], ["deep_autumn", "глубокая"]]],
  ["winter", "Зима", [["deep_winter", "глубокая"], ["cool_winter", "холодная"], ["bright_winter", "яркая"]]],
];
export const SEASON_KEYS = SEASON_TYPES.flatMap((s) => s[2].map((x) => x[0]));

// Шкалы для наглядного разбора: ключ, подпись, варианты [ключ, подпись]
export const SCALES = [
  ["undertone", "Подтон", [["warm", "тёплый"], ["neutral", "нейтральный"], ["cool", "холодный"]]],
  ["depth", "Глубина", [["light", "светлая"], ["medium", "средняя"], ["deep", "глубокая"]]],
  ["contrast", "Контраст", [["low", "низкий"], ["medium", "средний"], ["high", "высокий"]]],
  ["chroma", "Насыщенность", [["soft", "мягкая"], ["medium", "средняя"], ["clear", "чистая"]]],
];

export const SEASONS = [
  ["fw", "осень–зима"],
  ["ss", "весна–лето"],
];
