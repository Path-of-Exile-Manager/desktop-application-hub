import { keyBetween, saveRecord } from "@/app/user-data";
import type { PobBuild } from "@/generated/PobBuild";
import { classLabel, decodeBuild, NAME_MAX, newBuildRecord, normalizeCode, type PobBuildGroup, type PobBuildRecord, type PobBuildSite } from "./model";

// Импорт библиотек со страниц-предшественниц (план shared/docs/pob-trader.md, P9):
// - PoB Library — файл pob-library/data/library.json: { groups: [{id, name}], builds: [{ name, code,
//   site?, idOnSite?, url?, groupId, createdAt, … }] };
// - PoB-разборщик — localStorage `pob-trader-library-v1`: [{ id, name, code, description }].
// Каждый код разбирается ядром (класс, уровень, проверка PoE1); билд с кодом, который уже есть в
// библиотеке, пропускается — повторный импорт ничего не задваивает. Группы сопоставляются по имени.

export type ImportFormat = "pob-library" | "pob-trader";

type Entry = { name: string; code: string; groupName: string | null; source: PobBuildRecord["source"]; createdAt: string | null };

export type ImportPlan = {
  format: ImportFormat;
  entries: Entry[];
  /** Группы файла, которых в библиотеке ещё нет (по имени). */
  newGroups: string[];
};

export type ImportResult = { added: number; duplicates: number; failed: { name: string; reason: string }[]; groups: number };

const SITES: Record<string, { site: PobBuildSite; url: (id: string) => string }> = {
  pobbin: { site: "POBBIN", url: (id) => `https://pobb.in/${id}` },
  pastebin: { site: "PASTEBIN", url: (id) => `https://pastebin.com/${id}` },
  poeninja: { site: "POE_NINJA", url: (id) => `https://poe.ninja/poe1/pob/${id}` },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function sourceOf(raw: Record<string, unknown>): PobBuildRecord["source"] {
  const known = SITES[str(raw.site).toLowerCase()];
  const id = str(raw.idOnSite);
  return known && /^[A-Za-z0-9_/-]{1,100}$/.test(id) ? { site: known.site, idOnSite: id, url: known.url(id) } : null;
}

function dateOf(v: unknown): string | null {
  const t = Date.parse(str(v));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Текст файла или вставки → что импортировать. Ошибка — словами. */
export function parseImport(text: string, existingGroups: PobBuildGroup[]): ImportPlan {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("это не JSON — вставьте содержимое library.json или строку из консоли страницы");
  }
  // Разборщик кладёт в localStorage строку JSON; `copy(localStorage.getItem(…))` даёт её же — бывает и в кавычках.
  if (typeof data === "string") return parseImport(data, existingGroups);

  if (Array.isArray(data)) {
    const entries = data.filter(isObject).map((b) => ({ name: str(b.name), code: normalizeCode(str(b.code)), groupName: null, source: null, createdAt: null }));
    return { format: "pob-trader", entries: entries.filter((e) => e.code), newGroups: [] };
  }
  if (isObject(data) && Array.isArray(data.builds)) {
    const groupName = new Map<string, string>();
    for (const g of Array.isArray(data.groups) ? data.groups.filter(isObject) : []) if (str(g.id) && str(g.name)) groupName.set(str(g.id), str(g.name).slice(0, 100));
    const entries = data.builds.filter(isObject).map((b) => ({
      name: str(b.name),
      code: normalizeCode(str(b.code)),
      groupName: groupName.get(str(b.groupId)) ?? null,
      source: sourceOf(b),
      createdAt: dateOf(b.createdAt),
    }));
    const known = new Set(existingGroups.map((g) => g.name.toLowerCase()));
    // Только группы, в которых есть билды, — как пустые группы на странице никто не заметит, так и здесь.
    const used = [...new Set(entries.map((e) => e.groupName).filter((n): n is string => !!n))];
    return { format: "pob-library", entries: entries.filter((e) => e.code), newGroups: used.filter((n) => !known.has(n.toLowerCase())) };
  }
  throw new Error("не похоже на библиотеку PoB Library или PoB-разборщика");
}

/** Сохранить план: группы, затем билды. `onProgress` — сколько кодов разобрано. */
export async function runImport(
  plan: ImportPlan,
  existing: { builds: PobBuildRecord[]; groups: PobBuildGroup[] },
  onProgress: (done: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { added: 0, duplicates: 0, failed: [], groups: 0 };
  const groupId = new Map(existing.groups.map((g) => [g.name.toLowerCase(), g.id]));
  let lastGroupKey = existing.groups.map((g) => g.sortKey).sort().at(-1) ?? null;
  for (const name of plan.newGroups) {
    lastGroupKey = await keyBetween(lastGroupKey, null);
    const saved = (await saveRecord("pobBuildGroups", { name, sortKey: lastGroupKey })) as PobBuildGroup;
    groupId.set(name.toLowerCase(), saved.id);
    result.groups++;
  }

  const codes = new Set(existing.builds.map((b) => b.code));
  let lastKey = existing.builds.map((b) => b.sortKey).sort().at(-1) ?? null;
  // Старые сверху в файлах обеих страниц — сохраняем с конца, чтобы порядок по дате совпал.
  for (const [i, entry] of [...plan.entries].reverse().entries()) {
    onProgress(i);
    if (codes.has(entry.code)) {
      result.duplicates++;
      continue;
    }
    let build: PobBuild;
    try {
      build = await decodeBuild(entry.code);
    } catch (e) {
      result.failed.push({ name: entry.name || "без названия", reason: String(e) });
      continue;
    }
    lastKey = await keyBetween(lastKey, null);
    const record = newBuildRecord({
      name: (entry.name || (build.level ? `${classLabel(build)} ${build.level}` : classLabel(build))).slice(0, NAME_MAX),
      code: entry.code,
      groupId: entry.groupName ? (groupId.get(entry.groupName.toLowerCase()) ?? null) : null,
      build,
      link: null,
      sortKey: lastKey,
    });
    try {
      await saveRecord("pobBuilds", { ...record, source: entry.source, createdAt: entry.createdAt ?? record.createdAt });
      codes.add(entry.code);
      result.added++;
    } catch (e) {
      result.failed.push({ name: record.name, reason: String(e) });
    }
  }
  onProgress(plan.entries.length);
  return result;
}
