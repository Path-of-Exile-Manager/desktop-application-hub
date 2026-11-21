// Обновить данные о пыли Kingsmarch: `node scripts/update-dust-data.mjs`.
//
// Источник — poe-disenchant-tool (deronek, MIT, см. THIRD-PARTY-NOTICES.md): `data/dust/poe-dust.js`
// — пыль уникального предмета при уровне 84 без качества и с 20 % качества, сбор золота за покупку
// через асинхронный трейд, размер в клетках. Результат — `src-tauri/data/dust-uniques.json`
// (ядро встраивает его при сборке, `src-tauri/src/kingsmarch.rs`).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = "https://raw.githubusercontent.com/deronek/poe-disenchant-tool/main/data/dust/poe-dust.js";
const OUT = fileURLToPath(new URL("../src-tauri/data/dust-uniques.json", import.meta.url));

// У этих уникальных качества не бывает (осквернённые и отражённые от выпадения) — `ITEMS_TO_IGNORE_QUALITY`
// того же проекта. Колчаны ядро определяет по классу базы.
const NO_QUALITY = [
  "Kalandra's Touch",
  "Skin of the Lords",
  "String of Servitude",
  "Blood of Corruption",
  "Night's Hold",
  "Ixchel's Temptation",
  "Blightwell",
  "Rigwald's Curse",
  "Star of Wraeclast",
  "Angler's Plait",
  "The Utmost",
  "Natural Hierarchy",
  "Eyes of the Greatwolf",
  "Glimpse of Chaos",
  "Leadership's Price",
  "Malachai's Vision",
  "Shadowstitch",
];

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE}: HTTP ${response.status}`);
const code = await response.text();
const { default: data } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const items = data.map((d) => ({
  name: d.name,
  baseType: d.baseType,
  dust: d.dustValIlvl84,
  dustQ20: d.dustValIlvl84Q20,
  gold: d.goldCost,
  slots: d.slots,
  ...(NO_QUALITY.includes(d.name) ? { noQuality: true } : {}),
}));
for (const i of items) {
  if (!i.name || !i.baseType || !(i.dust > 0) || !(i.dustQ20 > 0) || !(i.gold > 0) || !(i.slots > 0)) throw new Error(`плохая запись: ${JSON.stringify(i)}`);
}
const file = { source: SOURCE, fetchedAt: new Date().toISOString().slice(0, 10), items };
writeFileSync(OUT, `${JSON.stringify(file, null, 1)}\n`);
console.log(`${items.length} уникальных → ${OUT}`);
